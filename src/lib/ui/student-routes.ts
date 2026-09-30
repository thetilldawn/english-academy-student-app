export function studentPageTitleForPathname(pathname: string): string | null {
  if (/^\/student\/practice\/[^/]+\/?$/u.test(pathname)) return null;
  if (pathname.startsWith("/student/practice")) return "자율연습";
  if (pathname.startsWith("/student/wordbook")) return "내 단어장";
  if (pathname.startsWith("/student/attempt/")) return null;
  if (pathname.startsWith("/student/result/")) return "시험 결과";
  if (/^\/student\/assignments\/[^/]+\/words\/?$/u.test(pathname)) return "단어장";
  return "내 단어 시험";
}
