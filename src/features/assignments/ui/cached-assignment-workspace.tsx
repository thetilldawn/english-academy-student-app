"use client";
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
  if (entry.blocked) return <Notice role="alert" tone="danger">로그인을 다시 확인해 주세요.
    <ButtonLink href="/admin/login" variant="quiet">관리자 로그인</ButtonLink></Notice>;
  return <>
    {entry.error ? <Notice role="alert" tone="danger">{entry.error}
      <Button onClick={entry.retry} variant="quiet">다시 불러오기</Button></Notice>
      : !entry.snapshot ? <RouteLoadingState label="학생 목록을 불러오는 중…" variant="compact" /> : null}
    <AssignmentAuthenticationBoundary onFailure={context?.cache.lock}>
    <DialogVisibilityBoundary visible={Boolean(entry.snapshot)}>
      {entry.retainedSnapshot ? <AssignmentWorkspace initial={{ directory: entry.retainedSnapshot }} cacheEnabled
        interactionAllowed={Boolean(entry.snapshot)} initialDatasetId={initialDatasetId}
        initialDialogView={initialDialogView} initialStudentId={initialStudentId} /> : null}
    </DialogVisibilityBoundary>
    </AssignmentAuthenticationBoundary>
  </>;
}
