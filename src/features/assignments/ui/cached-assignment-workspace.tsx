"use client";
import { adminStudentsText } from "@/content/ko/admin-students";
import type { DirectoryCacheResponse } from "@/features/students/public-contracts";
import { useCachedStudentDirectory, useStudentDirectoryCache } from "@/features/students/public-client";
import { AssignmentAuthenticationBoundary } from "../controller/assignment-authentication-boundary";
import { DialogVisibilityBoundary } from "@/design-system/primitives/dialog/dialog";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { AssignmentWorkspace } from "./assignment-workspace";

export function CachedAssignmentWorkspace({ initialResponse, initialDatasetId, initialDialogView, initialStudentId }: {
  initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>;
  initialDatasetId: string;
  initialDialogView: "assign" | "overview";
  initialStudentId: string;
}) {
  const entry = useCachedStudentDirectory(initialResponse, "assignments");
  const context = useStudentDirectoryCache();
  const text = adminStudentsText.page;
  if (entry.blocked) return <Notice role="alert" tone="danger">{text.authError}
    <ButtonLink href="/admin/login" variant="quiet">{text.login}</ButtonLink></Notice>;
  return <>
    {entry.error ? <Notice role="alert" tone="danger">{entry.error}
      <Button onClick={entry.retry} disabled={entry.refreshing} variant="quiet">{text.retry}</Button></Notice>
      : !entry.snapshot ? <RouteLoadingState label={text.loading} variant="compact" />
      : entry.stale || entry.refreshing ? <Notice role="status" tone="neutral">
        {entry.refreshing ? text.refreshingList : text.retainedAssignmentList}
        <Button onClick={entry.retry} disabled={entry.refreshing} variant="quiet">{text.retry}</Button>
      </Notice> : null}
    <AssignmentAuthenticationBoundary onFailure={context?.cache.lock}>
    <DialogVisibilityBoundary visible={Boolean(entry.snapshot)}>
      {entry.retainedSnapshot ? <AssignmentWorkspace initial={{ directory: entry.retainedSnapshot }} cacheEnabled
        interactionAllowed={Boolean(entry.snapshot)} initialDatasetId={initialDatasetId}
        initialDialogView={initialDialogView} initialStudentId={initialStudentId} /> : null}
    </DialogVisibilityBoundary>
    </AssignmentAuthenticationBoundary>
  </>;
}
