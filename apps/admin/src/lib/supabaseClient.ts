"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * ブラウザ（Client Component）で使うSupabaseクライアント。
 * 呼び出し側で使い回したい場合は useMemo などでキャッシュすること。
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません。"
    );
  }

  return createBrowserClient(url, anonKey);
}
