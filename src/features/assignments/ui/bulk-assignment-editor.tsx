"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AssignmentEditorLayout,
  AssignmentEditorSettings,
  AssignmentEditorSummary,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import { useBulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkReviewFields } from "./bulk-review-fields";
import { BulkSeriesFields } from "./bulk-series-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import styles from "./bulk-assignment-editor.module.css";

export function BulkAssignmentEditor({
  includePendingReview,
  students,
  onClose,
  onSuccess,
}: {
  includePendingReview: boolean;
  students: readonly { id: string; displayName: string }[];
  onClose: () => void;
  onSuccess: (assignmentCount: number) => void;
}) {
  const reactId = useId().replaceAll(":", "");
  const formId = `bulk-assignment-${reactId}`;
  const [initialDate] = useState(() =>
    isoToKoreanDateTimeLocal(new Date().toISOString()).slice(0, 10),
  );
  const controller = useBulkAssignmentController({
    firstAvailableDateKorean: initialDate,
    genericErrorMessage: adminLearningText.bulkAssignmentModal.saveError,
    includePendingReview,
    previewErrorMessage: adminLearningText.bulkAssignmentModal.previewError,
    studentIds: students.map((student) => student.id),
  });
  const busy = controller.state.submission.status === "submitting";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await controller.actions.submit();
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    onSuccess(outcome.result.assignments.length);
    onClose();
  }

  function close() {
    if (!busy) onClose();
  }

  return (
    <DialogFrame
      aria-labelledby="bulk-assignment-title"
      closeDisabled={busy}
      height="large"
      layout="body-footer"
      onRequestClose={close}
      size="extra-wide"
    >
      <DialogHeader closeLabel={adminLearningText.bulkAssignmentModal.close}>
        <div>
          <h2 className={inlineHelpClassName} id="bulk-assignment-title">
            <HelpTip
              label={adminLearningText.bulkAssignmentModal.autoRangeHelpAria}
              trigger={
                includePendingReview
                  ? adminLearningText.bulkAssignmentModal.withWrongTitle
                  : adminLearningText.bulkAssignmentModal.nextTitle
              }
            >
              {adminLearningText.bulkAssignmentModal.autoRangeHelp}
            </HelpTip>
          </h2>
          <p>
            {formatContentText(
              adminLearningText.bulkAssignmentModal.studentCount,
              { count: students.length },
            )}
          </p>
        </div>
      </DialogHeader>
      <DialogBody>
        <form
          aria-busy={busy}
          className={styles.form}
          id={formId}
          onSubmit={submit}
        >
          <fieldset className={styles.fieldset} disabled={busy}>
            <legend className="sr-only">
              {includePendingReview
                ? adminLearningText.bulkAssignmentModal.withWrongTitle
                : adminLearningText.bulkAssignmentModal.nextTitle}
            </legend>
            <AssignmentEditorLayout>
              <AssignmentEditorSettings>
                <BulkSeriesFields
                  controller={controller}
                  fieldIdPrefix={formId}
                />
                <BulkExamFields controller={controller} />
                <BulkReviewFields controller={controller} />
              </AssignmentEditorSettings>
              <AssignmentEditorSummary
                busy={controller.previewLoading}
                className={styles.previewSection}
              >
                <BulkSeriesPreview
                  controller={controller}
                  students={students}
                />
              </AssignmentEditorSummary>
            </AssignmentEditorLayout>
          </fieldset>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={!controller.canSubmit}
          form={formId}
          size="large"
          type="submit"
          variant="primary"
        >
          {busy
            ? adminLearningText.bulkAssignmentModal.submitting
            : formatContentText(
                adminLearningText.bulkAssignmentModal.submit,
                {
                  assignmentCount:
                    controller.preview?.assignmentCount ??
                    students.length *
                      controller.state.draft.range.sessionCount,
                  studentCount: students.length,
                },
              )}
        </Button>
      </DialogFooter>
    </DialogFrame>
  );
}
