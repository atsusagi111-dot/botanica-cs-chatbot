# @botanica/widget

ボタニカ ECサイト向けの顧客用チャットウィジェット（Vite + React + TypeScript）。

## セットアップ

リポジトリルートの `.env.example` を `.env` としてコピーし、以下を設定してください
（`apps/widget` 独自の `.env` は使わず、Viteはルートの `.env` を読み込みます）。

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_CHAT_FUNCTION_URL=.../functions/v1/chat
```

依存関係のインストール（ワークスペース構成のため、リポジトリルートまたは
`apps/widget` どちらから実行しても問題ありません）。

```bash
npm install
```

## 開発

```bash
npm run dev -w apps/widget
# または apps/widget ディレクトリで
npm run dev
```

`http://localhost:5173` にボタニカ風のデモページが開き、右下にチャットランチャーボタンが表示されます。
環境変数が未設定でもUI自体は起動しますが、メッセージ送信や店舗データ取得は失敗し、
「通信エラーが発生しました。しばらくしてから再度お試しください。」と表示されます。

## 型チェック / ビルド確認

```bash
npm run typecheck -w apps/widget
npm run build -w apps/widget       # デモページのビルド（dist/）
```

## 外部サイトへの埋め込み

`src/embed.tsx` を `build:embed` でライブラリモード（IIFE）ビルドすると、
`dist-embed/widget.iife.js` という単一JSファイルが生成されます
（React/ReactDOM・CSSも同梱されるため、埋め込み先サイトに追加の依存は不要です）。

```bash
npm run build:embed -w apps/widget
```

生成物を配信し、埋め込み先のHTMLに以下を追加するとウィジェットが表示されます。

```html
<script src="https://your-cdn.example.com/widget.iife.js"></script>
<script>
  window.BotanicaChat.init({ elementId: "botanica-chat-widget" }); // elementIdは省略可
</script>
```

## 会話の流れ（実装メモ）

- `botanica_session_id` / `botanica_conversation_id` を `localStorage` に保存し、再訪問時も会話を継続します。
- メッセージ送信はDBに直接書き込まず、必ず `VITE_CHAT_FUNCTION_URL`（Edge Function）経由で行います。
- `conversationId` が確定した後は Supabase Realtime で `messages` テーブルの `INSERT` を購読し、
  オペレーターが管理画面から返信した内容もリアルタイムで反映します（メッセージ `id` で重複排除）。
- `conversations.status` が `waiting_operator` / `operator_handling` になると、
  パネル上部に案内バッジを表示します（ラベルは `packages/shared` の `STATUS_LABELS` を使用）。

## ディレクトリ構成

```
src/
  ChatWidget.tsx        本体（ランチャー + パネル開閉）
  ChatWidget.css         スタイル（"bw-" プレフィックスで名前衝突を回避）
  main.tsx               デモページ用エントリポイント
  embed.tsx              外部サイト埋め込み用エントリポイント（window.BotanicaChat.init）
  components/
    Launcher.tsx
    MessageList.tsx
    MessageBubble.tsx
    InputBox.tsx
  hooks/
    useConversation.ts   会話状態管理（送受信・Realtime購読・localStorage）
  lib/
    supabaseClient.ts    Supabaseクライアント（Realtime購読・履歴読み取り用）
```
