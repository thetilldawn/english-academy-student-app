import { Button } from "@/design-system/primitives/button/button";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";
import {
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import type {
  AssignmentDirectionRatio,
  ExamSettings,
} from "../domain/model";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
import styles from "./vocab-assignment-planner.module.css";

type ExamConditionErrors = Partial<
  Record<"direction" | "passingScore" | "retryPassingScore", string>
>;

export function ExamQuestionOrderField({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: "sequential" | "random") => void;
  value: "sequential" | "random";
}) {
  return (
    <Field>
      <FieldLabel as="span" id="exam-question-order-label">
        <HelpTip label="시험 문제 순서 설명" trigger="시험 문제 순서">
          단어를 범위 순서대로 낼지, 시험마다 무작위로 섞을지 정합니다.
        </HelpTip>
      </FieldLabel>
      <div
        aria-labelledby="exam-question-order-label"
        className={styles.modeButtons}
        data-field-key="questionOrder"
        role="group"
        tabIndex={-1}
      >
        <Button
          aria-pressed={value === "sequential"}
          onClick={() => onChange("sequential")}
          size="small"
          variant="filter"
        >
          순서대로
        </Button>
        <Button
          aria-pressed={value === "random"}
          onClick={() => onChange("random")}
          size="small"
          variant="filter"
        >
          무작위
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function VocabTargetSelectionField({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: "source_order" | "random") => void;
  value: "source_order" | "random";
}) {
  return (
    <Field>
      <FieldLabel as="span" id="vocab-target-selection-label">
        <HelpTip label="출제 단어 선택 설명" trigger="출제 단어 선택">
          선택한 범위에서 단어를 앞에서부터 고를지, 회차마다 무작위로
          고를지 정합니다.
        </HelpTip>
      </FieldLabel>
      <div
        aria-labelledby="vocab-target-selection-label"
        className={styles.modeButtons}
        data-field-key="selectionMode"
        role="group"
        tabIndex={-1}
      >
        <Button
          aria-pressed={value === "source_order"}
          onClick={() => onChange("source_order")}
          size="small"
          variant="filter"
        >
          범위순
        </Button>
        <Button
          aria-pressed={value === "random"}
          onClick={() => onChange("random")}
          size="small"
          variant="filter"
        >
          무작위
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function ExamConditionFields({
  directionDisabled = false,
  exam,
  fieldErrors = {},
  idPrefix = "exam",
  onDirectionChange,
  onPassingScoreChange,
  onRetryEnabledChange,
  onRetryPassingScoreChange,
}: {
  directionDisabled?: boolean;
  exam: ExamSettings;
  fieldErrors?: ExamConditionErrors;
  idPrefix?: string;
  onDirectionChange: (value: AssignmentDirectionRatio) => void;
  onPassingScoreChange: (value: number) => void;
  onRetryEnabledChange: (enabled: boolean) => void;
  onRetryPassingScoreChange: (value: number) => void;
}) {
  const directionErrorId = `${idPrefix}-direction-error`;
  const scoreErrorId = `${idPrefix}-passing-score-error`;
  const retryScoreErrorId = `${idPrefix}-retry-passing-score-error`;
  const retryEnabled = exam.retryEnabled !== false;

  return (
    <div className={styles.fieldStack}>
      <Field>
        <FieldLabel as="span" id={`${idPrefix}-direction-label`}>
          <HelpTip label="시험 방식 설명" trigger="시험 방식">
            영어를 보고 뜻을 고를지, 뜻을 보고 영어를 고를지 정합니다.
          </HelpTip>
        </FieldLabel>
        <div
          aria-describedby={fieldErrors.direction ? directionErrorId : undefined}
          aria-labelledby={`${idPrefix}-direction-label`}
          className={styles.modeButtons}
          data-field-key="direction"
          role="group"
          tabIndex={-1}
        >
          {([
            [100, "영어 → 뜻"],
            [0, "뜻 → 영어"],
            [50, "혼합"],
          ] as const).map(([value, label]) => (
            <Button
              aria-pressed={exam.directionRatio === value}
              disabled={directionDisabled}
              key={value}
              onClick={() => onDirectionChange(value)}
              size="small"
              variant="filter"
            >
              {label}
            </Button>
          ))}
        </div>
        {fieldErrors.direction ? (
          <FieldError id={directionErrorId}>{fieldErrors.direction}</FieldError>
        ) : null}
      </Field>

      <Field>
          <FieldLabel as="span">
            <HelpTip label="통과 점수 설명" trigger="통과 점수">
              첫 시험에서 통과할 기준 점수입니다.
            </HelpTip>
          </FieldLabel>
          <Input
            aria-label="통과 점수"
            aria-errormessage={fieldErrors.passingScore ? scoreErrorId : undefined}
            aria-invalid={Boolean(fieldErrors.passingScore)}
            data-field-key="passingScore"
            max={100}
            min={0}
            onChange={(event) => onPassingScoreChange(Number(event.target.value))}
            required
            type="number"
            value={exam.passingScore}
          />
          {fieldErrors.passingScore ? (
            <FieldError id={scoreErrorId}>{fieldErrors.passingScore}</FieldError>
          ) : null}
      </Field>
      <Field>
        <div className={styles.toggleFieldHeading}>
          <FieldLabel as="span">
            <HelpTip label="재시험 설명" trigger="재시험">
              첫 시험에서 통과하지 못하면 틀린 문제를 다시 풉니다.
            </HelpTip>
          </FieldLabel>
          <label className={styles.inlineToggle}>
            <Checkbox
              checked={retryEnabled}
              onChange={(event) => onRetryEnabledChange(event.target.checked)}
            />
            <span>사용</span>
          </label>
        </div>
      </Field>
      <ConditionalReveal open={retryEnabled}>
        <Field className={styles.revealField}>
          <FieldLabel as="span">재시험 통과 점수</FieldLabel>
          <Input
            aria-label="재시험 통과 점수"
            aria-errormessage={fieldErrors.retryPassingScore
              ? retryScoreErrorId
              : undefined}
            aria-invalid={Boolean(fieldErrors.retryPassingScore)}
            data-field-key="retryPassingScore"
            max={100}
            min={0}
            onChange={(event) =>
              onRetryPassingScoreChange(Number(event.target.value))
            }
            required={retryEnabled}
            type="number"
            value={exam.retryPassingScore ?? exam.passingScore}
          />
          {fieldErrors.retryPassingScore ? (
            <FieldError id={retryScoreErrorId}>
              {fieldErrors.retryPassingScore}
            </FieldError>
          ) : null}
        </Field>
      </ConditionalReveal>
    </div>
  );
}

export function BulkExamFields({
  controller,
  fieldErrors = {},
}: {
  controller: BulkAssignmentController;
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
}) {
  const { actions, state } = controller;

  return (
    <div className={styles.fieldStack}>
      <ExamQuestionOrderField
        error={fieldErrors.questionOrder}
        onChange={(value) =>
          actions.changeOrder(value === "random" ? "random" : "ascending")
        }
        value={state.draft.exam.questionOrderMode === "random"
          ? "random"
          : "sequential"}
      />
      <ExamConditionFields
        exam={state.draft.exam}
        fieldErrors={fieldErrors}
        idPrefix="bulk"
        onDirectionChange={actions.changeDirection}
        onPassingScoreChange={actions.changePassingScore}
        onRetryEnabledChange={actions.changeRetryEnabled}
        onRetryPassingScoreChange={actions.changeRetryPassingScore}
      />
    </div>
  );
}
