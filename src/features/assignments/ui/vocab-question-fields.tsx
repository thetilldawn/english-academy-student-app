import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel } from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";
import type { VocabAssignmentMode, VocabSplitOverflowPolicy, VocabTargetSelectionMode } from "../domain/vocab-assignment-contract";
import type { VocabQuestionView, VocabUnitAllocationView } from "../presentation/vocab-question-view";
import { VocabTargetSelectionField } from "./exam-condition-fields";
import { AssignmentWordCountField } from "./assignment-word-count-field";
import { VocabUnitAllocationFields } from "./vocab-unit-allocation-fields";
import styles from "./vocab-assignment-planner.module.css";

export type VocabQuestionFieldsProps = {
  assignmentMode: VocabAssignmentMode;
  questionCountMode: "all" | "manual";
  selectionMode: VocabTargetSelectionMode;
  unitsPerSession: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  countView: VocabQuestionView;
  unitView: VocabUnitAllocationView;
  fieldErrors: { questionCount?: string; selectionMode?: string; unitsPerSession?: string; overflowPolicy?: string };
  onAssignmentModeChange: (value: VocabAssignmentMode) => void;
  onSelectionModeChange: (value: VocabTargetSelectionMode) => void;
  onUnitsPerSessionChange: (value: number) => void;
  onOverflowPolicyChange: (value: VocabSplitOverflowPolicy) => void;
  onActivateManualCount: () => void;
  onManualCountChange: (value: number) => void;
  onSelectAllCount: () => void;
  onRetryCount?: () => void;
};

export function VocabQuestionFields({
  assignmentMode, questionCountMode, selectionMode, unitsPerSession, overflowPolicy,
  countView, unitView, fieldErrors, onAssignmentModeChange, onSelectionModeChange, onRetryCount,
  onUnitsPerSessionChange, onOverflowPolicyChange, onActivateManualCount, onManualCountChange, onSelectAllCount,
}: VocabQuestionFieldsProps) {
  const questionCountError = fieldErrors.questionCount;
  const selectionModeError = fieldErrors.selectionMode;
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
              aria-pressed={assignmentMode === "all_sessions"}
              onClick={() =>
                onAssignmentModeChange("all_sessions")
              }
              size="small"
              variant="filter"
            >
              전체 회차
            </Button>
            <Button
              aria-pressed={assignmentMode === "per_session"}
              onClick={() =>
                onAssignmentModeChange("per_session")
              }
              size="small"
              variant="filter"
            >
              회차별
            </Button>
            <Button
              aria-pressed={assignmentMode === "word_count"}
              onClick={() =>
                onAssignmentModeChange("word_count")
              }
              size="small"
              variant="filter"
            >
              단어 수
            </Button>
          </div>
      </Field>
      <ConditionalReveal open={assignmentMode === "word_count"}>
        <AssignmentWordCountField
          allSelected={questionCountMode === "all"}
          allLabel={countView.allCountLabel}
          error={questionCountError}
          errorId="vocab-question-count-error"
          helpText={
            <>전체는 선택한 범위의 단어를 모두 배정하고, 숫자를 누르면 입력한
            개수씩 회차에 배정합니다.</>
          }
          inputLabel="회차당 단어 수"
          inputPlaceholder="직접 입력"
          max={500}
          min={4}
          onChange={onManualCountChange}
          onFocus={() =>
            onActivateManualCount()
          }
          onSelectAll={() => onSelectAllCount()}
          value={countView.manualCountValue}
        />
      </ConditionalReveal>
      <ConditionalReveal open={assignmentMode !== "all_sessions"}>
        <VocabUnitAllocationFields
          view={unitView} unitsPerSession={unitsPerSession} overflowPolicy={overflowPolicy}
          fieldErrors={{ unitsPerSession: fieldErrors.unitsPerSession, overflowPolicy: fieldErrors.overflowPolicy }}
          onUnitsPerSessionChange={onUnitsPerSessionChange} onOverflowPolicyChange={onOverflowPolicyChange}
        />
      </ConditionalReveal>
      <VocabTargetSelectionField
        error={selectionModeError}
        onChange={onSelectionModeChange}
        value={selectionMode}
      />
      <span className={styles.questionCountSummary} aria-live="polite">
        {countView.countSummary}
      </span>
      {countView.canRetry && onRetryCount ? (
        <Button onClick={onRetryCount} variant="secondary">단어 수 다시 확인</Button>
      ) : null}
    </div>
  );
}
