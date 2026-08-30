import { createRoot, type Root } from "react-dom/client";
import ChatWidget from "./ChatWidget";

/**
 * 外部ECサイトへの埋め込み用エントリポイント。
 * `npm run build:embed` で `dist-embed/widget.iife.js` として単一JSファイルにビルドされる想定。
 *
 * 埋め込み先サイトでの使い方:
 *   <script src="https://.../widget.iife.js"></script>
 *   <script>
 *     window.BotanicaChat.init({ elementId: "botanica-chat-widget" });
 *   </script>
 *
 * elementIdを省略した場合は、自動的にdivを生成してbody末尾に追加する。
 * 環境変数（VITE_SUPABASE_URL等）はビルド時に埋め込まれる（Viteの標準的な挙動）。
 */

export interface BotanicaChatInitOptions {
  /** ウィジェットをマウントするコンテナ要素のid。存在しない場合は自動生成する */
  elementId?: string;
}

const DEFAULT_ELEMENT_ID = "botanica-chat-widget";

let mountedRoot: Root | null = null;

function init(options: BotanicaChatInitOptions = {}): void {
  const elementId = options.elementId ?? DEFAULT_ELEMENT_ID;

  let container = document.getElementById(elementId);
  if (!container) {
    container = document.createElement("div");
    container.id = elementId;
    document.body.appendChild(container);
  }

  // 二重初期化（同じページで init() が複数回呼ばれた場合）に備えて既存rootを破棄する
  if (mountedRoot) {
    mountedRoot.unmount();
  }

  mountedRoot = createRoot(container);
  mountedRoot.render(<ChatWidget />);
}

declare global {
  interface Window {
    BotanicaChat?: {
      init: (options?: BotanicaChatInitOptions) => void;
    };
  }
}

window.BotanicaChat = { init };
