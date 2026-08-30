"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabaseClient";
import type { Conversation, ConversationStatus, Message } from "@botanica/shared";
import { ESCALATION_REASON_LABELS, STATUS_LABELS } from "@botanica/shared";
import styles from "./detail.module.css";

const STATUS_CLASS: Record<ConversationStatus, string | undefined> = {
  ai_handling: styles.statusAiHandling,
  waiting_operator: styles.statusWaitingOperator,
  operator_handling: styles.statusOperatorHandling,
  closed: styles.statusClosed,
};

const SENDER_LABEL: Record<Message["sender_type"], string> = {
  customer: "お客様",
  ai: "AI",
  operator: "オペレーター",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortByCreatedAtAsc(list: Message[]) {
  return [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export default function ConversationDetailPage({ params }: { params: { id: string } }) {
  const conversationId = params.id;
  const supabase = useMemo(() => createClient(), []);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const profileNamesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    profileNamesRef.current = profileNames;
  }, [profileNames]);

  // 初期データ取得
  useEffect(() => {
    let isMounted = true;

    async function load() {
      const [{ data: userData }, { data: conversationData, error: conversationError }, { data: messageData, error: messageError }] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle(),
          supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }),
        ]);

      if (!isMounted) return;

      if (conversationError || messageError) {
        setErrorMessage("会話データの取得に失敗しました。");
        setLoading(false);
        return;
      }

      setCurrentUserId(userData.user?.id ?? null);
      setConversation((conversationData as Conversation) ?? null);
      const initialMessages = (messageData as Message[]) ?? [];
      setMessages(initialMessages);

      const operatorIds = new Set<string>();
      initialMessages.forEach((m) => {
        if (m.sender_type === "operator" && m.sender_id) operatorIds.add(m.sender_id);
      });
      if (conversationData?.assigned_operator_id) {
        operatorIds.add(conversationData.assigned_operator_id);
      }

      if (operatorIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", Array.from(operatorIds));
        if (isMounted && profiles) {
          const map: Record<string, string> = {};
          profiles.forEach((p) => {
            map[p.id] = p.display_name;
          });
          setProfileNames((prev) => ({ ...prev, ...map }));
        }
      }

      setLoading(false);
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [supabase, conversationId]);

  // 未知のオペレーターsender_idを見つけたら表示名を補完取得する
  async function ensureProfileName(id: string) {
    if (profileNamesRef.current[id]) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      setProfileNames((cur) => ({ ...cur, [data.id]: data.display_name }));
    }
  }

  // Realtime購読: 新規メッセージ
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return sortByCreatedAtAsc([...prev, newMessage]);
          });
          if (newMessage.sender_type === "operator" && newMessage.sender_id) {
            ensureProfileName(newMessage.sender_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId]);

  // Realtime購読: 会話のステータス変更
  useEffect(() => {
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Conversation;
          setConversation(updated);
          if (updated.assigned_operator_id) {
            ensureProfileName(updated.assigned_operator_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId]);

  // 新規メッセージ受信時に一番下までスクロール
  useEffect(() => {
    const el = messageListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  async function handleSendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = replyText.trim();
    if (!content || sending || !currentUserId) return;

    setSending(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "operator",
        sender_id: currentUserId,
        content,
      })
      .select("*")
      .single();

    setSending(false);

    if (error) {
      setErrorMessage("返信の送信に失敗しました。");
      return;
    }

    setReplyText("");
    if (data) {
      const sent = data as Message;
      setMessages((prev) => {
        if (prev.some((m) => m.id === sent.id)) return prev;
        return sortByCreatedAtAsc([...prev, sent]);
      });
    }
  }

  async function handleTakeOver() {
    if (!currentUserId) return;
    setStatusUpdating(true);
    const { data, error } = await supabase
      .from("conversations")
      .update({ status: "operator_handling", assigned_operator_id: currentUserId })
      .eq("id", conversationId)
      .select("*")
      .single();
    setStatusUpdating(false);
    if (error) {
      setErrorMessage("ステータスの更新に失敗しました。");
      return;
    }
    if (data) setConversation(data as Conversation);
  }

  async function handleClose() {
    setStatusUpdating(true);
    const { data, error } = await supabase
      .from("conversations")
      .update({ status: "closed" })
      .eq("id", conversationId)
      .select("*")
      .single();
    setStatusUpdating(false);
    if (error) {
      setErrorMessage("ステータスの更新に失敗しました。");
      return;
    }
    if (data) setConversation(data as Conversation);
  }

  if (loading) {
    return <p className={styles.muted}>読み込み中...</p>;
  }

  if (!conversation) {
    return (
      <div>
        <Link href="/" className={styles.backLink}>
          ← 一覧へ戻る
        </Link>
        <p className={styles.muted}>会話が見つかりませんでした。</p>
      </div>
    );
  }

  const assignedName = conversation.assigned_operator_id
    ? profileNames[conversation.assigned_operator_id] ?? "読み込み中..."
    : null;

  const isClosed = conversation.status === "closed";

  return (
    <div>
      <Link href="/" className={styles.backLink}>
        ← 一覧へ戻る
      </Link>

      <div className={styles.infoPanel}>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>ステータス</span>
          <span className={`${styles.badge} ${STATUS_CLASS[conversation.status]}`}>
            {STATUS_LABELS[conversation.status] ?? conversation.status}
          </span>
        </div>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>カテゴリ</span>
          <span>{conversation.category ?? "未分類"}</span>
        </div>
        {conversation.escalation_reason && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>エスカレーション理由</span>
            <span className={styles.escalationBadge}>
              {ESCALATION_REASON_LABELS[conversation.escalation_reason] ??
                conversation.escalation_reason}
            </span>
          </div>
        )}
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>担当者</span>
          <span>{assignedName ?? "未割当"}</span>
        </div>

        <div className={styles.spacer} />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleTakeOver}
            disabled={statusUpdating || isClosed}
          >
            自分が対応する
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={handleClose}
            disabled={statusUpdating || isClosed}
          >
            対応完了にする
          </button>
        </div>
      </div>

      {errorMessage && <p className={styles.muted}>{errorMessage}</p>}

      <div className={styles.messagePanel}>
        <div className={styles.messageList} ref={messageListRef}>
          {messages.length === 0 && <div className={styles.empty}>まだメッセージがありません。</div>}
          {messages.map((m) => {
            const rowClass =
              m.sender_type === "operator"
                ? styles.messageRowOperator
                : m.sender_type === "ai"
                ? styles.messageRowAi
                : styles.messageRowCustomer;
            const bubbleClass =
              m.sender_type === "operator"
                ? styles.bubbleOperator
                : m.sender_type === "ai"
                ? styles.bubbleAi
                : styles.bubbleCustomer;
            const senderLabel =
              m.sender_type === "operator"
                ? m.sender_id === currentUserId
                  ? "あなた"
                  : profileNames[m.sender_id ?? ""] ?? SENDER_LABEL.operator
                : SENDER_LABEL[m.sender_type];

            return (
              <div key={m.id} className={`${styles.messageRow} ${rowClass}`}>
                <span className={styles.messageMeta}>
                  {senderLabel} ・ {formatDateTime(m.created_at)}
                </span>
                <div className={`${styles.bubble} ${bubbleClass}`}>{m.content}</div>
              </div>
            );
          })}
        </div>

        {isClosed ? (
          <p className={styles.closedNote}>この会話は対応完了になっています。</p>
        ) : (
          <form className={styles.replyForm} onSubmit={handleSendReply}>
            <textarea
              className={styles.textarea}
              placeholder="返信内容を入力..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className={styles.sendButton} disabled={sending || !replyText.trim()}>
              {sending ? "送信中..." : "送信"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
