import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ボタニカ CS管理画面",
  description: "CSチャットボット（ボタニカ）オペレーター向け管理画面",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
