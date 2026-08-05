import type { Metadata, Viewport } from "next";
import { Gowun_Batang, Source_Serif_4 } from "next/font/google";
import Script from "next/script";

import "@/app/globals.css";

const serifKr = Gowun_Batang({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-serif-kr",
  display: "swap",
});

const serifEn = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif-en",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "영어 학습실",
    template: "%s | 영어 학습실",
  },
  description: "학생별 단어 시험과 오답을 관리하는 영어 학습 앱",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfbf7" },
    { media: "(prefers-color-scheme: dark)", color: "#232220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${serifKr.variable} ${serifEn.variable}`}>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("english-academy-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}`}
        </Script>
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        {children}
      </body>
    </html>
  );
}
