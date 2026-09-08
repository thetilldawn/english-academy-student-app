import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldError, FieldLabel } from "@/design-system/primitives/form/field";
import { NumericInput } from "@/design-system/primitives/form/numeric-input";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import type { VocabSplitOverflowPolicy } from "../domain/vocab-assignment-contract";
import type { VocabUnitAllocationView } from "../presentation/vocab-question-view";
import styles from "./vocab-assignment-planner.module.css";

export type VocabUnitAllocationFieldsProps = {
  view: VocabUnitAllocationView;
  unitsPerSession: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  fieldErrors: { unitsPerSession?: string; overflowPolicy?: string };
  onUnitsPerSessionChange: (value: number) => void;
  onOverflowPolicyChange: (value: VocabSplitOverflowPolicy) => void;
};
export function VocabUnitAllocationFields({
  view, unitsPerSession, overflowPolicy, fieldErrors, onUnitsPerSessionChange, onOverflowPolicyChange,
}: VocabUnitAllocationFieldsProps) {
  if (!view.visible) return null;
  const overflowError = fieldErrors.overflowPolicy;
  const commonCountError = fieldErrors.unitsPerSession;
  return (
    <div className={styles.fieldStack}>
      {view.showUnitsPerSession ? (
        <Field as="label">
          <FieldLabel as="span">회차당 단위 수</FieldLabel>
          <NumericInput
            aria-errormessage={commonCountError
              ? "vocab-units-per-session-error"
              : undefined}
            aria-invalid={Boolean(commonCountError)}
            data-field-key="unitsPerSession"
            max={30}
            min={1}
            onValueChange={(value) =>
              onUnitsPerSessionChange(
                value ?? Number.NaN,
              )
            }
            required
            value={unitsPerSession}
          />
          <small>
            선택한 범위를 앞에서부터 이 수만큼씩 묶어 각 회차에 배정합니다.
          </small>
          {commonCountError ? (
            <FieldError id="vocab-units-per-session-error">
              {commonCountError}
            </FieldError>
          ) : null}
        </Field>
      ) : null}

      {view.showOverflow ? (
        <Field>
          <FieldLabel as="span" id="vocab-overflow-policy-label">
            <HelpTip
              label="남은 범위 설명"
              trigger="남은 범위"
            >
              선택한 일정에 담을 수 있는 범위까지만 배정하거나, 남은 범위를
              같은 요일로 이어서 배정합니다.
            </HelpTip>
          </FieldLabel>
          <div
            aria-describedby={overflowError ? "vocab-overflow-policy-error" : undefined}
            aria-labelledby="vocab-overflow-policy-label"
            className={styles.modeButtons}
            data-field-key="overflowPolicy"
            role="group"
            tabIndex={-1}
          >
            <Button
              aria-pressed={overflowPolicy === "leave"}
              onClick={() => onOverflowPolicyChange("leave")}
              size="small"
              variant="filter"
            >
              가능한 범위까지만
            </Button>
            <Button
              aria-pressed={overflowPolicy === "continue_weekly"}
              onClick={() => onOverflowPolicyChange("continue_weekly")}
              size="small"
              variant="filter"
            >
              같은 요일로 이어서
            </Button>
          </div>
          {overflowError ? (
            <FieldError id="vocab-overflow-policy-error">
              {overflowError}
            </FieldError>
          ) : null}
        </Field>
      ) : null}

      {view.summary !== null ? (
        <span className={styles.candidateSummary} aria-live="polite">{view.summary}</span>
      ) : null}
    </div>
  );
}
