import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { adminLearningText } from "@/content/ko/admin-learning";

import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { AssignmentEditFieldErrors } from "../presentation/assignment-edit-field-errors";
import { AssignmentRangeFields } from "./assignment-range-fields";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";
import styles from "./single-assignment-editor.module.css";
import plannerStyles from "./vocab-assignment-planner.module.css";

export function SingleAssignmentEditorSections({
  controller,
  datasets,
  editPurpose,
  fieldErrors,
  formId,
  progress,
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  editPurpose: "regular" | "mixed" | "review" | null;
  fieldErrors: AssignmentEditFieldErrors;
  formId: string;
  progress: AssignmentProgressItem | null;
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

  return (
    <>
      {editPurpose ? (
        <div
          aria-label="시험 종류"
          className={plannerStyles.assignmentKind}
          role="group"
          title="시험 종류는 수정할 수 없습니다."
        >
          <Button
            aria-pressed={editPurpose !== "review"}
            disabled
            variant="filter"
          >
            단어 시험
          </Button>
          <Button
            aria-pressed={editPurpose === "review"}
            disabled
            variant="filter"
          >
            오답 시험
          </Button>
        </div>
      ) : null}
      {editPurpose === "mixed" ? (
        <Notice>{adminLearningText.assignmentModal.edit.lockedMixed}</Notice>
      ) : null}
      <div
        className={[styles.sections, plannerStyles.assignmentPanel].join(" ")}
      >
        <AssignmentSection
          help="시험에 사용할 단어장과 범위를 고릅니다."
          helpLabel="시험 범위 설명"
          index={1}
          status={rangeStatus}
          title="시험 범위"
        >
          <AssignmentRangeFields
            controller={controller}
            datasets={datasets}
            fieldErrors={fieldErrors}
            progress={progress}
            units={units}
          />
        </AssignmentSection>
        <AssignmentSection
          help="단어 수와 시험 문제 순서, 통과 기준을 정합니다."
          helpLabel="시험 조건 설명"
          index={2}
          status={conditionStatus}
          title="시험 조건"
        >
          <AssignmentSettingsFields
            controller={controller}
            fieldErrors={fieldErrors}
            fieldIdPrefix={formId}
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
            controller={controller}
            fieldErrors={fieldErrors}
            fieldIdPrefix={formId}
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
            controller={controller}
            datasets={datasets}
            units={units}
          />
        </AssignmentSection>
      </div>
    </>
  );
}
