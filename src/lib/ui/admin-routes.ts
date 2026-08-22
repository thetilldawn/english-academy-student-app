import { adminShellText } from "@/content/ko/admin-shell";

export const ADMIN_ROUTES = [
  {
    href: "/admin",
    navLabel: adminShellText.navigation.overview,
    pageTitle: adminShellText.pageTitles.overview,
    segment: null,
  },
  {
    href: "/admin/students",
    navLabel: adminShellText.navigation.students,
    pageTitle: adminShellText.pageTitles.students,
    segment: "students",
  },
  {
    href: "/admin/assignments",
    navLabel: adminShellText.navigation.learning,
    pageTitle: adminShellText.pageTitles.learning,
    segment: "assignments",
  },
  {
    href: "/admin/results",
    navLabel: adminShellText.navigation.history,
    pageTitle: adminShellText.pageTitles.history,
    segment: "results",
  },
] as const;

export type AdminNavigationVariant = "mobile" | "sidebar" | "tablet";

export function adminRouteForSegment(segment: string | null) {
  return ADMIN_ROUTES.find((route) => route.segment === segment) ?? ADMIN_ROUTES[0];
}

export function adminPageTitleForPathname(pathname: string) {
  if (/^\/admin\/results\/[^/]+\/?$/.test(pathname)) {
    return adminShellText.pageTitles.resultDetail;
  }

  const route = [...ADMIN_ROUTES]
    .sort((left, right) => right.href.length - left.href.length)
    .find(
      (item) =>
        pathname === item.href || pathname.startsWith(`${item.href}/`),
    );

  return route?.pageTitle ?? adminShellText.pageTitles.overview;
}
