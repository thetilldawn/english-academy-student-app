import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
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

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>단어장 · 범위</h3>
      <Field as="label">
        <FieldLabel as="span">단어장</FieldLabel>
        <Select
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
      </Field>
      <DayRangeRail
        onSelect={controller.actions.selectUnit}
        selectedUnitIds={selectedIds}
        selection={controller.planner.range}
        units={controller.availableUnits}
      />
      <span className={styles.rangeSummary}>{selectedLabel}</span>
      <AssignmentFieldGrid columns={2}>
        <Field>
          <FieldLabel as="span">배정 방식</FieldLabel>
          <div className={styles.modeButtons}>
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
        <Field as="label">
          <FieldLabel as="span">DAY 묶음 기준 단어 수</FieldLabel>
          <Input
            disabled={controller.planner.distribution === "repeat"}
            max={500}
            min={1}
            onChange={(event) =>
              controller.actions.changeTargetWords(Number(event.target.value))
            }
            type="number"
            value={controller.planner.targetWordsPerSession}
          />
        </Field>
      </AssignmentFieldGrid>
    </section>
  );
}
