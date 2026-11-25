import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "График транспорта",
  description: "План транспорта и заявок на перевозку",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
