export function studentPageTitleForPathname(pathname: string): string | null {
  if (pathname.startsWith("/student/attempt/")) return null;
  if (pathname.startsWith("/student/result/")) return "시험 결과";
  return "내 단어 시험";
}
