import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Select } from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import styles from "./assignment-workspace.module.css";

const entryModes = [
  ["student", "학생별"],
  ["school", "학교별"],
  ["dataset", "단어세트별"],
] as const;

export function VocabAssignmentEntrySelector({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  return (
    <nav aria-label="배정 시작 방식" className={styles.entryModes}>
      {entryModes.map(([value, label]) => (
        <Button
          aria-pressed={controller.entryMode === value}
          key={value}
          onClick={() => controller.actions.setEntryMode(value)}
          variant={controller.entryMode === value ? "primary" : "secondary"}
        >
          {label}
        </Button>
      ))}
      {controller.entryMode === "school" ? (
        <Field as="label" className={styles.entryChoice}>
          <FieldLabel as="span">학교</FieldLabel>
          <Select
            onChange={(event) =>
              controller.actions.setFilter("school", event.target.value)
            }
            value={controller.filters.school}
          >
            <option value="">학교 선택</option>
            {controller.schoolOptions.map((school) => (
              <option key={school} value={school}>{school}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      {controller.entryMode === "dataset" ? (
        <div className={styles.entryChoice}>
          {["idle", "loading"].includes(controller.datasetDirectory.status) ? (
            <p aria-live="polite" className={styles.entryStatus}>단어장 불러오는 중…</p>
          ) : controller.datasetDirectory.status === "error" ? (
            <Notice role="alert" tone="danger">
              {controller.datasetDirectory.error}
              <Button
                onClick={() => void controller.datasetDirectory.actions.retry()}
                size="small"
                variant="quiet"
              >
                다시 불러오기
              </Button>
            </Notice>
          ) : controller.datasetDirectory.datasets.length === 0 ? (
            <Notice role="status" tone="warning">
              지금 배정할 수 있는 단어장이 없습니다.
            </Notice>
          ) : (
            <Field as="label">
              <FieldLabel as="span">단어장</FieldLabel>
              <Select
                disabled={controller.datasetDirectory.status !== "ready"}
                onChange={(event) =>
                  controller.actions.setEntryDatasetId(event.target.value)
                }
                value={controller.entryDatasetId}
              >
                <option value="">단어장 선택</option>
                {controller.datasetDirectory.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {cataloguedDatasetDisplayLabel(dataset)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      ) : null}
    </nav>
  );
}
