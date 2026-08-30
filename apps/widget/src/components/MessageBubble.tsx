import type { Message } from "@botanica/shared";

interface MessageBubbleProps {
  message: Message;
}

const SENDER_LABEL: Record<Message["sender_type"], string> = {
  customer: "あなた",
  ai: "ボタニカAI",
  operator: "オペレーター",
};

/** customer / ai / operator で見た目（配置・色）を変えるメッセージ吹き出し */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isCustomer = message.sender_type === "customer";
  const time = new Date(message.created_at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`bw-row bw-row--${message.sender_type}`}>
      <div className={`bw-bubble bw-bubble--${message.sender_type}`}>
        {!isCustomer && <div className="bw-bubble__sender">{SENDER_LABEL[message.sender_type]}</div>}
        <div className="bw-bubble__content">{message.content}</div>
        <div className="bw-bubble__time">{time}</div>
      </div>
    </div>
  );
}
