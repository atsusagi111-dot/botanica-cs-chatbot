import { useState, type KeyboardEvent } from "react";

interface InputBoxProps {
  disabled: boolean;
  onSend: (text: string) => void;
}

/** メッセージ入力欄。本文が空/送信中は送信ボタンを無効化し、Enterキー送信（Shift+Enterで改行）に対応する */
export function InputBox({ disabled, onSend }: InputBoxProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sendDisabled = disabled || !value.trim();

  return (
    <div className="bw-input">
      <textarea
        className="bw-input__field"
        placeholder="メッセージを入力..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
      />
      <button
        type="button"
        className="bw-input__send"
        onClick={handleSend}
        disabled={sendDisabled}
      >
        送信
      </button>
    </div>
  );
}
