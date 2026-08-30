import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatResponseBody, ConversationStatus, Message } from "@botanica/shared";
import { supabase } from "../lib/supabaseClient";

const SESSION_STORAGE_KEY = "botanica_session_id";
const CONVERSATION_STORAGE_KEY = "botanica_conversation_id";

const CHAT_FUNCTION_URL = import.meta.env.VITE_CHAT_FUNCTION_URL as string | undefined;

export const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    // localStorageが使えない環境（プライベートモード等）ではメモリ上のIDにフォールバック
    return crypto.randomUUID();
  }
}

function getStoredConversationId(): string | null {
  try {
    return window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeConversationId(id: string) {
  try {
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
  } catch {
    // 保存できなくても会話自体は継続できるので無視する
  }
}

/** idで重複排除しつつ、作成日時の昇順にマージする */
function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export interface UseConversationResult {
  sessionId: string;
  conversationId: string | null;
  messages: Message[];
  status: ConversationStatus;
  loading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
}

export function useConversation(): UseConversationResult {
  const [sessionId] = useState<string>(() => getOrCreateSessionId());
  const [conversationId, setConversationId] = useState<string | null>(() => getStoredConversationId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("ai_handling");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sendMessage内から常に最新値を参照するためのref（クロージャの陳腐化対策）
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // 再訪問時: 保存済みconversationIdがあれば、会話ステータスと過去メッセージを読み込む
  // （読み取りはanon keyで直接Supabaseにアクセスしてよい契約）
  useEffect(() => {
    if (!conversationId || !supabase) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: convo } = await supabase
          .from("conversations")
          .select("status")
          .eq("id", conversationId)
          .maybeSingle();
        if (!cancelled && convo?.status) {
          setStatus(convo.status as ConversationStatus);
        }

        const { data: history } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        if (!cancelled && history) {
          setMessages((prev) => mergeMessages(prev, history as Message[]));
        }
      } catch (e) {
        // 履歴の再取得に失敗しても、新規メッセージの送受信自体は継続できるので致命的エラーにはしない
        console.error("[botanica-widget] failed to load conversation history", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // conversationIdが確定したらRealtime購読を開始する。
  // Edge Functionのレスポンスで挿入済みのメッセージも流れてくるが、mergeMessagesでid重複排除する。
  useEffect(() => {
    const client = supabase;
    if (!conversationId || !client) return;

    const channel = client
      .channel(`botanica-conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => mergeMessages(prev, [newMessage]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as { status?: ConversationStatus };
          if (updated?.status) setStatus(updated.status);
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [conversationId]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setLoading(true);
      setError(null);

      if (!CHAT_FUNCTION_URL) {
        console.error("[botanica-widget] VITE_CHAT_FUNCTION_URL is not set");
        setError(NETWORK_ERROR_MESSAGE);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(CHAT_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            conversationId: conversationIdRef.current ?? undefined,
            message: trimmed,
          }),
        });

        if (!res.ok) {
          throw new Error(`chat function responded with status ${res.status}`);
        }

        const data = (await res.json()) as ChatResponseBody;

        setMessages((prev) => mergeMessages(prev, data.messages));
        setStatus(data.status);

        if (data.conversationId && data.conversationId !== conversationIdRef.current) {
          conversationIdRef.current = data.conversationId;
          setConversationId(data.conversationId);
          storeConversationId(data.conversationId);
        }
      } catch (e) {
        console.error("[botanica-widget] failed to send message", e);
        setError(NETWORK_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, loading],
  );

  return { sessionId, conversationId, messages, status, loading, error, sendMessage };
}
