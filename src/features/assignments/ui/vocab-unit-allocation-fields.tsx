"use client";

import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import type { IsoWeekday } from "../domain/vocab-assignment-contract";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import styles from "./vocab-assignment-planner.module.css";

const weekdayLabels: Readonly<Record<IsoWeekday, string>> = {
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
  7: "일",
};

export function VocabUnitAllocationFields({
  controller,
  fieldErrors = {},
}: {
  controller: VocabAssignmentPlannerController;
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
}) {
  const usesRangeUnits = controller.planner.assignmentMode === "per_session";
  const showsContinuation = usesRangeUnits ||
    controller.planner.assignmentMode === "word_count";
  if (!showsContinuation) {
    return null;
  }

  const overflowError = fieldErrors.overflowPolicy;
  const modeError = fieldErrors.unitAllocationMode;
  const commonCountError = fieldErrors.unitsPerSession;
  const remainingUnitCount = controller.unitAllocation?.remainingUnitIds.length ?? 0;
  const unitById = new Map(
    controller.selectedUnits.map((unit) => [unit.id, unit]),
  );
  const remainingUnits = (
    controller.unitAllocation?.remainingUnitIds ?? []
  ).flatMap((unitId) => {
    const unit = unitById.get(unitId);
    return unit ? [unit] : [];
  });
  const remainingRangeLabel = remainingUnits.length === 0
    ? ""
    : assignmentUnitRangeLabel(
        remainingUnits.map((unit) => unit.label),
        remainingUnits.map((unit) => unit.sortIndex),
      );
  return (
    <div className={styles.fieldStack}>
      {usesRangeUnits ? (
        <>
          <Field>
            <FieldLabel as="span" id="vocab-unit-allocation-mode-label">
              <HelpTip
                label="요일별 단위 수 설명"
                trigger="요일별 배정 방식"
              >
                모든 회차에 같은 단위 수를 쓰거나, 선택한 요일마다 다른
                단위 수를 정합니다.
              </HelpTip>
            </FieldLabel>
            <div
              aria-describedby={modeError
                ? "vocab-unit-allocation-mode-error"
                : undefined}
              aria-labelledby="vocab-unit-allocation-mode-label"
              className={styles.modeButtons}
              data-field-key="unitAllocationMode"
              role="group"
              tabIndex={-1}
            >
              <Button
                aria-pressed={controller.planner.unitAllocationMode === "same"}
                onClick={() =>
                  controller.actions.changeUnitAllocationMode("same")
                }
                size="small"
                variant="filter"
              >
                같은 단위 수
              </Button>
              <Button
                aria-pressed={
                  controller.planner.unitAllocationMode === "by_weekday"
                }
                onClick={() =>
                  controller.actions.changeUnitAllocationMode("by_weekday")
                }
                size="small"
                variant="filter"
              >
                요일별 단위 수
              </Button>
            </div>
            {modeError ? (
              <FieldError id="vocab-unit-allocation-mode-error">
                {modeError}
              </FieldError>
            ) : null}
          </Field>

          {controller.planner.unitAllocationMode === "same" ? (
            <Field as="label">
              <FieldLabel as="span">회차당 단위 수</FieldLabel>
              <Input
                aria-errormessage={commonCountError
                  ? "vocab-units-per-session-error"
                  : undefined}
                aria-invalid={Boolean(commonCountError)}
                data-field-key="unitsPerSession"
                max={30}
                min={1}
                onChange={(event) =>
                  controller.actions.changeUnitsPerSession(
                    Number(event.target.value),
                  )
                }
                type="number"
                value={controller.planner.unitsPerSession}
              />
              {commonCountError ? (
                <FieldError id="vocab-units-per-session-error">
                  {commonCountError}
                </FieldError>
              ) : null}
            </Field>
          ) : (
            <AssignmentFieldGrid columns={3}>
              {controller.planner.schedule.weekdays.map((weekday) => {
                const error = fieldErrors[`weekday-${weekday}-units`];
                const errorId = `vocab-weekday-${weekday}-units-error`;
                return (
                  <Field as="label" key={weekday}>
                    <FieldLabel as="span">
                      {weekdayLabels[weekday]}요일 단위 수
                    </FieldLabel>
                    <Input
                      aria-errormessage={error ? errorId : undefined}
                      aria-invalid={Boolean(error)}
                      data-field-key={`weekday-${weekday}-units`}
                      max={30}
                      min={1}
                      onChange={(event) =>
                        controller.actions.changeWeekdayUnitsPerSession(
                          weekday,
                          Number(event.target.value),
                        )
                      }
                      type="number"
                      value={
                        controller.planner.weekdayUnitsPerSession[weekday]
                      }
                    />
                    {error ? (
                      <FieldError id={errorId}>{error}</FieldError>
                    ) : null}
                  </Field>
                );
              })}
            </AssignmentFieldGrid>
          )}
        </>
      ) : null}

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
              aria-pressed={controller.planner.overflowPolicy === "leave"}
              onClick={() => controller.actions.changeOverflowPolicy("leave")}
              size="small"
              variant="filter"
            >
              가능한 범위까지만
            </Button>
            <Button
              aria-pressed={controller.planner.overflowPolicy === "continue_weekly"}
              onClick={() => controller.actions.changeOverflowPolicy("continue_weekly")}
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

      {usesRangeUnits ? (
        <span className={styles.candidateSummary} aria-live="polite">
          기본 {controller.unitAllocation?.defaultSessionCount ?? 0}회
          {remainingUnitCount > 0
            ? ` · 남음 ${remainingRangeLabel} (${remainingUnitCount}단위)`
            : ""}
        </span>
      ) : null}
    </div>
  );
}
