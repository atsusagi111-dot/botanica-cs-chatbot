-- ============================================================
-- 0004_realtime_publication.sql
-- messages / conversations の変更をRealtimeでフロント（widget/admin）に配信する
-- ============================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
