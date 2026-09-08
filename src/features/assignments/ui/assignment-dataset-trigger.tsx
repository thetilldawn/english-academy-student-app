import type { Ref } from "react";

import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldError, FieldLabel } from "@/design-system/primitives/form/field";

import type { AssignmentDatasetItem } from "../catalog-types";
import { datasetPickerTitle } from "../presentation/assignment-dataset-picker-view";
import styles from "./assignment-dataset-picker.module.css";

export type AssignmentDatasetTriggerProps = {
  dataset?: AssignmentDatasetItem;
  disabled?: boolean;
  error?: string;
  errorId: string;
  onOpen: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
};

export function AssignmentDatasetTrigger({
  dataset, disabled, error, errorId, onOpen, triggerRef,
}: AssignmentDatasetTriggerProps) {
  return (
    <Field>
      <FieldLabel as="span">단어장</FieldLabel>
      <Button
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={styles.trigger}
        data-field-key="dataset"
        disabled={disabled}
        onClick={onOpen}
        ref={triggerRef}
      >
        <span className={styles.bookText}>
          <strong>{dataset ? datasetPickerTitle(dataset) : "단어장을 선택해 주세요"}</strong>
        </span>
        <span className={styles.triggerAction}>단어장 찾기 <span aria-hidden="true">→</span></span>
      </Button>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
