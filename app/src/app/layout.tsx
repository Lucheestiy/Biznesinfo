import type { Metadata } from "next";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Biznes - Бизнес-справочник Беларуси",
  description: "Каталог предприятий, организаций и фирм Беларуси. Поиск компаний по категориям и регионам. AI-платформа для бизнеса.",
  keywords: "бизнес, компании, каталог, Беларусь, Минск, предприятия, услуги, товары",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Start JSONL store warmup in background so first company navigation doesn't block on cold load.
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
              Biznesinfo.by
            </div>
            <div style={{ fontSize: "16px", marginBottom: "6px" }}>Загрузка портала...</div>
            <div id="app-loading-hint" style={{ fontSize: "13px", color: "#6b7280" }}>
              Пожалуйста, подождите
            </div>
          </div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var root=document.documentElement;var box=document.getElementById('app-loading-fallback');var hint=document.getElementById('app-loading-hint');if(!box){return;}var done=false;var hide=function(){if(done){return;}if(root.getAttribute('data-app-hydrated')!=='1'){return;}done=true;box.style.display='none';box.setAttribute('aria-hidden','true');};hide();var observer=new MutationObserver(hide);observer.observe(root,{attributes:true,attributeFilter:['data-app-hydrated']});setTimeout(function(){if(done){return;}if(hint){hint.textContent='Если экран не меняется более 10 секунд, обновите страницу.';}},10000);})();`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
