import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export function AssignmentPlannerLoadDialog({
  closeDisabled = false,
  error = "",
  onClose,
  onRetry,
}: {
  closeDisabled?: boolean;
  error?: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  return (
    <DialogFrame
      aria-busy={!error}
      aria-labelledby="assignment-planner-loading-title"
      closeDisabled={closeDisabled}
      height="large"
      layout="body-footer"
      onRequestClose={onClose}
      size="extra-wide"
    >
      <DialogHeader closeLabel="닫기">
        <h2 id="assignment-planner-loading-title">단어 배정</h2>
      </DialogHeader>
      <DialogBody>
        {error ? (
          <Notice role="alert" tone="danger">{error}</Notice>
        ) : (
          <RouteLoadingState
            label="배정 준비 자료를 불러오는 중…"
            variant="compact"
          />
        )}
      </DialogBody>
      <DialogFooter>
        {error && onRetry ? <Button onClick={onRetry}>다시 불러오기</Button> : null}
      </DialogFooter>
    </DialogFrame>
  );
}
