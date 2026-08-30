"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import type { Conversation, ConversationStatus } from "@botanica/shared";
import { ESCALATION_REASON_LABELS, STATUS_LABELS } from "@botanica/shared";
import styles from "./conversations.module.css";

type TabKey = "waiting_operator" | "all" | ConversationStatus;

const STATUS_CLASS: Record<ConversationStatus, string | undefined> = {
  ai_handling: styles.statusAiHandling,
  waiting_operator: styles.statusWaitingOperator,
  operator_handling: styles.statusOperatorHandling,
  closed: styles.statusClosed,
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "waiting_operator", label: STATUS_LABELS.waiting_operator ?? "オペレーター待ち" },
  { key: "all", label: "すべて" },
  { key: "operator_handling", label: STATUS_LABELS.operator_handling ?? "オペレーター対応中" },
  { key: "ai_handling", label: STATUS_LABELS.ai_handling ?? "AI対応中" },
  { key: "closed", label: STATUS_LABELS.closed ?? "完了" },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortByUpdatedAtDesc(list: Conversation[]) {
  return [...list].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export default function ConversationListPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("waiting_operator");

  useEffect(() => {
    let isMounted = true;

    async function loadConversations() {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("updated_at", { ascending: false });

      if (!isMounted) return;

      if (error) {
        setErrorMessage("会話一覧の取得に失敗しました。");
      } else if (data) {
        setConversations(data as Conversation[]);
      }
      setLoading(false);
    }

    loadConversations();

    const channel = supabase
      .channel("conversations-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          setConversations((prev) => {
            if (payload.eventType === "DELETE") {
              const removedId = (payload.old as Partial<Conversation>).id;
              return prev.filter((c) => c.id !== removedId);
            }

            const updated = payload.new as Conversation;
            const exists = prev.some((c) => c.id === updated.id);
            const next = exists
              ? prev.map((c) => (c.id === updated.id ? updated : c))
              : [updated, ...prev];
            return sortByUpdatedAtDesc(next);
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const waitingCount = conversations.filter((c) => c.status === "waiting_operator").length;

  const filtered =
    activeTab === "all"
      ? conversations
      : conversations.filter((c) => c.status === activeTab);

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>会話一覧</h1>
      </div>

      <div className={styles.tabs}>
        {TABS.map((tab) => {
          const isWaitingTab = tab.key === "waiting_operator";
          const isActive = activeTab === tab.key;
          const classNames = [
            styles.tab,
            isWaitingTab ? styles.tabWaiting : "",
            isActive ? styles.tabActive : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={tab.key}
              type="button"
              className={classNames}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {isWaitingTab && <span className={styles.tabCount}>({waitingCount})</span>}
            </button>
          );
        })}
      </div>

      {errorMessage && <p className={styles.muted}>{errorMessage}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>セッションID</th>
              <th>カテゴリ</th>
              <th>ステータス</th>
              <th>エスカレーション理由</th>
              <th>最終更新</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className={styles.empty}>該当する会話はありません。</div>
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr
                key={c.id}
                className={[
                  styles.row,
                  c.status === "waiting_operator" ? styles.rowWaiting : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => router.push(`/conversations/${c.id}`)}
              >
                <td className={styles.sessionId}>{c.customer_session_id.slice(0, 8)}</td>
                <td>{c.category ?? <span className={styles.muted}>未分類</span>}</td>
                <td>
                  <span className={`${styles.badge} ${STATUS_CLASS[c.status]}`}>
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td>
                  {c.escalation_reason ? (
                    <span className={styles.escalationBadge}>
                      {ESCALATION_REASON_LABELS[c.escalation_reason] ?? c.escalation_reason}
                    </span>
                  ) : (
                    <span className={styles.muted}>-</span>
                  )}
                </td>
                <td>{formatDateTime(c.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
