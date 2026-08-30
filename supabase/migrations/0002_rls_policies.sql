-- ============================================================
-- 0002_rls_policies.sql
-- 匿名(顧客ウィジェット)は参照のみ。書き込みは Edge Function(service role)経由に限定。
-- 認証済み(オペレーター)は参照・更新・返信の書き込みが可能。
-- ============================================================

alter table conversations enable row level security;
alter table messages enable row level security;
alter table faqs enable row level security;
alter table profiles enable row level security;

-- conversations --------------------------------------------------
create policy "anon can read conversations"
  on conversations for select
  to anon
  using (true);

create policy "authenticated can read conversations"
  on conversations for select
  to authenticated
  using (true);

create policy "authenticated can update conversations"
  on conversations for update
  to authenticated
  using (true);

-- messages -------------------------------------------------------
create policy "anon can read messages"
  on messages for select
  to anon
  using (true);

create policy "authenticated can read messages"
  on messages for select
  to authenticated
  using (true);

-- オペレーターは自分自身が sender_id のオペレーター発言のみ挿入可能
create policy "operator can insert own messages"
  on messages for insert
  to authenticated
  with check (sender_type = 'operator' and sender_id = auth.uid());

-- faqs -------------------------------------------------------------
-- 顧客側からの直接アクセスは不要（Edge Functionがservice roleでRLSをバイパスして参照する）
create policy "authenticated can read faqs"
  on faqs for select
  to authenticated
  using (true);

-- profiles -----------------------------------------------------------
create policy "authenticated can read profiles"
  on profiles for select
  to authenticated
  using (true);

create policy "user can upsert own profile"
  on profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "user can update own profile"
  on profiles for update
  to authenticated
  using (id = auth.uid());
