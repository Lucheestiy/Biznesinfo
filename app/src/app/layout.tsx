import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { biznesinfoWarmStore } from "@/lib/biznesinfo/store";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "cyrillic"],
  style: ["normal", "italic"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://biznesinfo.lucheestiy.com";
const ICON_VERSION = "20260312-3";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Biznesinfo.by",
    template: "%s | Biznesinfo.by",
  },
  applicationName: "Biznesinfo.by",
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "Biznesinfo.by",
    siteName: "Biznesinfo.by",
  },
  description: "Каталог предприятий, организаций и фирм Беларуси. Поиск компаний по категориям и регионам. AI-платформа для бизнеса.",
  keywords: "бизнес, компании, каталог, Беларусь, Минск, предприятия, услуги, товары",
  manifest: `/manifest.webmanifest?v=${ICON_VERSION}`,
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}` },
      { url: `/favicon-16x16.png?v=${ICON_VERSION}`, sizes: "16x16", type: "image/png" },
      { url: `/favicon-32x32.png?v=${ICON_VERSION}`, sizes: "32x32", type: "image/png" },
      { url: `/favicon-48x48.png?v=${ICON_VERSION}`, sizes: "48x48", type: "image/png" },
      { url: `/favicon-120x120.png?v=${ICON_VERSION}`, sizes: "120x120", type: "image/png" },
      { url: `/favicon-192x192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png" },
      { url: `/favicon-512x512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png" },
      { url: `/favicon.svg?v=${ICON_VERSION}`, type: "image/svg+xml" },
    ],
    apple: [{ url: `/apple-touch-icon.png?v=${ICON_VERSION}`, sizes: "180x180", type: "image/png" }],
    shortcut: [`/favicon.ico?v=${ICON_VERSION}`],
  },
  appleWebApp: {
    capable: true,
    title: "Biznesinfo.by",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#a0006d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Warm up PostgreSQL schema/init in background to avoid first-request cold start.
  void biznesinfoWarmStore();

  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased`}>
        <div
          id="app-loading-fallback"
          style={{
            position: "fixed",
            inset: "0",
            zIndex: "2147483647",
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            color: "#1f2937",
          }}
        >
          <div>
            <div style={{ fontSize: "30px", fontWeight: 700, color: "#a0006d", marginBottom: "10px" }}>
              biznesinfo.by
            </div>
            <div style={{ fontSize: "16px", marginBottom: "6px" }}>Загрузка портала...</div>
            <div id="app-loading-hint" style={{ fontSize: "13px", color: "#6b7280" }}>
              Пожалуйста, подождите
            </div>
          </div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var root=document.documentElement;var box=document.getElementById('app-loading-fallback');var hint=document.getElementById('app-loading-hint');if(!box){return;}var done=false;var observer=null;var HINT_MS=2000;var MAX_WAIT_MS=3500;var hide=function(force){if(done){return;}if(!force&&root.getAttribute('data-app-hydrated')!=='1'){return;}done=true;if(observer){observer.disconnect();}box.style.transition='opacity 180ms ease';box.style.opacity='0';setTimeout(function(){box.style.display='none';box.setAttribute('aria-hidden','true');},200);};hide(false);observer=new MutationObserver(function(){hide(false);});observer.observe(root,{attributes:true,attributeFilter:['data-app-hydrated']});var earlyHide=function(){setTimeout(function(){hide(true);},700);};if(document.readyState==='complete'||document.readyState==='interactive'){earlyHide();}else{document.addEventListener('DOMContentLoaded',earlyHide,{once:true});}setTimeout(function(){if(done){return;}if(hint){hint.textContent='Почти готово...';}},HINT_MS);setTimeout(function(){if(done){return;}hide(true);},MAX_WAIT_MS);window.addEventListener('error',function(){hide(true);},{once:true});window.addEventListener('unhandledrejection',function(){hide(true);},{once:true});})();`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
