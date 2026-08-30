import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ChatWidget from "./ChatWidget";

// ローカル確認用デモページのエントリポイント（index.html から読み込まれる）。
// 本番の埋め込みには使わない（そちらは embed.tsx / build:embed を参照）。
const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('index.htmlに <div id="root"></div> が見つかりません');
}

createRoot(rootEl).render(
  <StrictMode>
    <ChatWidget />
  </StrictMode>,
);
