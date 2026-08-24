import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

import type { WrongWordLevelFilter } from "../../domain/wrong-word-selection";
import styles from "./student-wrong-word-panel.module.css";
import { WrongWordControlSection } from "./wrong-word-control-section";

export function WrongWordFilterSection({
  datasetFilter,
  datasetOptions,
  levelFilter,
  onDatasetFilterChange,
  onLevelFilterChange,
  onQueryChange,
  query,
}: {
  datasetFilter: string;
  datasetOptions: readonly { id: string; label: string }[];
  levelFilter: WrongWordLevelFilter;
  onDatasetFilterChange: (value: string) => void;
  onLevelFilterChange: (value: WrongWordLevelFilter) => void;
  onQueryChange: (value: string) => void;
  query: string;
}) {
  const copy = adminStudentsText.learning.wrongWordsPanel;

  return (
    <WrongWordControlSection
      title={copy.sections.filters}
      titleId="wrong-word-filter-title"
    >
      <div className={styles.filterGrid}>
        <Field as="label">
          <FieldLabel as="span">{copy.search}</FieldLabel>
          <Input
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={copy.searchPlaceholder}
            type="search"
            value={query}
          />
        </Field>
        <Field as="label">
          <FieldLabel as="span">{copy.wordbook}</FieldLabel>
          <Select
            onChange={(event) =>
              onDatasetFilterChange(event.target.value)
            }
            value={datasetFilter}
          >
            <option value="">{copy.allWordbooks}</option>
            {datasetOptions.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div
        aria-label={copy.levelFilterAria}
        className={styles.filterChips}
        role="group"
      >
        {(
          [
            ["all", copy.all],
            ["once", copy.once],
            ["repeated", copy.repeated],
          ] as const
        ).map(([value, label]) => (
          <Button
            aria-pressed={levelFilter === value}
            key={value}
            onClick={() => onLevelFilterChange(value)}
            size="small"
            variant="filter"
          >
            {label}
          </Button>
        ))}
      </div>
    </WrongWordControlSection>
  );
}
