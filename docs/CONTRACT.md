# 開発契約書（3ブランチ並列開発の共通仕様）

このリポジトリは `feature/backend` / `feature/widget` / `feature/admin` の3ブランチで並列開発する。
各ブランチは自分の担当ディレクトリ以外を変更しないこと。この契約書に書かれたインターフェース・命名は勝手に変更しないこと（変更が必要な場合は理由をコミットメッセージに明記する）。

## 担当ディレクトリ

| ブランチ | 担当 | 触らない |
|---|---|---|
| `feature/backend` | `supabase/functions/chat/`, `scripts/seed-faqs.mjs`（`supabase/migrations/`は完成済みなので原則変更しない） | `apps/widget`, `apps/admin` |
| `feature/widget` | `apps/widget/` | `supabase/`, `apps/admin` |
| `feature/admin` | `apps/admin/` | `supabase/`, `apps/widget` |

共通ルール:
- ルート直下の `package.json`, `README.md`, `tsconfig.base.json`, `.env.example` は編集しない（統合時にorchestratorが調整する）。
- `packages/shared/src/types.ts` の型は import して使う。重複定義しない。
- 完了前に自分のワークスペースで `tsc --noEmit` と `npm run build`（該当する場合）が通ることを確認する。

## DBスキーマ（`supabase/migrations/0001〜0004`で確定済み）

- `conversations(id, customer_session_id, status, assigned_operator_id, category, escalation_reason, created_at, updated_at)`
  - `status`: `'ai_handling' | 'waiting_operator' | 'operator_handling' | 'closed'`
  - `category`: `'在庫' | '配送' | '返品' | '商品' | 'その他' | null`
  - `escalation_reason`: `'no_faq_match' | 'complaint_detected' | 'after_hours' | 'manual' | null`
- `messages(id, conversation_id, sender_type, sender_id, content, matched_faq_ids, created_at)`
  - `sender_type`: `'customer' | 'ai' | 'operator'`
- `faqs(id, category, question, answer, embedding, created_at)`
- `profiles(id, display_name, created_at)` — `id` は `auth.users.id` と1:1
- RPC: `match_faqs(query_embedding vector(1536), match_threshold float, match_count int) -> table(id, category, question, answer, similarity)`

型定義は `packages/shared/src/types.ts` を参照（`Conversation`, `Message`, `Faq`, `Profile`, `ConversationStatus`, `Category`, `SenderType`, `EscalationReason`）。

## Edge Function API契約（`feature/backend`が実装）

```
POST {SUPABASE_URL}/functions/v1/chat
Content-Type: application/json

Request body:
{
  "sessionId": string,       // 顧客ブラウザで生成しlocalStorageに保存するUUID
  "conversationId"?: string, // 2通目以降のメッセージで渡す。省略時は新規会話を作成
  "message": string
}

Response body (200):
{
  "conversationId": string,
  "messages": Message[],     // この会話の全メッセージ（顧客の発言も含めた最新状態）
  "status": ConversationStatus
}
```

- CORS: 任意オリジンからのPOST/OPTIONSを許可する（ウィジェットの埋め込み先が不定のため）。
- 認証不要（`verify_jwt = false`、`supabase/config.toml`で設定済み）。

## 環境変数命名（`.env.example`が唯一の正。変更しないこと）

- `apps/widget`（Vite）: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_CHAT_FUNCTION_URL`
- `apps/admin`（Next.js）: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `supabase/functions/chat`（Supabase Secrets）: `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FAQ_MATCH_THRESHOLD`, `FAQ_MATCH_COUNT`, `BUSINESS_HOURS_START`, `BUSINESS_HOURS_END`
- `scripts/seed-faqs.mjs`（ローカル実行、Node.js）: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`

## 営業時間・エスカレーションのビジネスルール（`feature/backend`が実装、他ブランチはUI表示のみ）

- 営業時間: 平日 9:00〜18:00（JST）。判定は `Asia/Tokyo` タイムゾーンでサーバー側（Edge Function）が行う。
- 時間外: AIのみ対応。最終応答に「営業時間外のため、翌営業日にオペレーターが対応します」という趣旨の文言を必ず付加し、`status='waiting_operator'`, `escalation_reason='after_hours'` に更新。
- クレーム検知: ルールベース（正規表現）で「責任者/遅すぎる/最悪/訴え」等を検出したら、OpenAIを呼ばず固定のお詫び文で一次応答し `status='waiting_operator'`, `escalation_reason='complaint_detected'`。
- FAQ該当なし（`match_faqs`が0件）: OpenAI Chat Completionsを呼ばず固定文言「申し訳ございませんが、こちらでは正確にお答えできません。オペレーターに確認いたします。」で応答し `status='waiting_operator'`, `escalation_reason='no_faq_match'`（ハルシネーション防止のための決定論的経路）。
- FAQ該当あり: OpenAI Chat Completionsで回答生成。システムプロンプトで「提示されたFAQのみを根拠にする」「複数のFAQに関連する場合は両方に触れる」ことを厳命する。

## UI側（`feature/widget`, `feature/admin`）が前提にしてよいこと

- `messages`/`conversations`の変更はSupabase Realtimeで購読できる（`supabase/migrations/0004_realtime_publication.sql`でpublication設定済み）。
- 顧客側（widget）はDBに直接書き込まず、必ずEdge Function（`/functions/v1/chat`）経由でメッセージを送信する。読み取り（Realtime購読・SELECT）はanon keyで直接Supabaseにアクセスしてよい。
- オペレーター側（admin）は`messages`へのinsertのみRLSで許可されている（`sender_type='operator'`かつ`sender_id=auth.uid()`の場合のみ）。会話の`status`/`assigned_operator_id`更新はUPDATE権限あり。
- オペレーターアカウントはSupabase Dashboardから手動作成する運用（公開サインアップ画面は作らない）。ログイン画面（email/password）のみ実装すればよい。
