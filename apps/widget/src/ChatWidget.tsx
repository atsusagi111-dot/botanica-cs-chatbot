import { useState } from "react";
import { STATUS_LABELS } from "@botanica/shared";
import { Launcher } from "./components/Launcher";
import { MessageList } from "./components/MessageList";
import { InputBox } from "./components/InputBox";
import { useConversation } from "./hooks/useConversation";
import "./ChatWidget.css";

// このステータスの間は「オペレーターが対応します」の案内バッジを表示する
const OPERATOR_BANNER_STATUSES = new Set(["waiting_operator", "operator_handling"]);

/** ボタニカ チャットウィジェット本体。フローティングランチャー＋開閉パネル */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const { messages, status, loading, error, sendMessage } = useConversation();

  const showOperatorBanner = OPERATOR_BANNER_STATUSES.has(status);

  return (
    <div className="bw-root">
      {open && (
        <div className="bw-panel" role="dialog" aria-label="ボタニカ チャットサポート">
          <div className="bw-header">
            <span className="bw-header__logo" aria-hidden="true">
              🌿
            </span>
            <div className="bw-header__text">
              <div className="bw-header__title">ボタニカ サポート</div>
              <div className="bw-header__subtitle">植物由来のやさしいスキンケア</div>
            </div>
          </div>

          {showOperatorBanner && (
            <div className="bw-banner">
              {STATUS_LABELS[status] ?? status}：まもなくオペレーターが対応いたします
            </div>
          )}

          <MessageList messages={messages} loading={loading} />

          {error && <div className="bw-error">{error}</div>}

          <InputBox disabled={loading} onSend={sendMessage} />
        </div>
      )}

      <Launcher open={open} onClick={() => setOpen((v) => !v)} />
    </div>
  );
}
