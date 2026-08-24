export type StudentRouteLocation = {
  current: string;
  section?: string;
};

export function studentBreadcrumbForPathname(
  pathname: string,
): StudentRouteLocation | null {
  if (pathname.startsWith("/student/attempt/")) return null;
  if (pathname.startsWith("/student/result/")) {
    return { section: "내 단어 시험", current: "시험 결과" };
  }
  return { current: "내 단어 시험" };
}
