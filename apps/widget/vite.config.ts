import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { resolve } from "node:path";

// このファイル1つで2種類のビルドを面倒みる。
//   npm run dev / npm run build      -> ローカル確認用のデモページ（index.html を起点にした通常のViteアプリ）
//   npm run build:embed (mode=embed) -> 外部ECサイトに埋め込むための単一JSライブラリ（dist-embed/widget.iife.js）
//
// embedモードでは React/ReactDOM ごと1本のIIFEファイルにバンドルし、
// CSSも vite-plugin-css-injected-by-js で同じJSファイルの中に注入する
// （埋め込み先サイトは <script src="widget.iife.js"></script> の1行だけで動かせるようにするため）。
// リポジトリ直下の .env を読み込む（モノレポ全体で環境変数ファイルを1つに統一するため）。
// 指定しない場合Viteはこのファイルのあるディレクトリ(apps/widget)の.envしか見てくれない。
const REPO_ROOT = resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  if (mode === "embed") {
    return {
      envDir: REPO_ROOT,
      plugins: [react(), cssInjectedByJsPlugin()],
      build: {
        outDir: "dist-embed",
        emptyOutDir: true,
        cssCodeSplit: false,
        lib: {
          entry: resolve(__dirname, "src/embed.tsx"),
          name: "BotanicaChatEmbedBundle",
          formats: ["iife"],
          fileName: () => "widget.iife.js",
        },
      },
    };
  }

  return {
    envDir: REPO_ROOT,
    plugins: [react()],
    build: {
      outDir: "dist",
    },
  };
});
