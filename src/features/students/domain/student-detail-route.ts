import type { StudentCodeView, StudentDetailTab } from "../model";

export type StudentDetailBaseRoute = {
  kind: "detail";
  studentId: string;
  tab: StudentDetailTab;
};

export type StudentDetailRoute =
  | { kind: "closed" }
  | StudentDetailBaseRoute
  | {
      code: StudentCodeView;
      kind: "code";
      returnTo: StudentDetailBaseRoute | null;
      studentId: string | null;
    };

export type StudentDetailCloseReason =
  | "backdrop"
  | "close-button"
  | "escape";

export function studentDetailBackRoute(
  route: StudentDetailRoute,
): StudentDetailRoute {
  if (route.kind === "code") {
    return route.returnTo ?? { kind: "closed" };
  }
  return { kind: "closed" };
}

export function studentDetailCloseRoute(
  route: StudentDetailRoute,
  reason: StudentDetailCloseReason,
): StudentDetailRoute {
  if (reason === "close-button") return { kind: "closed" };
  return studentDetailBackRoute(route);
}
