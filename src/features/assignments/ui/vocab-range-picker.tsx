import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";

import type { AssignmentDatasetItem } from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import { DayRangeRail } from "./day-range-rail";
import styles from "./vocab-assignment-planner.module.css";

export function VocabRangePicker({
  controller,
  datasets,
}: {
  controller: VocabAssignmentPlannerController;
  datasets: readonly AssignmentDatasetItem[];
}) {
  const selectedIds = new Set(controller.selectedUnits.map((unit) => unit.id));
  const groups = groupCataloguedDatasets(datasets);
  const selectedLabel = controller.selectedUnits.length === 0
    ? "DAY를 선택하세요"
    : controller.selectedUnits.length === 1
      ? controller.selectedUnits[0]!.label
      : `${controller.selectedUnits[0]!.label} → ${controller.selectedUnits.at(-1)!.label}`;
  const summary = controller.bulk.preview?.commonPlanSummary ?? null;
  const fallbackSummary = controller.bulk.preview?.items?.find(
    (item) =>
      item.availableQuestionCount !== null &&
      item.selectedQuestionCount !== null &&
      item.remainingQuestionCount !== null &&
      item.sessions.length > 0,
  ) ?? null;
  const countSource = summary ?? fallbackSummary;
  const datasetError = controller.fieldErrors.dataset;
  const rangeError = controller.fieldErrors.range;
  const questionCountError = controller.fieldErrors.questionCount;
  const selectionModeError = controller.fieldErrors.selectionMode;
  const overflowPolicyError = controller.fieldErrors.overflowPolicy;
  const hasRemainingQuestions = Boolean(
    (summary?.remainingQuestionCount ?? 0) > 0 ||
    (controller.bulk.preview?.items ?? []).some(
      (item) => (item.remainingQuestionCount ?? 0) > 0,
    ),
  );
  const showOverflowPolicy =
    controller.planner.distribution === "split" &&
    controller.planner.questionCountMode === "manual" &&
    (controller.planner.overflowPolicy === "continue_weekly" ||
      hasRemainingQuestions);
  const countSummary = !countSource
    ? "범위와 조건을 정하면 실제 문항 수를 계산합니다."
    : controller.planner.distribution === "repeat"
      ? `출제 가능 ${countSource.availableQuestionCount} · 회차당 출제 ${countSource.selectedQuestionCount} · 회차당 제외 ${countSource.remainingQuestionCount}`
      : `출제 가능 ${countSource.availableQuestionCount} · 이번 배정 ${countSource.selectedQuestionCount} · 남음 ${countSource.remainingQuestionCount}`;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>단어장 · 범위</h3>
      <Field as="label">
        <FieldLabel as="span">단어장</FieldLabel>
        <Select
          aria-errormessage={datasetError ? "vocab-dataset-error" : undefined}
          aria-invalid={Boolean(datasetError)}
          data-field-key="dataset"
          onChange={(event) => controller.actions.changeDataset(event.target.value)}
          value={controller.planner.datasetId}
        >
          <option disabled value="">
            단어장 선택
          </option>
          {groups.map((group) => (
            <optgroup key={group.group} label={group.label}>
              {group.datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {cataloguedDatasetDisplayLabel(dataset)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {datasetError ? (
          <FieldError id="vocab-dataset-error">{datasetError}</FieldError>
        ) : null}
      </Field>
      <div
        aria-describedby={rangeError ? "vocab-range-error" : undefined}
        aria-label="DAY 범위 선택"
        data-field-key="range"
        data-invalid={Boolean(rangeError)}
        role="group"
        tabIndex={-1}
      >
        <DayRangeRail
          onSelect={controller.actions.selectUnit}
          selectedUnitIds={selectedIds}
          selection={controller.planner.range}
          units={controller.availableUnits}
        />
        <span className={styles.rangeSummary}>{selectedLabel}</span>
        {rangeError ? (
          <FieldError id="vocab-range-error">{rangeError}</FieldError>
        ) : null}
      </div>
      <AssignmentFieldGrid columns={2}>
        <Field>
          <FieldLabel as="span" id="vocab-distribution-label">
            <HelpTip
              label="배정 방식 설명"
              trigger="배정 방식"
            >
              나누기는 선택 범위를 회차별로 겹치지 않게 배정하고, 전체 반복은 같은 범위를 선택 날짜마다 다시 냅니다.
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
        <Field>
          <FieldLabel as="span" id="vocab-question-count-label">
            <HelpTip label="문항 수 설명" trigger="문항 수">
              전체는 현재 조건에서 실제로 만들 수 있는 문제를 모두 사용합니다. 직접 입력은 회차당 목표 문항 수입니다.
            </HelpTip>
          </FieldLabel>
          <div
            aria-describedby={questionCountError
              ? "vocab-question-count-error"
              : undefined}
            aria-labelledby="vocab-question-count-label"
            className={styles.modeButtons}
            data-field-key="questionCount"
            data-invalid={Boolean(questionCountError)}
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
          {controller.planner.questionCountMode === "manual" ? (
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
          ) : null}
          {questionCountError ? (
            <FieldError id="vocab-question-count-error">
              {questionCountError}
            </FieldError>
          ) : null}
        </Field>
      </AssignmentFieldGrid>
      <AssignmentFieldGrid columns={2}>
        <Field>
          <FieldLabel as="span" id="vocab-selection-mode-label">
            <HelpTip label="출제 대상 설명" trigger="출제 대상">
              범위순은 DAY 안의 원래 순서를 우선하고, 무작위는 새 배정마다 다른 문제를 고르되 같은 저장 재시도에서는 유지합니다.
            </HelpTip>
          </FieldLabel>
          <div
            aria-describedby={selectionModeError
              ? "vocab-selection-mode-error"
              : undefined}
            aria-labelledby="vocab-selection-mode-label"
            className={styles.modeButtons}
            data-field-key="selectionMode"
            data-invalid={Boolean(selectionModeError)}
            role="group"
            tabIndex={-1}
          >
            <Button
              aria-pressed={controller.planner.selectionMode === "source_order"}
              onClick={() => controller.actions.changeSelectionMode("source_order")}
              size="small"
              variant="filter"
            >
              범위순
            </Button>
            <Button
              aria-pressed={controller.planner.selectionMode === "random"}
              onClick={() => controller.actions.changeSelectionMode("random")}
              size="small"
              variant="filter"
            >
              무작위
            </Button>
          </div>
          {selectionModeError ? (
            <FieldError id="vocab-selection-mode-error">
              {selectionModeError}
            </FieldError>
          ) : null}
        </Field>
        {showOverflowPolicy ? (
          <Field>
            <FieldLabel as="span" id="vocab-overflow-policy-label">
              <HelpTip label="남은 문제 처리 설명" trigger="남은 문제">
                이번 일정만은 선택 날짜까지만 저장하고, 같은 요일로 이어서는 남은 문제를 다음 주 같은 요일에 계속 배정합니다.
              </HelpTip>
            </FieldLabel>
            <div
              aria-describedby={overflowPolicyError
                ? "vocab-overflow-policy-error"
                : undefined}
              aria-labelledby="vocab-overflow-policy-label"
              className={styles.modeButtons}
              data-field-key="overflowPolicy"
              data-invalid={Boolean(overflowPolicyError)}
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
            {overflowPolicyError ? (
              <FieldError id="vocab-overflow-policy-error">
                {overflowPolicyError}
              </FieldError>
            ) : null}
          </Field>
        ) : null}
      </AssignmentFieldGrid>
      <span className={styles.questionCountSummary} aria-live="polite">
        {countSummary}
      </span>
    </section>
  );
}
