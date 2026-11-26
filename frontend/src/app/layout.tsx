import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "График транспорта",
  description: "План транспорта и заявок на перевозку",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var r=document.documentElement;if(localStorage.getItem("fleet.theme")==="dark")r.setAttribute("data-theme","dark");if(navigator.userAgent.indexOf("FleetScheduleAndroid")!==-1)r.setAttribute("data-app","1")}catch(e){}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
