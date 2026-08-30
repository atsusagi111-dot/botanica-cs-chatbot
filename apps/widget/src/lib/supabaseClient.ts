import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定の環境（APIキーなしでUIだけ
 * 確認したい場合など）でもビルド・起動できるよう、未設定時は null を返す。
 * 呼び出し側は null チェックのうえ、Realtime購読や直接SELECTをスキップすること。
 * （顧客からのメッセージ送信自体はEdge Function経由のため、このクライアントの
 * 有無に依存しない）
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

if (!supabase && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    "[botanica-widget] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。" +
      "Supabase Realtime購読・会話履歴の再取得は無効化されます。"
  );
}
