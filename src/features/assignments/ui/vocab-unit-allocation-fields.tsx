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

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import type { IsoWeekday } from "../domain/vocab-assignment-plan";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
import styles from "./vocab-assignment-planner.module.css";

const weekdayLabels: Readonly<Record<IsoWeekday, string>> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
};

export function VocabUnitAllocationFields({
  controller,
  fieldErrors = {},
}: {
  controller: VocabAssignmentScreenController;
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
}) {
  const usesRangeUnits = controller.planner.splitBasis === "range_unit";
  const showsContinuation = usesRangeUnits ||
    controller.planner.questionCountMode === "manual";
  if (controller.planner.distribution !== "split" || !showsContinuation) {
    return null;
  }

  const allocationModeError = fieldErrors.unitAllocationMode;
  const commonCountError = fieldErrors.unitsPerSession;
  const overflowError = fieldErrors.overflowPolicy;
  const remainingUnitCount = controller.unitAllocation?.remainingUnitIds.length ?? 0;
  const unitLabelById = new Map(
    controller.selectedUnits.map((unit) => [unit.id, unit.label]),
  );
  const remainingUnitLabels = (
    controller.unitAllocation?.remainingUnitIds ?? []
  ).map((unitId) => unitLabelById.get(unitId) ?? unitId);
  const remainingRangeLabel = remainingUnitLabels.length === 0
    ? ""
    : remainingUnitLabels.length === 1
      ? remainingUnitLabels[0]!
      : `${remainingUnitLabels[0]}–${remainingUnitLabels.at(-1)}`;
  const queuedSessionCount = Math.max(
    0,
    (controller.unitAllocation?.sessionUnitIds.length ?? 0) - 1,
  );

  return (
    <div className={styles.fieldStack}>
      <AssignmentFieldGrid columns={2}>
        {usesRangeUnits ? (
          <Field>
            <FieldLabel as="span" id="vocab-unit-allocation-mode-label">
              <HelpTip label="회차별 범위 설명" trigger="회차별 범위">
                같은 수를 모든 회차에 적용하거나 선택한 요일마다 다른 단위 수를 정합니다.
              </HelpTip>
            </FieldLabel>
            <div
              aria-describedby={allocationModeError
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
                onClick={() => controller.actions.changeUnitAllocationMode("same")}
                size="small"
                variant="filter"
              >
                모든 회차 동일
              </Button>
              <Button
                aria-pressed={controller.planner.unitAllocationMode === "by_weekday"}
                onClick={() => controller.actions.changeUnitAllocationMode("by_weekday")}
                size="small"
                variant="filter"
              >
                요일별 다르게
              </Button>
            </div>
            {allocationModeError ? (
              <FieldError id="vocab-unit-allocation-mode-error">
                {allocationModeError}
              </FieldError>
            ) : null}
          </Field>
        ) : null}
        <Field>
          <FieldLabel as="span" id="vocab-overflow-policy-label">
            <HelpTip
              label={usesRangeUnits ? "남은 범위 설명" : "남은 문제 설명"}
              trigger={usesRangeUnits ? "남은 범위" : "남은 문제"}
            >
              선택한 날짜보다 회차가 많을 때 이번 일정에서 멈출지 같은 요일로 이어갈지 정합니다.
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
              이번 일정만
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
      </AssignmentFieldGrid>

      {usesRangeUnits && controller.planner.unitAllocationMode === "same" ? (
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
              controller.actions.changeUnitsPerSession(Number(event.target.value))
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
      ) : usesRangeUnits ? (
        <AssignmentFieldGrid columns={3}>
          {controller.planner.schedule.weekdays.map((weekday) => {
            const fieldKey = `weekday-${weekday}-units` as const;
            const error = fieldErrors[fieldKey];
            const errorId = `vocab-weekday-${weekday}-units-error`;
            return (
              <Field as="label" key={weekday}>
                <FieldLabel as="span">
                  {weekdayLabels[weekday]} 단위 수
                </FieldLabel>
                <Input
                  aria-errormessage={error ? errorId : undefined}
                  aria-invalid={Boolean(error)}
                  data-field-key={fieldKey}
                  max={30}
                  min={1}
                  onChange={(event) =>
                    controller.actions.changeWeekdayUnitsPerSession(
                      weekday,
                      Number(event.target.value),
                    )
                  }
                  type="number"
                  value={controller.planner.weekdayUnitsPerSession[weekday]}
                />
                {error ? <FieldError id={errorId}>{error}</FieldError> : null}
              </Field>
            );
          })}
        </AssignmentFieldGrid>
      ) : null}

      {usesRangeUnits ? (
        <span className={styles.candidateSummary} aria-live="polite">
          기본 {controller.unitAllocation?.defaultSessionCount ?? 0}회
          {queuedSessionCount > 0
            ? ` · 이어 배정 ${queuedSessionCount}회`
            : remainingUnitCount > 0
              ? ` · 남음 ${remainingRangeLabel} (${remainingUnitCount}단위)`
              : ""}
        </span>
      ) : null}
    </div>
  );
}
