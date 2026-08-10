import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";

import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/tokens.css";
import "@/styles/theme.css";
import "@/styles/reset.css";
import "@/app/globals.css";
import { AppToaster } from "@/components/app-toaster";
import { commonText } from "@/content/ko/common";

const serifEn = localFont({
  src: "./fonts/SourceSerif4Variable-Roman.ttf.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--font-serif-en",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: commonText.app.title,
    template: commonText.app.titleTemplate,
  },
  description: commonText.app.description,
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
      <body className={serifEn.variable}>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("english-academy-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}`}
        </Script>
        <a className="skip-link" href="#main-content">
          {commonText.app.skipToContent}
        </a>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
