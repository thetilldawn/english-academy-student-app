import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
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
        <Field as="label" className={styles.entryChoice}>
          <FieldLabel as="span">단어세트</FieldLabel>
          <Select
            onChange={(event) =>
              controller.actions.setEntryDatasetId(event.target.value)
            }
            value={controller.entryDatasetId}
          >
            <option value="">단어세트 선택</option>
            {controller.readyDatasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {cataloguedDatasetDisplayLabel(dataset)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </nav>
  );
}
