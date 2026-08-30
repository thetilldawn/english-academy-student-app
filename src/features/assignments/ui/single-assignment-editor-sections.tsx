import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { adminLearningText } from "@/content/ko/admin-learning";
import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";

import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { AssignmentEditFieldErrors } from "../presentation/assignment-edit-field-errors";
import { AssignmentRangeFields } from "./assignment-range-fields";
import { AssignmentEditRangeSummary } from "./assignment-edit-range-summary";
import {
  AssignmentEditorLockedMode,
  AssignmentEditorPanel,
} from "./assignment-editor-shell";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";

export function SingleAssignmentEditorSections({
  controller,
  datasets,
  editPurpose,
  editSnapshot,
  fieldErrors,
  formId,
  onRetryUnits = () => undefined,
  progress,
  unitLoadState = { datasetId: "", message: "", status: "idle" },
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  editPurpose: "regular" | "mixed" | "review" | null;
  editSnapshot?: AssignmentEditDraft;
  fieldErrors: AssignmentEditFieldErrors;
  formId: string;
  onRetryUnits?: () => void;
  progress: AssignmentProgressItem | null;
  unitLoadState?: {
    datasetId: string;
    message: string;
    status: "idle" | "loading" | "ready" | "error";
  };
  units: readonly AssignmentUnitItem[];
}) {
  const rangeStatus = fieldErrors.dataset || fieldErrors.range
    ? "범위 확인"
    : null;
  const conditionStatus = fieldErrors.questionCount ||
    fieldErrors.questionOrder ||
    fieldErrors.direction ||
    fieldErrors.passingScore ||
    fieldErrors.retryPassingScore
    ? "조건 확인"
    : null;
  const scheduleStatus = fieldErrors.timing ||
    fieldErrors.availability ||
    fieldErrors.deadline
    ? "일정 확인"
    : null;
  const editPurposeLabel = editPurpose === "regular"
    ? "단어 시험"
    : editPurpose === "review"
      ? "오답 시험"
      : "단어+오답 시험";

  return (
    <>
      {editPurpose ? (
        <AssignmentEditorLockedMode
          ariaLabel="시험 종류"
          label={editPurposeLabel}
          title="시험 종류는 수정할 수 없습니다."
        />
      ) : null}
      {editPurpose === "mixed" ? (
        <Notice>{adminLearningText.assignmentModal.edit.lockedMixed}</Notice>
      ) : null}
      <AssignmentEditorPanel>
        <AssignmentSection
          help="시험에 사용할 단어장과 범위를 고릅니다."
          helpLabel="시험 범위 설명"
          index={1}
          status={rangeStatus}
          title="시험 범위"
        >
          {(editPurpose === "review" || editPurpose === "mixed") && editSnapshot ? (
            <AssignmentEditRangeSummary
              datasets={datasets}
              source={editSnapshot}
              units={units}
            />
          ) : (
            <AssignmentRangeFields
              capacity={controller.capacity}
              datasets={datasets}
              draft={controller.state.draft}
              fieldPolicy={controller.fieldPolicy}
              fieldErrors={fieldErrors}
              isExactReview={controller.isExactReview}
              onChangeRange={controller.actions.changeRange}
              progress={progress}
              units={units}
            />
          )}
          {editPurpose !== "review" && editPurpose !== "mixed" &&
          unitLoadState.datasetId === controller.state.draft.range.datasetId &&
          unitLoadState.status === "loading" ? (
            <div aria-busy="true" role="status">범위를 불러오는 중…</div>
          ) : editPurpose !== "review" && editPurpose !== "mixed" &&
            unitLoadState.datasetId === controller.state.draft.range.datasetId &&
            unitLoadState.status === "error" ? (
            <Notice role="alert" tone="danger">
              {unitLoadState.message}
              <Button onClick={onRetryUnits} size="small" variant="quiet">
                다시 불러오기
              </Button>
            </Notice>
          ) : null}
        </AssignmentSection>
        <AssignmentSection
          help="단어 수와 시험 문제 순서, 통과 기준을 정합니다."
          helpLabel="시험 조건 설명"
          index={2}
          status={conditionStatus}
          title="시험 조건"
        >
          <AssignmentSettingsFields
            actions={controller.actions}
            capacity={controller.capacity}
            draft={controller.state.draft}
            fieldPolicy={controller.fieldPolicy}
            fieldErrors={fieldErrors}
            fieldIdPrefix={formId}
            minimumQuestionCount={controller.minimumQuestionCount}
            part="conditions"
          />
        </AssignmentSection>
        <AssignmentSection
          help="제한시간과 응시 마감 사용 여부를 정합니다."
          helpLabel="시험 일정 설명"
          index={3}
          status={scheduleStatus}
          title="시험 일정"
        >
          <AssignmentSettingsFields
            actions={controller.actions}
            capacity={controller.capacity}
            draft={controller.state.draft}
            fieldPolicy={controller.fieldPolicy}
            fieldErrors={fieldErrors}
            fieldIdPrefix={formId}
            minimumQuestionCount={controller.minimumQuestionCount}
            part="schedule"
          />
        </AssignmentSection>
        <AssignmentSection
          help="저장될 범위와 시험 조건을 마지막으로 확인합니다."
          helpLabel="시험 미리보기 설명"
          index={4}
          title="미리보기"
        >
          <AssignmentSummaryPanel
            baselineDraft={controller.baselineDraft}
            datasets={datasets}
            draft={controller.state.draft}
            issues={controller.issues}
            preview={controller.state.preview}
            units={units}
          />
        </AssignmentSection>
      </AssignmentEditorPanel>
    </>
  );
}
