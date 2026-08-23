import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";

import { buildBulkPlanAudience } from "../presentation/bulk-plan-audience";
import { ExamQuestionOrderField } from "./bulk-exam-fields";
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
  const splitBasisError = fieldErrors.splitBasis;
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
    : controller.planner.distribution === "repeat"
      ? `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 회차당 ${selectedQuestionCount}개`
      : `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 기본 ${defaultSessionCount}회`;

  return (
    <div className={styles.fieldStack}>
      <Field>
          <FieldLabel as="span" id="vocab-distribution-label">
            <HelpTip label="배정 방식 설명" trigger="배정 방식">
              나누기는 범위를 회차별로 나누고, 전체 반복은 매회 같은 범위를 냅니다.
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
              aria-pressed={controller.planner.distribution === "split"}
              onClick={() => controller.actions.changeDistribution("split")}
              size="small"
              variant="filter"
            >
              나누기
            </Button>
            <Button
              aria-pressed={controller.planner.distribution === "repeat"}
              onClick={() => controller.actions.changeDistribution("repeat")}
              size="small"
              variant="filter"
            >
              전체 반복
            </Button>
          </div>
      </Field>
      <ConditionalReveal open={controller.planner.distribution === "split"}>
        <VocabUnitAllocationFields
          controller={controller}
          fieldErrors={fieldErrors}
        />
      </ConditionalReveal>
      <ConditionalReveal open={controller.planner.distribution === "split"}>
          <Field>
            <FieldLabel as="span" id="vocab-split-basis-label">
              <HelpTip label="나누기 기준 설명" trigger="나누기 기준">
                범위는 DAY·지문 같은 한 범위씩, 단어 수는 입력한 개수씩 나눕니다.
              </HelpTip>
            </FieldLabel>
            <div
              aria-describedby={splitBasisError
                ? "vocab-split-basis-error"
                : undefined}
              aria-labelledby="vocab-split-basis-label"
              className={styles.modeButtons}
              data-field-key="splitBasis"
              role="group"
              tabIndex={-1}
            >
              <Button
                aria-pressed={controller.planner.splitBasis === "range_unit"}
                onClick={() => controller.actions.changeSplitBasis("range_unit")}
                size="small"
                variant="filter"
              >
                범위
              </Button>
              <Button
                aria-pressed={controller.planner.splitBasis === "question_count"}
                onClick={() => controller.actions.changeSplitBasis("question_count")}
                size="small"
                variant="filter"
              >
                단어 수
              </Button>
            </div>
            {splitBasisError ? (
              <FieldError id="vocab-split-basis-error">
                {splitBasisError}
              </FieldError>
            ) : null}
          </Field>
      </ConditionalReveal>
      <Field>
          <FieldLabel as="span" id="vocab-question-count-label">
            <HelpTip label="단어 수 설명" trigger="단어 수">
              전체는 개수 제한 없이 선택 범위를 모두 배정하고, 직접 입력은 입력한 개수씩 요일에 배정합니다.
            </HelpTip>
          </FieldLabel>
          <div
            aria-describedby={questionCountError
              ? "vocab-question-count-error"
              : undefined}
            aria-labelledby="vocab-question-count-label"
            className={styles.modeButtons}
            data-field-key="questionCount"
            role="group"
            tabIndex={-1}
          >
            <Button
              aria-pressed={controller.planner.questionCountMode === "all"}
              onClick={() => controller.actions.changeQuestionCountMode("all")}
              size="small"
              variant="filter"
            >
              전체
            </Button>
            <Button
              aria-pressed={controller.planner.questionCountMode === "manual"}
              onClick={() => controller.actions.changeQuestionCountMode("manual")}
              size="small"
              variant="filter"
            >
              직접 입력
            </Button>
          </div>
          <ConditionalReveal
            open={controller.planner.questionCountMode === "manual"}
          >
            <Input
              aria-labelledby="vocab-question-count-label"
              aria-errormessage={questionCountError
                ? "vocab-question-count-error"
                : undefined}
              aria-invalid={Boolean(questionCountError)}
              data-field-key="questionCount"
              max={500}
              min={4}
              onChange={(event) =>
                controller.actions.changeManualQuestionCount(
                  Number(event.target.value),
                )
              }
              type="number"
              value={controller.planner.manualQuestionCount}
            />
          </ConditionalReveal>
          {questionCountError ? (
            <FieldError id="vocab-question-count-error">
              {questionCountError}
            </FieldError>
          ) : null}
      </Field>
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
