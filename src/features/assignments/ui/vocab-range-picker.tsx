import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel } from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";

import { buildBulkPlanAudience } from "../presentation/bulk-plan-audience";
import { ExamQuestionOrderField } from "./bulk-exam-fields";
import { AssignmentWordCountField } from "./assignment-word-count-field";
import {
  VocabRangeFields,
  type VocabPlannerFieldsProps,
} from "./vocab-range-fields";
import styles from "./vocab-assignment-planner.module.css";
import { VocabUnitAllocationFields } from "./vocab-unit-allocation-fields";

export { VocabRangeFields } from "./vocab-range-fields";

export function VocabQuestionFields({
  controller,
  fieldErrors = {},
}: VocabPlannerFieldsProps) {
  const questionCountError = fieldErrors.questionCount;
  const selectionModeError = fieldErrors.selectionMode;
  const preview = controller.bulk.preview;
  const audience = buildBulkPlanAudience(preview);
  const reference = audience.reference;
  const availableQuestionCount = reference?.availableQuestionCount ?? null;
  const defaultSessionCount =
    reference?.defaultSessionCount ?? controller.defaultSessionCount ?? 0;
  const selectedQuestionCount =
    reference?.selectedQuestionCount ?? 0;
  const remainingQuestionCount =
    reference?.remainingQuestionCount ?? 0;
  const countSummary = preview && audience.totalCount > 1 && !reference
    ? "학생별 계획을 마지막 미리보기에서 확인해 주세요."
    : availableQuestionCount === null
    ? "범위와 단어 수를 정하면 기본 회차를 계산합니다."
    : controller.distribution === "repeat"
      ? `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 회차당 ${selectedQuestionCount}개`
      : controller.planner.assignmentMode === "per_session"
        ? `전체 ${availableQuestionCount}개 · 범위별 배정 · 기본 ${defaultSessionCount}회`
        : `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 기본 ${defaultSessionCount}회`;
  const defaultManualCount = availableQuestionCount === null
    ? 0
    : Math.min(500, availableQuestionCount);
  const manualCountValue = controller.planner.questionCountMode === "manual"
    ? controller.planner.manualQuestionCount
    : controller.planner.manualQuestionCount > 0
      ? controller.planner.manualQuestionCount
      : availableQuestionCount ?? "";

  return (
    <div className={styles.fieldStack}>
      <Field>
          <FieldLabel as="span" id="vocab-distribution-label">
            <HelpTip label="배정 방식 설명" trigger="배정 방식">
              전체 회차는 같은 범위를 매번, 회차별은 범위를 하나씩,
              단어 수는 정한 개수씩 배정합니다.
            </HelpTip>
          </FieldLabel>
          <div
            aria-labelledby="vocab-distribution-label"
            className={styles.modeButtons}
            data-field-key="distribution"
            role="group"
            tabIndex={-1}
          >
            <Button
              aria-pressed={controller.planner.assignmentMode === "all_sessions"}
              onClick={() =>
                controller.actions.changeAssignmentMode("all_sessions")
              }
              size="small"
              variant="filter"
            >
              전체 회차
            </Button>
            <Button
              aria-pressed={controller.planner.assignmentMode === "per_session"}
              onClick={() =>
                controller.actions.changeAssignmentMode("per_session")
              }
              size="small"
              variant="filter"
            >
              회차별
            </Button>
            <Button
              aria-pressed={controller.planner.assignmentMode === "word_count"}
              onClick={() =>
                controller.actions.changeAssignmentMode("word_count")
              }
              size="small"
              variant="filter"
            >
              단어 수
            </Button>
          </div>
      </Field>
      <ConditionalReveal open={controller.planner.assignmentMode !== "all_sessions"}>
        <VocabUnitAllocationFields
          controller={controller}
          fieldErrors={fieldErrors}
        />
      </ConditionalReveal>
      <ConditionalReveal open={controller.planner.assignmentMode === "word_count"}>
        <AssignmentWordCountField
          allSelected={controller.planner.questionCountMode === "all"}
          error={questionCountError}
          errorId="vocab-question-count-error"
          helpText={
            <>전체는 선택한 범위의 단어를 모두 배정하고, 숫자를 누르면 입력한
            개수씩 회차에 배정합니다.</>
          }
          inputLabel="회차당 단어 수"
          max={500}
          min={4}
          onChange={(value) => {
            controller.actions.activateManualQuestionCount(defaultManualCount);
            controller.actions.changeManualQuestionCount(value);
          }}
          onFocus={() =>
            controller.actions.activateManualQuestionCount(defaultManualCount)
          }
          onSelectAll={() => controller.actions.changeQuestionCountMode("all")}
          value={manualCountValue}
        />
      </ConditionalReveal>
      <ExamQuestionOrderField
        error={selectionModeError}
        onChange={controller.actions.changeSelectionMode}
        value={controller.planner.selectionMode}
      />
      <span className={styles.questionCountSummary} aria-live="polite">
        {countSummary}
      </span>
    </div>
  );
}

export function VocabRangePicker(props: VocabPlannerFieldsProps) {
  return (
    <>
      <VocabRangeFields {...props} />
      <VocabQuestionFields {...props} />
    </>
  );
}
