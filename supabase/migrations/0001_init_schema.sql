-- ============================================================
-- 0001_init_schema.sql
-- 会話・メッセージ・FAQ・オペレータープロフィールのテーブル定義
-- ============================================================

create extension if not exists vector;
create extension if not exists pgcrypto;

-- 会話セッション
create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_session_id text not null,        -- 匿名顧客の識別（ブラウザ側で生成しlocalStorageに保存）
  status text not null default 'ai_handling'
    check (status in ('ai_handling', 'waiting_operator', 'operator_handling', 'closed')),
  assigned_operator_id uuid references auth.users(id),
  category text
    check (category in ('在庫', '配送', '返品', '商品', 'その他')),
  escalation_reason text
    check (escalation_reason in ('no_faq_match', 'complaint_detected', 'after_hours', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_status on conversations (status);
create index idx_conversations_session on conversations (customer_session_id);

-- メッセージ
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'ai', 'operator')),
  sender_id uuid,                            -- operator の場合のみ auth.users.id
  content text not null,
  matched_faq_ids uuid[],                    -- AI回答の根拠にしたFAQ（監査・デバッグ用）
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages (conversation_id, created_at);

-- FAQ ナレッジ（AI が参照）
create table faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  question text not null,
  answer text not null,
  embedding vector(1536),                    -- OpenAI text-embedding-3-small (1536次元)
  created_at timestamptz not null default now()
);

-- オペレーターの表示名（auth.users と1:1、UIにメールアドレスをそのまま出さないため）
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- messages への insert 時に conversations.updated_at を更新（会話一覧の並び替え用）
create or replace function touch_conversation()
returns trigger
language plpgsql
as $$
begin
  update conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_touch_conversation
after insert on messages
for each row execute function touch_conversation();
