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
  if (!controller.snapshot) return controller.error
    ? <Notice role="alert" tone="danger">{controller.error}<Button onClick={controller.retry} variant="quiet">{adminStudentsText.page.retry}</Button></Notice>
    : <RouteLoadingState label={adminStudentsText.page.loading} variant="compact" />;
  const notice = controller.error || (controller.refreshing
    ? adminStudentsText.page.refreshingList
    : controller.stale ? adminStudentsText.page.retainedStudentList : "");
  return <>
    {notice ? <Notice role={controller.error ? "alert" : "status"} tone={controller.error ? "danger" : "neutral"}>
      {notice}
      <Button disabled={controller.refreshing} onClick={controller.retry} variant="quiet">{adminStudentsText.page.retry}</Button>
    </Notice> : null}
    <StudentDirectory initialSnapshot={controller.snapshot} syncInitialSnapshot />
  </>;
}
