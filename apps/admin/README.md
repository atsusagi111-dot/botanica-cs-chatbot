# @botanica/admin

CSチャットボット（ボタニカ）のオペレーター向け管理画面。Next.js（App Router） + Supabase Auth。

## セットアップ

リポジトリのルート（またはこのディレクトリ）で依存関係をインストールします。

```bash
npm install
```

`apps/admin/.env.local` を作成し、以下を設定してください（値はルートの `.env.example` を参照）。

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 開発サーバー起動

```bash
npm run dev -w apps/admin
# もしくは apps/admin ディレクトリ内で
npm run dev
```

`http://localhost:3000` にアクセスします。未ログインの場合は自動的に `/login` にリダイレクトされます。

## オペレーターアカウントの作成

公開サインアップ画面はありません。Supabaseダッシュボードの
**Authentication > Users > Add user** からオペレーターアカウント（メール+パスワード）を手動作成してください。

初回ログイン時に `profiles` テーブルへ自分の行が自動作成されます（表示名の初期値はメールアドレスの `@` より前の部分）。表示名を変更したい場合は `profiles.display_name` を直接更新してください。

## 主な画面

- `/login` — ログイン画面
- `/` — 会話一覧（ステータスタブ、「オペレーター待ち」をデフォルト表示、Realtimeで自動更新）
- `/conversations/[id]` — 会話詳細・返信画面（Realtimeでメッセージ追加、ステータス変更ボタン）

## ビルド確認

```bash
npm run typecheck -w apps/admin
npm run build -w apps/admin
```

## Vercelへのデプロイ

Vercelプロジェクト作成時に **Root Directory** を `apps/admin` に設定してください。
モノレポ内の `packages/shared`（型定義・日本語ラベル定数）に依存しているため、
Vercel側のインストールはリポジトリルートからのnpm workspacesインストールになります。
環境変数（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`）をVercelの
Project Settings > Environment Variablesに設定してください。
