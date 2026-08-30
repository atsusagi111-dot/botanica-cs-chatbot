// ============================================================
// supabase/functions/chat/index.ts
// CSチャットボット「ボタニカ」チャット応答 Edge Function（Deno）
//
// POST /functions/v1/chat
//   body: { sessionId, conversationId?, message }
//   res : { conversationId, messages, status }
//
// 処理フロー（決定論的・この順序を厳守）:
//   1. リクエストのパース / CORS対応
//   2. 会話の取得 or 新規作成
//   3. 顧客メッセージのinsert
//   4. レート制御（直近10分でcustomerメッセージ15件超なら固定文言で即応答）
//   5. 営業時間判定（JST 平日9-18時。時間外フラグを算出するのみで、
//      実際の文言付加・DB更新は6/8/9の各終端分岐が担う）
//   6. クレーム検知（ヒットしたら固定のお詫び文で終端）
//   7. FAQ検索（OpenAI Embeddings + match_faqs RPC）
//   8. 0件ヒット → 固定文言で終端（OpenAI Chat Completionsは呼ばない = ハルシネーション防止）
//   9. 1件以上ヒット → OpenAI Chat CompletionsでFAQを根拠に回答生成
//  10. 会話の全メッセージを created_at 昇順で取得しレスポンス
//
// 依存: https://esm.sh/@supabase/supabase-js@2 のみ。OpenAI呼び出しはSDKを使わず
//       素の fetch() で REST API を直接叩く（Deno環境での依存トラブル回避のため）。
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 型のみのimportは deploy 時にDenoのトランスパイラで完全に消去されるため安全（実行時にファイル解決されない）。
// 値（配列・関数など）を外部ディレクトリから import するのは Supabase Edge Functions のバンドル対象外に
// なるリスクがあるため行わず、必要な値はこのファイル内に直接定義する。
import type {
  Category,
  ConversationStatus,
  EscalationReason,
  Message,
} from "../../../packages/shared/src/types.ts";

// packages/shared/src/constants.ts の CATEGORY_LIST と同一の値を保つこと
const CATEGORY_LIST = ["在庫", "配送", "返品", "商品", "その他"] as const;

// ------------------------------------------------------------
// 固定文言（決定論的分岐で使用。OpenAIを呼ばずに返す固定応答）
// ------------------------------------------------------------
const RATE_LIMIT_TEXT =
  "メッセージが多いため、少し時間をおいてから再度お試しください。";
const COMPLAINT_TEXT =
  "ご不便をおかけし申し訳ございません。担当のオペレーターより折り返しご連絡いたします。";
const NO_MATCH_TEXT =
  "申し訳ございませんが、こちらでは正確にお答えできません。オペレーターに確認いたします。";
const AFTER_HOURS_NOTICE =
  "営業時間外のため、翌営業日にオペレーターが対応いたします。";
const OPENAI_ERROR_TEXT =
  "只今混み合っております。オペレーターに確認いたします。";

// クレーム検知（ルールベース正規表現）
const COMPLAINT_PATTERN = /責任者|遅すぎ|最悪|ふざけ|訴え|クレーム/;

// レート制御しきい値
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_MESSAGES = 15;

const SYSTEM_PROMPT = `あなたはD2Cスキンケアブランド「ボタニカ」のカスタマーサポートAIです。以下に提示するFAQのみを根拠に回答してください。FAQに書かれていない情報を推測・創作してはいけません。
複数のFAQが関連する場合は両方に触れて回答してください。
必ず次のJSON形式のみで出力してください（説明文やコードブロック記法は不要です）:
{"category": "在庫" | "配送" | "返品" | "商品" | "その他" のいずれか1つ, "answer": "顧客への丁寧な日本語の回答文字列"}`;

// ------------------------------------------------------------
// CORS
// ------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ------------------------------------------------------------
// 型
// ------------------------------------------------------------
interface ChatRequestBody {
  sessionId?: unknown;
  conversationId?: unknown;
  message?: unknown;
}

interface FaqMatch {
  id: string;
  category: string;
  question: string;
  answer: string;
  similarity: number;
}

interface ConversationUpdateFields {
  status?: ConversationStatus;
  escalation_reason?: EscalationReason | null;
  category?: Category | null;
}

