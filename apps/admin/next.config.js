/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/shared はビルド済みJSではなくTSソースをそのまま参照するため、
  // Next.jsのコンパイラでトランスパイルさせる（モノレポ構成向けの設定）。
  transpilePackages: ["@botanica/shared"],
  webpack(config) {
    // packages/shared/src/index.ts は `export * from "./types.js"` のように
    // TypeScript ESM流儀で拡張子.jsを付けて.tsファイルを参照している。
    // webpackにも .js -> .ts/.tsx へのフォールバック解決を教える。
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

module.exports = nextConfig;
