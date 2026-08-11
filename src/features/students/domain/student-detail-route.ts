import type { StudentCodeView, StudentDetailTab } from "../model";

export type StudentDetailBaseRoute =
  | {
      kind: "detail";
      learningView: "summary";
      studentId: string;
      tab: StudentDetailTab;
    }
  | {
      datasetId: string;
      kind: "source";
      label: string;
      studentId: string;
      view: "vocab" | "passage";
    };

export type StudentDetailRoute =
  | { kind: "closed" }
  | StudentDetailBaseRoute
  | {
      datasetId: string;
      kind: "assignment";
      returnTo: StudentDetailBaseRoute;
      studentId: string;
    }
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
  if (route.kind === "assignment" || route.kind === "code") {
    return route.returnTo ?? { kind: "closed" };
  }
  if (route.kind === "source") {
    return {
      kind: "detail",
      learningView: "summary",
      studentId: route.studentId,
      tab: "learning",
    };
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