// ------------------------------------------------------------
// 営業時間判定
// JST・平日9:00〜18:00（BUSINESS_HOURS_START/END環境変数で数値指定）。土日は終日時間外。
// ------------------------------------------------------------
function isBusinessHours(startHour: number, endHour: number): boolean {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10);

  const isWeekend = weekday === "土" || weekday === "日";
  if (isWeekend) return false;

  return hour >= startHour && hour < endHour;
}

// ------------------------------------------------------------
// OpenAI REST呼び出し（素のfetch、SDK不使用）
// ------------------------------------------------------------
async function fetchEmbedding(
  apiKey: string,
  model: string,
  input: string,
): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("OpenAI embeddings: invalid response shape");
  }
  return embedding as number[];
}

async function fetchChatCompletion(
  apiKey: string,
  model: string,
  faqMatches: FaqMatch[],
  customerMessage: string,
): Promise<{ category: string | null; answer: string }> {
  const faqContext = faqMatches
    .map(
      (f, i) =>
        `${i + 1}. [${f.category}] Q: ${f.question}\nA: ${f.answer}`,
    )
    .join("\n\n");
  const userContent =
    `関連するFAQ:\n${faqContext}\n\n---\n顧客からの質問:\n${customerMessage}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI chat completions failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI chat completions: invalid response shape");
  }
  const parsed = JSON.parse(content);
  if (typeof parsed?.answer !== "string" || parsed.answer.trim() === "") {
    throw new Error("OpenAI chat completions: missing answer in JSON");
  }
  return {
    category: typeof parsed.category === "string" ? parsed.category : null,
    answer: parsed.answer,
  };
}

function normalizeCategory(raw: string | null): Category {
  if (raw && (CATEGORY_LIST as readonly string[]).includes(raw)) {
    return raw as Category;
  }
  return "その他";
}

// ------------------------------------------------------------
// メインハンドラ
// ------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // ---- 環境変数 ----
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const OPENAI_CHAT_MODEL = Deno.env.get("OPENAI_CHAT_MODEL") ??
    "gpt-4o-mini";
  const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ??
    "text-embedding-3-small";
  const FAQ_MATCH_THRESHOLD = Number(
    Deno.env.get("FAQ_MATCH_THRESHOLD") ?? "0.75",
  );
  const FAQ_MATCH_COUNT = Number(Deno.env.get("FAQ_MATCH_COUNT") ?? "4");
  const BUSINESS_HOURS_START = Number(
    Deno.env.get("BUSINESS_HOURS_START") ?? "9",
  );
  const BUSINESS_HOURS_END = Number(
    Deno.env.get("BUSINESS_HOURS_END") ?? "18",
  );

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error("Missing required environment variables");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  // ---- リクエストパース ----
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const sessionId = typeof body.sessionId === "string"
    ? body.sessionId.trim()
    : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const conversationIdInput = typeof body.conversationId === "string" &&
      body.conversationId.trim() !== ""
    ? body.conversationId.trim()
    : undefined;

  if (!sessionId || !message) {
    return jsonResponse(
      { error: "sessionId and message are required" },
      400,
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // finalize: 会話の最新状態（全メッセージ + status）を取得してレスポンスを組み立てる
  async function finalize(conversationId: string): Promise<Response> {
    const { data: conversation, error: convErr } = await supabase
      .from("conversations")
      .select("status")
      .eq("id", conversationId)
      .single();
    if (convErr) throw convErr;

    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (msgErr) throw msgErr;

    return jsonResponse({
      conversationId,
      messages: (messages ?? []) as Message[],
      status: conversation.status as ConversationStatus,
    });
  }

  async function insertMessage(
    conversationId: string,
    senderType: "customer" | "ai" | "operator",
    content: string,
    matchedFaqIds: string[] | null = null,
  ): Promise<void> {
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      matched_faq_ids: matchedFaqIds,
    });
    if (error) throw error;
  }

  async function updateConversation(
    conversationId: string,
    fields: ConversationUpdateFields,
  ): Promise<void> {
    const { error } = await supabase
      .from("conversations")
      .update(fields)
      .eq("id", conversationId);
    if (error) throw error;
  }

  try {
    // ---- 2. 会話の取得 or 新規作成 ----
    let conversationId: string;
    if (conversationIdInput) {
      const { data: existing, error: fetchErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationIdInput)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (existing) {
        conversationId = existing.id as string;
      } else {
        // 存在しないconversationIdが渡された場合は防御的に新規会話として扱う
        const { data: created, error: insertErr } = await supabase
          .from("conversations")
          .insert({ customer_session_id: sessionId, status: "ai_handling" })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        conversationId = created.id as string;
      }
    } else {
      const { data: created, error: insertErr } = await supabase
        .from("conversations")
        .insert({ customer_session_id: sessionId, status: "ai_handling" })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      conversationId = created.id as string;
    }

    // ---- 3. 顧客メッセージのinsert ----
    await insertMessage(conversationId, "customer", message);

    // ---- 4. レート制御 ----
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    ).toISOString();
    const { count: recentCustomerMessageCount, error: countErr } =
      await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("sender_type", "customer")
        .gte("created_at", windowStart);
    if (countErr) throw countErr;

    if ((recentCustomerMessageCount ?? 0) > RATE_LIMIT_MAX_MESSAGES) {
      await insertMessage(conversationId, "ai", RATE_LIMIT_TEXT);
      // 明示的にステータスは変更せず、現状のまま返す
      return await finalize(conversationId);
    }

    // ---- 5. 営業時間判定（フラグのみ算出。文言付加/DB更新は6/8/9側で行う） ----
    const afterHours = !isBusinessHours(
      BUSINESS_HOURS_START,
      BUSINESS_HOURS_END,
    );

    // ---- 6. クレーム検知 ----
    if (COMPLAINT_PATTERN.test(message)) {
      await insertMessage(conversationId, "ai", COMPLAINT_TEXT);
      await updateConversation(conversationId, {
        status: "waiting_operator",
        escalation_reason: "complaint_detected",
      });
      return await finalize(conversationId);
    }

    // ---- 7. FAQ検索（Embeddings + match_faqs RPC） ----
    let faqMatches: FaqMatch[];
    try {
      const embedding = await fetchEmbedding(
        OPENAI_API_KEY,
        OPENAI_EMBEDDING_MODEL,
        message,
      );
      const { data: matches, error: rpcErr } = await supabase.rpc(
        "match_faqs",
        {
          query_embedding: embedding,
          match_threshold: FAQ_MATCH_THRESHOLD,
          match_count: FAQ_MATCH_COUNT,
        },
      );
      if (rpcErr) throw rpcErr;
      faqMatches = (matches ?? []) as FaqMatch[];
    } catch (e) {
      console.error("FAQ検索（embedding/match_faqs）に失敗:", e);
      await insertMessage(conversationId, "ai", OPENAI_ERROR_TEXT);
      await updateConversation(conversationId, { status: "waiting_operator" });
      return await finalize(conversationId);
    }

    // ---- 8. 0件ヒット（OpenAI Chat Completionsは呼ばない = ハルシネーション防止） ----
    if (faqMatches.length === 0) {
      let text = NO_MATCH_TEXT;
      if (afterHours) {
        text += `\n\n${AFTER_HOURS_NOTICE}`;
      }
      await insertMessage(conversationId, "ai", text);
      await updateConversation(conversationId, {
        status: "waiting_operator",
        escalation_reason: "no_faq_match",
      });
      return await finalize(conversationId);
    }

    // ---- 9. 1件以上ヒット → OpenAI Chat Completionsで回答生成 ----
    try {
      const { category, answer } = await fetchChatCompletion(
        OPENAI_API_KEY,
        OPENAI_CHAT_MODEL,
        faqMatches,
        message,
      );

      let text = answer;
      if (afterHours) {
        text += `\n\n${AFTER_HOURS_NOTICE}`;
      }

      const matchedFaqIds = faqMatches.map((f) => f.id);
      await insertMessage(conversationId, "ai", text, matchedFaqIds);

      const updateFields: ConversationUpdateFields = {
        category: normalizeCategory(category),
      };
      if (afterHours) {
        updateFields.status = "waiting_operator";
        updateFields.escalation_reason = "after_hours";
      }
      await updateConversation(conversationId, updateFields);

      return await finalize(conversationId);
    } catch (e) {
      console.error("OpenAI Chat Completionsに失敗:", e);
      await insertMessage(conversationId, "ai", OPENAI_ERROR_TEXT);
      await updateConversation(conversationId, { status: "waiting_operator" });
      return await finalize(conversationId);
    }
  } catch (e) {
    console.error("chat function unexpected error:", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
