"use client";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { useCachedStudentDirectory } from "../controller/use-cached-student-directory";
import { StudentDirectory } from "./student-directory";
import type { DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";

export function CachedStudentDirectory({ initialResponse }: { initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }> } = {}) {
  const controller = useCachedStudentDirectory(initialResponse);
  if (controller.blocked) return <Notice role="alert" tone="danger">{adminStudentsText.page.authError}<ButtonLink href="/admin/login" variant="quiet">{adminStudentsText.page.login}</ButtonLink></Notice>;
  if (controller.error) return <Notice role="alert" tone="danger">{controller.error}<Button onClick={controller.retry} variant="quiet">{adminStudentsText.page.retry}</Button></Notice>;
  if (!controller.snapshot) return <RouteLoadingState label={adminStudentsText.page.loading} variant="compact" />;
  return <StudentDirectory initialSnapshot={controller.snapshot} />;
}
