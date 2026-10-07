"use client";
import { adminStudentsText } from "@/content/ko/admin-students";
import { type DirectoryCacheResponse } from "@/features/students/public-contracts";
import { useCachedStudentDirectory, useStudentDirectoryCache } from "@/features/students/public-client";
import { AssignmentAuthenticationBoundary } from "../controller/assignment-authentication-boundary";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { AssignmentWorkspace, pendingAssignmentDirectory as pendingDirectory } from "./assignment-workspace";

export function CachedAssignmentWorkspace({ initialResponse, initialDatasetId, initialDialogView, initialStudentId }: {
  initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>;
  initialDatasetId: string;
  initialDialogView: "assign" | "overview";
  initialStudentId: string;
}) {
  const entry = useCachedStudentDirectory(initialResponse, "assignments");
  const context = useStudentDirectoryCache();
  const text = adminStudentsText.page;
  const pendingContent = entry.blocked ? <Notice role="alert" tone="danger">{text.authError}
    <ButtonLink href="/admin/login" variant="quiet">{text.login}</ButtonLink></Notice> : entry.error ? <Notice role="alert" tone="danger">{entry.error}
      <Button onClick={entry.retry} disabled={entry.refreshing} variant="quiet">{text.retry}</Button></Notice>
      : !entry.snapshot ? <RouteLoadingState label={text.loading} variant="compact" />
      : entry.stale || entry.refreshing ? <Notice role={entry.refreshing ? undefined : "status"} tone="neutral">
        {entry.refreshing ? <RouteLoadingState variant="compact" label={text.refreshingList} /> : text.retainedAssignmentList}
        <Button onClick={entry.retry} disabled={entry.refreshing} variant="quiet">{text.retry}</Button>
      </Notice> : null;
  return <>
    <AssignmentAuthenticationBoundary onFailure={context?.cache.lock}>
      <AssignmentWorkspace key={entry.blocked ? "blocked" : "allowed"}
        initial={{ directory: entry.blocked ? pendingDirectory : entry.snapshot ?? entry.retainedSnapshot ?? pendingDirectory }} cacheEnabled
        interactionAllowed={Boolean(entry.snapshot) && !entry.blocked} initialDatasetId={initialDatasetId}
        authenticationRecovery={entry.blocked ? undefined : { error: entry.error ?? "", retry: entry.retry }}
        pendingContent={pendingContent} initialDialogView={initialDialogView} initialStudentId={initialStudentId} />
    </AssignmentAuthenticationBoundary>
  </>;
}
