import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import LogoutButton from "./LogoutButton";
import styles from "./dashboard.module.css";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // middlewareで基本的にガード済みだが念のため
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  let displayName = profile?.display_name ?? null;

  if (!displayName) {
    // 初回ログイン時: profiles行が無ければ自動作成する
    const defaultName = user.email?.split("@")[0] ?? "オペレーター";
    const { data: inserted } = await supabase
      .from("profiles")
      .insert({ id: user.id, display_name: defaultName })
      .select("display_name")
      .single();
    displayName = inserted?.display_name ?? defaultName;
  }

  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>BOTANICA</span>
          <span className={styles.brandSub}>CS管理画面</span>
        </Link>
        <div className={styles.headerRight}>
          <span className={styles.operatorName}>{displayName} さん</span>
          <LogoutButton />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
