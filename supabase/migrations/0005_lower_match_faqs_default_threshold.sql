-- ============================================================
-- 0005_lower_match_faqs_default_threshold.sql
-- match_faqsのデフォルト閾値を0.75→0.5に変更。
--
-- 実運用テストで、1メッセージに複数の質問が含まれるケース
-- （例:「定期購入の解約方法と、ポイントの有効期限を教えて」）で、
-- 該当FAQとの類似度が0.74程度にとどまり0.75の閾値をわずかに下回って
-- 検索から漏れることを確認したため。0.5であれば、無関係な質問
-- （類似度0.3〜0.47程度）との判別は引き続き保たれることを確認済み。
--
-- 実際の呼び出しはsupabase/functions/chat/index.tsがFAQ_MATCH_THRESHOLD
-- 環境変数（Secretsで0.5に設定済み）を明示的に渡すため、この関数側の
-- デフォルト値はmatch_faqsを引数なしで直接呼び出した場合のみに影響する。
-- ============================================================

create or replace function match_faqs(
  query_embedding vector(1536),
  match_threshold float default 0.5,
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
