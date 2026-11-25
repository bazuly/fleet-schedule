import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "График транспорта",
  description: "План транспорта и заявок на перевозку",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("fleet.theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
