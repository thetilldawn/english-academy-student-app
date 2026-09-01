"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

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
import { useAssignmentDatasetUnitCatalog } from "../controller/use-assignment-dataset-unit-catalog";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import {
  AssignmentEditorForm,
  AssignmentEditorModeTabs,
  AssignmentEditorPanel,
} from "./assignment-editor-shell";
import { DirectReviewAssignmentSections } from "./direct-review-assignment-sections";
import { resolveInvalidAssignmentFieldFocusTarget } from "./focus-invalid-assignment-field";
import { VocabRangeAssignmentSections } from "./vocab-range-assignment-sections";
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
  const unitCatalog = useAssignmentDatasetUnitCatalog(data.units);
  const cancelUnitRequest = unitCatalog.actions.cancel;
  const ensureDatasetUnits = unitCatalog.actions.ensureDataset;
  const controller = useVocabAssignmentScreen({
    data: { ...data, units: unitCatalog.units },
    enabled: assignmentPurpose === "range",
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    students,
  });
  useEffect(() => {
    if (assignmentPurpose !== "range") {
      cancelUnitRequest();
      return;
    }
    void ensureDatasetUnits(controller.planner.datasetId);
  }, [
    assignmentPurpose,
    cancelUnitRequest,
    controller.planner.datasetId,
    ensureDatasetUnits,
  ]);
  const reviewController = useDirectReviewAssignmentController({
    datasets: controller.readyDatasets,
    enabled: assignmentPurpose === "review",
    initialDatasetId,
    student: students[0]!,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const bulk = controller.bulk;
  const busy = assignmentPurpose === "range"
    ? bulk.state.submission.status === "submitting"
    : reviewController.submitting;
  const reviewCalculationPending = assignmentPurpose === "review" &&
    reviewController.calculationPending;
  const reviewCalculationFailed = assignmentPurpose === "review" && (
    reviewController.summary.status === "error" ||
    reviewController.capacity.status === "error"
  );
  const rangeCalculationPending = assignmentPurpose === "range" &&
    bulk.previewLoading;
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

  function focusFirstInvalidField(requestedKey?: string | null) {
    const key = requestedKey === undefined
      ? assignmentPurpose === "range"
        ? controller.firstFieldKey
        : reviewController.firstFieldKey
      : requestedKey;
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
      if (assignmentPurpose === "review") {
        focusFirstInvalidField(
          "fieldKey" in outcome && typeof outcome.fieldKey === "string"
            ? outcome.fieldKey
            : null,
        );
      } else {
        focusFirstInvalidField();
      }
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
  const reviewAssignmentAvailable =
    selectionMode === "single" && students.length === 1;
  const singleStudent = selectionMode === "single" ? students[0] ?? null : null;
  const headerDetail = singleStudent
    ? `${singleStudent.displayName} · ${singleStudent.schoolName || "학교 미입력"}`
    : `${students.length}명 선택`;
  const purposeTabs = [
    {
      controls: "vocab-assignment-range-panel",
      id: "vocab-assignment-range-tab",
      label: "단어 시험",
      value: "range" as const,
    },
    {
      controls: "vocab-assignment-review-panel",
      describedBy: !reviewAssignmentAvailable
        ? "review-assignment-unavailable"
        : undefined,
      disabled: !reviewAssignmentAvailable,
      id: "vocab-assignment-review-tab",
      label: "오답 시험",
      value: "review" as const,
    },
  ];

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
        <AssignmentEditorForm
          busy={busy}
          formId="vocab-assignment-plan-form"
          formRef={formRef}
          legend="단어 시험 배정 조건"
          onSubmit={submit}
        >
          <AssignmentEditorModeTabs
            ariaLabel="시험 종류"
            items={purposeTabs}
            onChange={(purpose) => {
              setAssignmentPurpose(purpose);
              setSubmitAttempted(false);
            }}
            value={assignmentPurpose}
          />
          {!reviewAssignmentAvailable ? (
            <p
              className={styles.assignmentKindHint}
              id="review-assignment-unavailable"
            >
              오답 시험은 단일 배정에서만 사용할 수 있습니다.
            </p>
          ) : null}
          <AssignmentEditorPanel
            key={assignmentPurpose}
            labelledBy={`vocab-assignment-${assignmentPurpose}-tab`}
            panelId={`vocab-assignment-${assignmentPurpose}-panel`}
          >
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
                unitLoadState={unitCatalog.state}
                onRetryUnits={() =>
                  void unitCatalog.actions.retry()
                }
                students={students}
              />
            )}
          </AssignmentEditorPanel>
        </AssignmentEditorForm>
      </DialogBody>
      <DialogFooter>
        <div className={styles.submitRow}>
          <AssignmentSubmitAction
            blockedReason={null}
            canSubmit={
              !busy &&
              !rangeCalculationPending &&
              !reviewCalculationPending &&
              !reviewCalculationFailed &&
              (!submitAttempted || canSubmit)
            }
            formId="vocab-assignment-plan-form"
            label={busy ? "배정 중…" : "배정하기"}
            pending={busy}
          />
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
