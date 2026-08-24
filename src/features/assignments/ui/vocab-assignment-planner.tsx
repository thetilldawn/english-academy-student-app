"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { prefersReducedMotion } from "@/lib/ui/motion";

import type { AssignmentStudentItem } from "../catalog-types";
import {
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "../controller/use-vocab-assignment-screen";
import { useDirectReviewAssignmentController } from "../controller/use-direct-review-assignment-controller";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import { DirectReviewAssignmentSections } from "./direct-review-assignment-sections";
import { resolveInvalidAssignmentFieldFocusTarget } from "./focus-invalid-assignment-field";
import { VocabRangeAssignmentSections } from "./vocab-range-assignment-sections";
import editorStyles from "./bulk-assignment-editor.module.css";
import styles from "./vocab-assignment-planner.module.css";

export function VocabAssignmentPlanner({
  bulkFilterLabels = [],
  data,
  initialDatasetId = "",
  onClose,
  onSuccess,
  selectionMode,
  students,
}: {
  bulkFilterLabels?: readonly string[];
  data: VocabAssignmentScreenData;
  initialDatasetId?: string;
  onClose: () => void;
  onSuccess: (
    assignmentCount: number,
    studentCount: number,
    queuedCount: number,
  ) => void;
  selectionMode: "single" | "bulk";
  students: readonly AssignmentStudentItem[];
}) {
  const [assignmentPurpose, setAssignmentPurpose] = useState<"range" | "review">(
    "range",
  );
  const controller = useVocabAssignmentScreen({
    data,
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    students,
  });
  const reviewController = useDirectReviewAssignmentController({
    datasets: controller.readyDatasets,
    enabled: assignmentPurpose === "review",
    initialDatasetId,
    student: students[0]!,
    units: data.units,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const bulk = controller.bulk;
  const busy = assignmentPurpose === "range"
    ? bulk.state.submission.status === "submitting"
    : reviewController.submitting;
  const reviewCalculationPending = assignmentPurpose === "review" &&
    reviewController.calculationPending;
  const visibleErrors = submitAttempted ? controller.fieldErrors : {};
  const visibleReviewErrors = submitAttempted
    ? reviewController.fieldErrors
    : {};
  const formRef = useRef<HTMLFormElement>(null);
  const rangeDraftSignature = JSON.stringify({
    exam: bulk.state.draft,
    planner: controller.planner,
  });
  const reviewDraftSignature = JSON.stringify({
    ...reviewController.draft,
    questionCount: 0,
  });
  const initialRangeDraftSignatureRef = useRef(rangeDraftSignature);
  const initialReviewDraftSignatureRef = useRef(reviewDraftSignature);
  useEffect(() => {
    if (
      reviewController.summary.status === "ready" &&
      !reviewController.userEdited
    ) {
      initialReviewDraftSignatureRef.current = reviewDraftSignature;
    }
  }, [
    reviewController.summary.status,
    reviewController.userEdited,
    reviewDraftSignature,
  ]);
  function requestClose() {
    if (busy) return;
    const draftChanged =
      rangeDraftSignature !== initialRangeDraftSignatureRef.current ||
      reviewDraftSignature !== initialReviewDraftSignatureRef.current;
    if (
      draftChanged &&
      !window.confirm("입력한 배정 내용을 버리고 닫을까요?")
    ) {
      return;
    }
    onClose();
  }

  function focusFirstInvalidField() {
    const key = assignmentPurpose === "range"
      ? controller.firstFieldKey
      : reviewController.firstFieldKey;
    if (!key) return;
    window.requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(
        `[data-field-key="${key}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      const focusTarget = resolveInvalidAssignmentFieldFocusTarget(target);
      focusTarget?.focus({ preventScroll: true });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    const canSubmit = assignmentPurpose === "range"
      ? controller.canSubmit
      : reviewController.canSubmit;
    if (!canSubmit) {
      focusFirstInvalidField();
      return;
    }
    const outcome = assignmentPurpose === "range"
      ? await controller.actions.submitPlan()
      : await reviewController.actions.submit();
    if (!outcome.ok) {
      toast.error(outcome.message);
      focusFirstInvalidField();
      return;
    }
    if (assignmentPurpose === "range") {
      const result = outcome.result as {
        assignmentCount: number;
        studentCount: number;
        queuedCount: number;
      };
      onSuccess(result.assignmentCount, result.studentCount, result.queuedCount);
    } else {
      onSuccess(1, 1, 0);
    }
    onClose();
  }

  const canSubmit = assignmentPurpose === "range"
    ? controller.canSubmit
    : reviewController.canSubmit;
  const singleStudent = selectionMode === "single" ? students[0] ?? null : null;
  const headerDetail = singleStudent
    ? `${singleStudent.displayName} · ${singleStudent.schoolName || "학교 미입력"}`
    : `${students.length}명 선택`;

  return (
    <DialogFrame
      aria-labelledby="vocab-assignment-plan-title"
      closeDisabled={busy}
      height="large"
      layout="body-footer"
      onRequestClose={requestClose}
      size="extra-wide"
    >
      <DialogHeader closeLabel="닫기">
        <div>
          <h2 id="vocab-assignment-plan-title">
            {selectionMode === "bulk" ? "일괄 배정" : "단일 배정"}
          </h2>
          {selectionMode === "bulk" ? (
            <MetaTagList>
              {(bulkFilterLabels.length > 0
                ? bulkFilterLabels
                : ["전체 학생"]
              ).map((label) => <MetaTag key={label}>{label}</MetaTag>)}
              <MetaTag>{headerDetail}</MetaTag>
            </MetaTagList>
          ) : (
            <p>{headerDetail}</p>
          )}
        </div>
      </DialogHeader>
      <DialogBody>
        <form
          aria-busy={busy}
          className={editorStyles.form}
          id="vocab-assignment-plan-form"
          noValidate
          onSubmit={submit}
          ref={formRef}
        >
          <fieldset className={editorStyles.fieldset} disabled={busy}>
            <legend className="sr-only">단어 시험 배정 조건</legend>
            <div
              aria-label="시험 종류"
              className={styles.assignmentKind}
              role="group"
            >
              <Button
                aria-pressed={assignmentPurpose === "range"}
                onClick={() => {
                  setAssignmentPurpose("range");
                  setSubmitAttempted(false);
                }}
                variant="filter"
              >
                단어 시험
              </Button>
              <Button
                aria-pressed={assignmentPurpose === "review"}
                disabled={students.length !== 1}
                onClick={() => {
                  setAssignmentPurpose("review");
                  setSubmitAttempted(false);
                }}
                title={students.length === 1
                  ? "학생의 미배정 오답만 시험으로 만듭니다."
                  : "오답 시험은 학생 한 명을 선택했을 때 배정할 수 있습니다."}
                variant="filter"
              >
                오답 시험
              </Button>
            </div>
            <div className={styles.assignmentPanel} key={assignmentPurpose}>
              {assignmentPurpose === "review" ? (
                <DirectReviewAssignmentSections
                  controller={reviewController}
                  datasets={controller.readyDatasets}
                  fieldErrors={visibleReviewErrors}
                  student={students[0]!}
                />
              ) : (
                <VocabRangeAssignmentSections
                  busy={busy}
                  controller={controller}
                  fieldErrors={visibleErrors}
                  students={students}
                />
              )}
            </div>
          </fieldset>
        </form>
      </DialogBody>
      <DialogFooter>
        <div className={styles.submitRow}>
          <AssignmentSubmitAction
            blockedReason={null}
            canSubmit={
              !busy &&
              !reviewCalculationPending &&
              (!submitAttempted || canSubmit)
            }
            formId="vocab-assignment-plan-form"
            label={busy ? "배정 중…" : "배정하기"}
          />
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
