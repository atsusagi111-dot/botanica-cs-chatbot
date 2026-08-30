-- ============================================================
-- 0003_match_faqs_function.sql
-- pgvector によるFAQコサイン類似度検索。
-- FAQは18件程度の少数データのため ivfflat/hnsw 索引は作成しない
-- （データが少ないうちは索引の方が精度・速度ともに逆効果になりうる。
--   将来FAQが1000件を超える規模になったら索引追加を検討）。
-- ============================================================

create or replace function match_faqs(
  query_embedding vector(1536),
  match_threshold float default 0.75,
  match_count int default 4
)
returns table (
  id uuid,
  category text,
  question text,
  answer text,
  similarity float
)
language sql
stable
as $$
  select
    f.id,
    f.category,
    f.question,
    f.answer,
    1 - (f.embedding <=> query_embedding) as similarity
  from faqs f
  where f.embedding is not null
    and 1 - (f.embedding <=> query_embedding) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_count;
$$;
