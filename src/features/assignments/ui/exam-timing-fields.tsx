import {
  AssignmentFieldGrid,
  AssignmentTimingModeField,
} from "./assignment-editor-fields";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import type { ExamSettings, ExamTiming } from "../domain/model";
import styles from "./exam-timing-fields.module.css";

export function ExamTimingFields({
  error,
  exam,
  fieldKey = "timing",
  onEnabledChange,
  onModeChange,
  onTimingChange,
}: {
  error?: string;
  exam: ExamSettings;
  fieldKey?: string;
  onEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: ExamTiming["mode"]) => void;
  onTimingChange: (timing: ExamTiming) => void;
}) {
  const enabled = exam.timeLimitEnabled !== false;
  const errorId = error ? `${fieldKey}-error` : undefined;

  return (
    <div className={styles.root} data-field-key={fieldKey} tabIndex={-1}>
      <div className={styles.toggleRow}>
        <FieldLabel as="span">
          <HelpTip label="시간 제한 사용 설명" trigger="시간 제한 사용">
            시험 전체 또는 문제마다 제한 시간을 설정합니다.
          </HelpTip>
        </FieldLabel>
        <label className={styles.toggle}>
          <Checkbox
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span>사용</span>
        </label>
      </div>
      <ConditionalReveal open={enabled}>
        <AssignmentFieldGrid className={styles.revealContent}>
          <div className={styles.control}>
            <AssignmentTimingModeField
              helpAriaLabel={adminLearningText.controls.timing.helpAria}
              helpText={adminLearningText.assignmentModal.conditions.timingHelp}
              label={adminLearningText.assignmentModal.conditions.timingMode}
              mode={exam.timing.mode}
              onChange={onModeChange}
              perQuestionLabel={adminLearningText.controls.timing.perQuestion}
              totalLabel={adminLearningText.controls.timing.total}
            />
          </div>
          <Field as="label" className={styles.control}>
            <FieldLabel as="span">
              {exam.timing.mode === "total"
                ? adminLearningText.controls.timing.totalMinutes
                : adminLearningText.controls.timing.perQuestionSeconds}
            </FieldLabel>
            {exam.timing.mode === "total" ? (
              <Input
                aria-errormessage={errorId}
                aria-invalid={Boolean(error)}
                max={180}
                min={0.5}
                onChange={(event) =>
                  onTimingChange({
                    mode: "total",
                    totalSeconds: Number(event.target.value) * 60,
                  })
                }
                required={enabled}
                step={0.5}
                type="number"
                value={exam.timing.totalSeconds / 60}
              />
            ) : (
              <Input
                aria-errormessage={errorId}
                aria-invalid={Boolean(error)}
                max={600}
                min={5}
                onChange={(event) =>
                  onTimingChange({
                    mode: "per_question",
                    perQuestionSeconds: Number(event.target.value),
                  })
                }
                required={enabled}
                type="number"
                value={exam.timing.perQuestionSeconds}
              />
            )}
            {error ? <FieldError id={errorId}>{error}</FieldError> : null}
          </Field>
        </AssignmentFieldGrid>
      </ConditionalReveal>
    </div>
  );
}
