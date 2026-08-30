import { useEffect, useRef } from "react";
import type { Message } from "@botanica/shared";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: Message[];
  loading: boolean;
}

/** メッセージ一覧。新着（自分の送信・AI応答・オペレーター返信）で自動的に最下部へスクロールする */
export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  return (
    <div className="bw-messages">
      {messages.length === 0 && !loading && (
        <div className="bw-empty">
          こんにちは。ボタニカ チャットサポートです。
          <br />
          商品や配送、返品などについてお気軽にご質問ください。
        </div>
      )}

      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}

      {loading && (
        <div className="bw-row bw-row--ai">
          <div className="bw-bubble bw-bubble--ai bw-bubble--typing" aria-live="polite">
            <span className="bw-typing-label">AIが考え中...</span>
            <span className="bw-typing-dot" />
            <span className="bw-typing-dot" />
            <span className="bw-typing-dot" />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
