export function studentPageTitleForPathname(pathname: string) {
  if (pathname.startsWith("/student/attempt/")) return "시험";
  if (pathname.startsWith("/student/result/")) return "시험 결과";
  return "내 시험";
}
