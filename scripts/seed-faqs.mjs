#!/usr/bin/env node
// ============================================================
// scripts/seed-faqs.mjs
// case4-faq.csv を読み込み、OpenAI Embeddings APIでベクトル化した上で
// Supabaseの faqs テーブルにupsertする。
//
// - npm依存パッケージなし（Node.js 18+のグローバル fetch のみ使用）
// - .env の簡易パーサーを自前実装（dotenv不使用）
// - Supabase REST APIを素のfetch()で直接叩く
//
// 実行: node scripts/seed-faqs.mjs  (ルートから。 "npm run seed:faqs" でも可)
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ------------------------------------------------------------
// .env の簡易パーサー（KEY=VALUE 形式の行を process.env にセットするだけ）
// ------------------------------------------------------------
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // 前後のクォートを除去
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(path.resolve(process.cwd(), ".env"));

// ------------------------------------------------------------
// 簡易CSVパーサー（ダブルクォート囲み・カンマ・改行・""エスケープに対応）
// ------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // 末尾の余計な改行等でパースが崩れないよう正規化
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  // 最終フィールド/行の確定（末尾に改行が無いケースを含む）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ------------------------------------------------------------
// 環境変数チェック
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ||
  "text-embedding-3-small";

const missing = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

if (missing.length > 0) {
  console.error(
    `[エラー] 環境変数が見つかりません: ${missing.join(", ")}\n` +
      `ルートディレクトリに .env ファイルを作成し（.env.example を参考に）、上記の変数を設定してください。`,
  );
  process.exit(1);
}

// ------------------------------------------------------------
// CSV読み込み
// ------------------------------------------------------------
const csvPath = path.resolve(process.cwd(), "case4-faq.csv");
if (!existsSync(csvPath)) {
  console.error(`[エラー] CSVファイルが見つかりません: ${csvPath}`);
  process.exit(1);
}

const csvText = readFileSync(csvPath, "utf-8");
const rows = parseCsv(csvText);

if (rows.length === 0) {
  console.error("[エラー] CSVにデータがありません。");
  process.exit(1);
}

const header = rows[0].map((h) => h.trim());
const dataRows = rows.slice(1);

const idxNumber = header.indexOf("番号");
const idxCategory = header.indexOf("カテゴリ");
const idxQuestion = header.indexOf("質問");
const idxAnswer = header.indexOf("回答");

if (idxCategory === -1 || idxQuestion === -1 || idxAnswer === -1) {
  console.error(
    `[エラー] CSVのヘッダーに 番号/カテゴリ/質問/回答 の列が見つかりません。実際のヘッダー: ${
      header.join(", ")
    }`,
  );
  process.exit(1);
}

// ------------------------------------------------------------
// OpenAI Embeddings API（素のfetch）
// ------------------------------------------------------------
async function fetchEmbedding(input) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input }),
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
  return embedding;
}

// ------------------------------------------------------------
// Supabase REST API へのupsert（素のfetch）
// ------------------------------------------------------------
async function upsertFaq({ category, question, answer, embedding }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/faqs`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ category, question, answer, embedding }]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase upsert failed: ${res.status} ${text}`);
  }
}

// ------------------------------------------------------------
// メイン処理: 1件ずつ順番に処理し、1件の失敗で全体を止めない
// ------------------------------------------------------------
async function main() {
  console.log(`FAQ投入を開始します（対象: ${dataRows.length}件）`);

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    const rowNumber = idxNumber !== -1
      ? (cols[idxNumber] ?? "").trim()
      : String(i + 1);
    const category = (cols[idxCategory] ?? "").trim();
    const question = (cols[idxQuestion] ?? "").trim();
    const answer = (cols[idxAnswer] ?? "").trim();
    const progressLabel = `[${i + 1}/${dataRows.length}]`;

    if (!category || !question || !answer) {
      console.error(
        `${progressLabel} 行番号${rowNumber}: category/question/answerのいずれかが空のためスキップします。`,
      );
      failureCount++;
      continue;
    }

    try {
      const embedding = await fetchEmbedding(`${question}\n${answer}`);
      await upsertFaq({ category, question, answer, embedding });
      console.log(
        `${progressLabel} ${category}: ${question} → 投入完了`,
      );
      successCount++;
    } catch (err) {
      console.error(
        `${progressLabel} 行番号${rowNumber}（${category}: ${question}）でエラーが発生しました: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      failureCount++;
    }
  }

  console.log(
    `完了: 成功 ${successCount}件 / 失敗 ${failureCount}件（全 ${dataRows.length}件）`,
  );

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main();
