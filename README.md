# ボタニカ CSチャットボット

D2Cスキンケアブランド「ボタニカ（BOTANICA）」向けに開発した、CS（カスタマーサポート）自動応答チャットボットです。
`proposal.txt` の提案内容をもとに、顧客向けチャットウィジェット・AI自動応答・オペレーター向け管理画面をまとめて実装しています。

> **原案では応答AIにClaude APIを想定していましたが、本実装では全てOpenAI APIに置き換えています。**
> （Anthropic/Claude関連のコードは含まれていません）

このREADMEは、プログラミングに詳しくない方でも上から順番に進めればセットアップできるように書いています。分からない専門用語が出てきたら、そのまま検索していただいても大丈夫です。

---

## 目次

1. [できること](#1-できること)
2. [費用について（必ずお読みください）](#2-費用について必ずお読みください)
3. [全体の仕組み](#3-全体の仕組み)
4. [フォルダ構成](#4-フォルダ構成)
5. [セットアップ手順](#5-セットアップ手順)
6. [動作確認チェックリスト](#6-動作確認チェックリスト)
7. [無料プランの制限と注意点](#7-無料プランの制限と注意点)
8. [困ったときは（トラブルシューティング）](#8-困ったときはトラブルシューティング)
9. [今後の拡張案（Phase 2）](#9-今後の拡張案phase-2)

---

## 1. できること

- **顧客側**: ECサイトに埋め込めるチャットウィジェット。質問するとAIがFAQをもとに自動回答します。
- **AI自動応答**: `case4-faq.csv` の18件のFAQを根拠に回答します。FAQに無い内容は「わかりません」と正直に答え、事実をでっちあげません（ハルシネーション対策）。
- **自動エスカレーション**: 次の場合はAIが自動でオペレーター対応に切り替えます。
  - FAQに該当する回答が見つからない
  - クレーム・お叱りと思われる発言を検知した
  - 営業時間外（平日9:00〜18:00 JST以外）の問い合わせ
- **オペレーター側管理画面**: 問い合わせ一覧をリアルタイムで確認し、チャットに直接返信できます。

---

## 2. 費用について（必ずお読みください）

今回はテスト課題のため、**OpenAI APIの利用料以外はすべて無料**になるように構成しています。ただし、無料にした部分にはそれぞれ制約があるため、事前に把握しておいてください。

| サービス | プラン | 費用 | 制約・注意点 |
|---|---|---|---|
| Supabase（DB・認証・リアルタイム通信・AIサーバー） | Free | **無料** | 7日間操作がないとプロジェクトが自動停止（ダッシュボードから再開すれば無料で復帰）。DB容量500MBまで。同時接続数に上限あり。 |
| Vercel（管理画面のホスティング） | Hobby | **無料** | **規約上「個人・非商用利用」が前提のプランです。** 将来クライアント様が実際の商用サイトとして本運用する場合は、Pro プラン（月額$20〜）への切り替えが必要になります。テスト・デモ目的の現段階では問題ありません。 |
| OpenAI API（AIの回答生成） | 従量課金 | **有料（唯一の有料要素）** | 1回の問い合わせあたり1円未満が目安（`gpt-4o-mini` + `text-embedding-3-small` を使用）。手順内でクレジットカード登録と利用上限の設定を行います。 |

---

## 3. 全体の仕組み

```
[顧客] ─┬─ チャットウィジェット (apps/widget)
        │     ・質問を送信
        │     ・Supabase Realtimeで返信をリアルタイム受信
        │
        ▼
  Supabase Edge Function (supabase/functions/chat)
        │  1. 営業時間外か判定
        │  2. クレームっぽい発言か判定
        │  3. OpenAI Embeddings でFAQを検索
        │  4. FAQが見つからなければ「わかりません」と正直に回答
        │  5. FAQが見つかればOpenAI Chat Completionsで回答文を生成
        │
        ▼
  Supabase Database (PostgreSQL + pgvector)
    conversations / messages / faqs / profiles
        │
        ▼
[オペレーター] ── 管理画面 (apps/admin, Next.js)
        ・問い合わせ一覧をリアルタイム表示
        ・チャットに直接返信
```

---

## 4. フォルダ構成

```
案件4CSチャットボット/
├── apps/
│   ├── widget/     顧客向けチャットウィジェット（Vite + React）
│   └── admin/      オペレーター向け管理画面（Next.js）
├── supabase/
│   ├── migrations/ データベースの設計（SQL）
│   └── functions/chat/  AI応答ロジック（Supabase Edge Function）
├── packages/shared/  複数アプリで共通して使う型定義
├── scripts/seed-faqs.mjs  FAQデータをDBに登録するスクリプト
├── docs/CONTRACT.md   開発者向けの技術仕様書
├── .env.example       設定が必要な値の一覧（このファイルをコピーして使います）
└── README.md           このファイル
```

---

## 5. セットアップ手順

### 事前に準備するもの

- Windowsパソコン（このREADMEはWindows想定です）
- メールアドレス（Supabase・OpenAIのアカウント作成に使用）
- クレジットカード（OpenAI APIの利用登録に必要。使った分だけ課金される従量課金です）

### 手順1. Node.jsをインストールする

すでにインストール済みの場合はこの手順は飛ばしてください。ターミナル（PowerShell）で以下を実行し、バージョンが表示されればインストール済みです。

```
node -v
```

表示されない場合は [https://nodejs.org](https://nodejs.org) から **LTS版** をダウンロードしてインストールしてください。

### 手順2. Supabaseのアカウント・プロジェクトを作成する

1. [https://supabase.com](https://supabase.com) にアクセスし、「Start your project」からアカウントを作成（GitHubアカウントでのログインが簡単です）。
2. 「New project」から新規プロジェクトを作成します。
   - Name: 例）`botanica-cs-chatbot`
   - Database Password: 任意の強いパスワードを設定し、忘れないようにメモしてください
   - Region: `Northeast Asia (Tokyo)` を推奨
   - Plan: **Free** を選択
3. プロジェクトが作成できたら、左メニューの **Project Settings > API** を開き、以下の3つの値を控えておきます（後で使います）。
   - `Project URL`（例: `https://xxxxxxxxxxxx.supabase.co`）
   - `anon public` key
   - `service_role` key（**絶対に他人に見せない・公開しない**でください）

### 手順3. OpenAI APIキーを取得する

1. [https://platform.openai.com](https://platform.openai.com) でアカウントを作成します。
2. 画面右上の組織メニューから **Billing** を開き、支払い方法（クレジットカード）を登録します。
3. 同じくBilling画面の **Usage limits** で、**月間の利用上限額**を設定してください。テスト用途であれば **$5〜$10程度**で十分です（万が一の使いすぎを防ぐための設定です）。
4. 左メニューの **API keys** から「Create new secret key」を選び、キーを発行します。**この画面を閉じるとキーは二度と表示されないので、必ずコピーして控えてください**（`sk-` から始まる文字列）。

### 手順4. `.env` ファイルを作成する

リポジトリ直下にある `.env.example` をコピーして `.env` という名前のファイルを作成します（PowerShellで実行）。

```powershell
Copy-Item .env.example .env
```

作成した `.env` をテキストエディタ（メモ帳やVS Codeなど）で開き、手順2・3で控えた値で以下を埋めてください。同じ値を複数箇所に書く必要があります（アプリごとに変数名の接頭辞が違うためです）。

| 変数名 | 設定する値 |
|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | 手順2で控えた `Project URL` |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 手順2で控えた `anon public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | 手順2で控えた `service_role` key |
| `VITE_CHAT_FUNCTION_URL` | `{Project URL}/functions/v1/chat`（例: `https://xxxxxxxxxxxx.supabase.co/functions/v1/chat`） |
| `OPENAI_API_KEY` | 手順3で発行したキー |

他の項目（`OPENAI_CHAT_MODEL`、`FAQ_MATCH_THRESHOLD` など）はそのままで問題ありません。

### 手順5. 依存パッケージをインストールする

リポジトリ直下で以下を実行します（インターネット環境が必要です。数分かかります）。

```powershell
npm install
```

### 手順6. データベースにテーブルを作成する（マイグレーション適用）

Supabase CLIは事前インストール不要です。`npx` コマンドでそのつど実行します。

```powershell
npx supabase login
```

ブラウザが開くので、Supabaseアカウントでログイン・認可してください。次に、このプロジェクトとリポジトリを紐付けます（`<project-ref>` は手順2の `Project URL` の `https://` の後、`.supabase.co` の前の部分です）。

```powershell
npx supabase link --project-ref <project-ref>
```

データベースパスワード（手順2で設定したもの）の入力を求められたら入力してください。続けてマイグレーションを適用します。

```powershell
npx supabase db push
```

「Apply」のような確認が出たら `y` で進めてください。エラーが出て `vector` 拡張が有効化できない場合は、Supabaseダッシュボードの **Database > Extensions** で `vector` を検索し、手動で有効化してから再実行してください。

### 手順7. AI応答サーバー（Edge Function）をデプロイする

```powershell
npx supabase functions deploy chat
```

続けて、Edge Functionが使う秘密情報（OpenAI APIキーなど）をSupabase側に登録します。**`.env`ファイルの中身をそのままコピー＆ペーストする形で構いません**（ただし`VITE_`や`NEXT_PUBLIC_`が付く行は不要です）。

```powershell
npx supabase secrets set OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
npx supabase secrets set OPENAI_CHAT_MODEL=gpt-4o-mini
npx supabase secrets set OPENAI_EMBEDDING_MODEL=text-embedding-3-small
npx supabase secrets set FAQ_MATCH_THRESHOLD=0.75
npx supabase secrets set FAQ_MATCH_COUNT=4
npx supabase secrets set BUSINESS_HOURS_START=9
npx supabase secrets set BUSINESS_HOURS_END=18
```

（`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は、Supabase Edge Functionsの中では自動的に設定される予約変数なので、上記のように個別に設定する必要はありません。）

### 手順8. FAQデータを投入する

`case4-faq.csv` の18件のFAQを、OpenAIでベクトル化（Embedding）しながらデータベースに登録します。

```powershell
npm run seed:faqs
```

「`[18/18] その他: ギフトラッピングはできますか？ → 投入完了`」のように表示されれば成功です。Supabaseダッシュボードの **Table Editor > faqs** を開き、18件のデータが入っていることを確認してください。

### 手順9. ローカルで動作確認する

チャットウィジェットと管理画面、それぞれ別のターミナルウィンドウで起動します。

```powershell
# ターミナル1
npm run dev:widget
```

```powershell
# ターミナル2
npm run dev:admin
```

- `http://localhost:5173` … 顧客向けチャットウィジェットのデモページ
- `http://localhost:3000` … オペレーター管理画面

### 手順10. オペレーターアカウントを作成する

管理画面には新規登録（サインアップ）画面がありません。**Supabaseダッシュボードから手動でアカウントを作る運用**です。

1. Supabaseダッシュボードの **Authentication > Users > Add user** を開きます。
2. メールアドレスとパスワードを設定し、「Auto Confirm User」にチェックを入れて作成します。
3. `http://localhost:3000` でそのメールアドレス・パスワードでログインできれば成功です。

### 手順11. 管理画面をVercelにデプロイする（任意）

ローカルでの動作確認だけで十分な場合はこの手順は不要です。オンラインで確認したい場合は以下を行います。

1. このリポジトリをGitHubに登録します（GitHubアカウントが無い場合は [https://github.com](https://github.com) で作成）。
   ```powershell
   git remote add origin https://github.com/<あなたのアカウント>/<リポジトリ名>.git
   git push -u origin main
   ```
2. [https://vercel.com](https://vercel.com) にアクセスし、GitHubアカウントでログイン。
3. 「Add New... > Project」から、今push したリポジトリを選択してインポートします。
4. **Root Directory** の設定で `apps/admin` を選択してください（重要）。
5. **Environment Variables** に以下を追加します。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. 「Deploy」をクリックすると数分でデプロイが完了し、URLが発行されます。

> 前述の通り、Vercelの無料Hobbyプランは規約上「個人・非商用利用」が前提です。デモ・検証目的の現段階では問題ありませんが、実際にクライアント様の商用サイトとして本運用する際はProプランへの切り替えをご検討ください。

---

## 6. 動作確認チェックリスト

`case4-test-conversations.csv` に用意された8つのシナリオを、手順9で起動したチャットウィジェット（`http://localhost:5173`）に実際に入力して確認してください。

| # | 入力するメッセージ | 期待する挙動 |
|---|---|---|
| 1 | 在庫切れの商品はいつ再入荷しますか？ | FAQに基づき「毎月中旬に再入荷」等と回答 |
| 2 | 送料はいくらですか？ | FAQに基づき「全国一律550円・5,000円以上で無料」と回答 |
| 3 | 届いた商品が壊れていました | 謝罪の上「8日以内に連絡・送料当社負担で交換」と案内 |
| 4 | 先週注文した商品の請求金額が二重になっているようなので調べてほしい | 「お答えできません。オペレーターに確認します」と回答し、管理画面で「オペレーター待ち」になる |
| 5 | 対応が遅すぎる。責任者を出してください | クレームと判断し、お詫び文とともにオペレーターへ引き継ぐ |
| 6 | 御社の株価は今いくらですか？ | FAQに無い内容のため、事実をでっちあげず「お答えできません」と回答 |
| 7 | （22:00頃に）返品したいのですが | 回答の末尾に「営業時間外のため、翌営業日にオペレーターが対応いたします」と付加される |
| 8 | 定期購入の解約方法と、ポイントの有効期限を教えて | 解約方法・ポイント有効期限の**両方**に触れて回答する |

**シナリオ7（営業時間外）の確認方法**: 平日9:00〜18:00の間に確認している場合、時間外の挙動は再現できません。一時的に確認したい場合は、`npx supabase secrets set BUSINESS_HOURS_START=0` のように営業時間の範囲を今の時刻を含まない値に変更→確認→終わったら `npx supabase secrets set BUSINESS_HOURS_START=9` で元に戻してください。

管理画面（`http://localhost:3000`）側では、上記でエスカレーションされた会話が「オペレーター待ち」タブに表示され、返信・ステータス変更ができることも確認してください。

---

## 7. 無料プランの制限と注意点

- **Supabase Freeプラン**: 7日間データベースへのアクセスがないと、プロジェクトが自動的に一時停止します。停止してもデータは消えず、ダッシュボードの「Restore」ボタンで無料のまま再開できます。
- **Vercel Hobbyプラン**: 個人・非商用利用が前提の規約です。商用利用への移行時はProプランへの切り替えが必要です。
- **OpenAI API**: 唯一の有料要素です。手順3で設定した利用上限を超えると自動的にAPI呼び出しが止まる（エラーになる）ため、予期しない高額請求は防げます。

---

## 8. 困ったときは（トラブルシューティング）

- **`npx supabase db push` でエラーになる**: `vector` 拡張が有効化されていない可能性があります。Supabaseダッシュボードの Database > Extensions で `vector` を有効化してから再実行してください。
- **チャットに送信しても反応がない**: `.env` の値が正しいか、`npx supabase secrets set` を全て実行したか、`npx supabase functions deploy chat` を実行したかを確認してください。
- **`npm run seed:faqs` が途中で止まる**: OpenAIの利用上限に達していないか、APIキーが正しいかを確認してください。1行失敗しても処理は続行されますが、最終的にエラー件数が表示されます。
- **管理画面にログインできない**: Supabaseダッシュボードで作成したユーザーの「Auto Confirm User」にチェックを入れ忘れていないか確認してください。

---

## 9. 今後の拡張案（Phase 2）

`proposal.txt` に記載の通り、以下は今回のMVPスコープ外ですが、将来的な拡張候補です。

- 感情分析・問い合わせ傾向の分析ダッシュボード（週次レポート）
- Shopify等の在庫・配送システムとのAPI連携（自動回答の精度向上）
- ブランドカラーのカスタマイズ・テンプレート回答の追加
