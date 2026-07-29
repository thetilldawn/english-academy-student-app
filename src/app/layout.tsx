import type { Metadata, Viewport } from "next";

import "@/app/globals.css";

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
  colorScheme: "light",
  themeColor: "#f4f1ea",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        {children}
      </body>
    </html>
  );
}
