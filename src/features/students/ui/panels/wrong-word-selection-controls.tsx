import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import {
  readingCurriculumStageLabel,
  readingCurriculumStages,
  type ReadingCurriculumStage,
} from "@/lib/admin/reading-curriculum";

import type { WrongWordSelectionPurpose } from "../../domain/wrong-word-selection";
import styles from "./student-wrong-word-panel.module.css";

type ReadingContextSyncStatus =
  | "not_synced"
  | "not_configured"
  | "synced"
  | "failed";

export function WrongWordSelectionControls({
  allVisibleSelected,
  busy,
  curriculumStage,
  loading,
  onCreateWorksheet,
  onCurriculumStageChange,
  onQueueWords,
  onToggleVisible,
  purpose,
  queueing,
  readingContextSyncStatus,
  selectableCount,
  selectedCount,
  worksheetRequesting,
}: {
  allVisibleSelected: boolean;
  busy: boolean;
  curriculumStage: ReadingCurriculumStage;
  loading: boolean;
  onCreateWorksheet: () => void;
  onCurriculumStageChange: (value: ReadingCurriculumStage) => void;
  onQueueWords: () => void;
  onToggleVisible: () => void;
  purpose: WrongWordSelectionPurpose;
  queueing: boolean;
  readingContextSyncStatus: ReadingContextSyncStatus;
  selectableCount: number;
  selectedCount: number;
  worksheetRequesting: boolean;
}) {
  const copy = adminStudentsText.learning.wrongWordsPanel;

  return (
    <div className={styles.selectionBar}>
      {purpose === "worksheet" && (
        <Field as="label" className={styles.curriculumField}>
          <FieldLabel as="span">{copy.readingCurriculum}</FieldLabel>
          <Select
            disabled={loading || busy}
            onChange={(event) =>
              onCurriculumStageChange(
                event.target.value as ReadingCurriculumStage,
              )
            }
            value={curriculumStage}
          >
            {readingCurriculumStages.map((stage) => (
              <option key={stage} value={stage}>
                {readingCurriculumStageLabel(stage)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Button
        disabled={loading || busy || selectableCount === 0}
        onClick={onToggleVisible}
        size="small"
        variant="quiet"
      >
        {allVisibleSelected ? copy.clearVisible : copy.selectVisible}
      </Button>
      <span aria-live="polite" className={styles.selectedCount}>
        {formatContentText(copy.selectedCount, { count: selectedCount })}
      </span>
      <div className={styles.selectionActions}>
        {purpose === "worksheet" ? (
          <Button
            aria-busy={worksheetRequesting}
            disabled={
              loading || busy || selectedCount === 0 || selectedCount > 50
            }
            onClick={onCreateWorksheet}
            size="small"
          >
            {worksheetRequesting
              ? copy.worksheetPending
              : copy.addToWorksheet}
          </Button>
        ) : (
          <Button
            aria-busy={queueing}
            disabled={loading || busy || selectedCount === 0}
            onClick={onQueueWords}
            size="small"
            variant="primary"
          >
            {queueing ? copy.queuePending : copy.addToNextExam}
          </Button>
        )}
      </div>
      {purpose === "worksheet" && (
        <StatusBadge
          className={styles.readingContextStatus}
          tone={
            readingContextSyncStatus === "synced"
              ? "success"
              : readingContextSyncStatus === "failed"
                ? "danger"
                : "neutral"
          }
        >
          {copy.readingContextStatus[readingContextSyncStatus]}
        </StatusBadge>
      )}
    </div>
  );
}
