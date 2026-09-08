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
import { useAssignmentDatasetPicker } from "../client/controllers/use-assignment-dataset-picker";
import {
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "../controller/use-vocab-assignment-screen";
import { useDirectReviewAssignmentController } from "../controller/use-direct-review-assignment-controller";
import { useAssignmentDatasetUnitCatalog } from "../controller/use-assignment-dataset-unit-catalog";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import { AssignmentDatasetPicker } from "./assignment-dataset-picker";
import { AssignmentDiscardDialog } from "./assignment-discard-dialog";
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
  interactionAllowed = true,
  onClose,
  onSuccess,
  selectionMode,
  students,
}: {
  bulkFilterLabels?: readonly string[];
  data: VocabAssignmentScreenData;
  initialDatasetId?: string;
  interactionAllowed?: boolean;
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
  const unitCatalog = useAssignmentDatasetUnitCatalog(data.units, initialDatasetId);
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
  const selectedDatasetId = assignmentPurpose === "range"
    ? controller.planner.datasetId
    : reviewController.draft.datasetId;
  const datasetPicker = useAssignmentDatasetPicker({
    options: assignmentPurpose === "range"
      ? controller.readyDatasets.map((dataset) => ({ dataset }))
      : reviewController.datasetOptions.map(({ dataset, count }) => ({ dataset, reviewCount: count })),
    selectedId: selectedDatasetId,
    onSelect: assignmentPurpose === "range"
      ? controller.actions.changeDataset
      : reviewController.actions.changeDataset,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardConfirmedRef = useRef(false);
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
    if (!interactionAllowed || busy || discardOpen) return;
    if (datasetPicker.open) {
      datasetPicker.actions.close();
      return;
    }
    const draftChanged =
      rangeDraftSignature !== initialRangeDraftSignatureRef.current ||
      reviewDraftSignature !== initialReviewDraftSignatureRef.current;
    if (draftChanged) {
      discardConfirmedRef.current = false;
      setDiscardOpen(true);
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
    if (!interactionAllowed || busy || discardOpen) return;
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
    <>
    <DialogFrame
      aria-labelledby="vocab-assignment-plan-title"
      closeDisabled={busy}
      height="large"
      layout={datasetPicker.open ? "body" : "body-footer"}
      onRequestClose={requestClose}
      size="extra-wide"
    >
      <DialogHeader
        backLabel="배정 조건으로 돌아가기"
        closeLabel={datasetPicker.open ? "선택 취소" : "닫기"}
        onBack={datasetPicker.open ? datasetPicker.actions.close : undefined}
      >
        <div>
          <h2 id="vocab-assignment-plan-title">
            {datasetPicker.open ? "단어장 찾기" : selectionMode === "bulk" ? "일괄 배정" : "단일 배정"}
          </h2>
          {datasetPicker.open ? <p>단어장을 선택하면 배정 조건으로 돌아갑니다.</p> : selectionMode === "bulk" ? (
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
        {datasetPicker.open ? (
          <AssignmentDatasetPicker
            filters={datasetPicker.filters}
            buttons={datasetPicker.buttons}
            recent={datasetPicker.groups.recent}
            remaining={datasetPicker.groups.remaining}
            resultCount={datasetPicker.resultCount}
            selectedId={selectedDatasetId}
            searchRef={datasetPicker.searchRef}
            onQuery={datasetPicker.actions.changeQuery}
            onStage={datasetPicker.actions.changeStage}
            onKind={datasetPicker.actions.changeKind}
            onGrade={datasetPicker.actions.changeGrade}
            onSchool={datasetPicker.actions.changeSchool}
            onClear={datasetPicker.actions.clear}
            onSelect={datasetPicker.actions.choose}
            reviewOnly={assignmentPurpose === "review"}
          />
        ) : null}
        <div hidden={datasetPicker.open}>
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
                onOpenDatasetPicker={datasetPicker.actions.open}
                datasetTriggerRef={datasetPicker.triggerRef}
                student={students[0]!}
              />
            ) : (
              <VocabRangeAssignmentSections
                busy={busy}
                controller={controller}
                fieldErrors={visibleErrors}
                onOpenDatasetPicker={datasetPicker.actions.open}
                datasetTriggerRef={datasetPicker.triggerRef}
                unitLoadState={unitCatalog.state}
                onRetryUnits={() =>
                  void unitCatalog.actions.retry()
                }
                students={students}
              />
            )}
          </AssignmentEditorPanel>
        </AssignmentEditorForm>
        </div>
      </DialogBody>
      {!datasetPicker.open ? (
      <DialogFooter>
        <div className={styles.submitRow}>
          <AssignmentSubmitAction
            blockedReason={null}
            canSubmit={
              interactionAllowed &&
              !busy &&
              !discardOpen &&
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
      ) : null}
    </DialogFrame>
    {discardOpen ? (
      <AssignmentDiscardDialog
        busy={busy}
        onCancel={() => {
          if (!busy) setDiscardOpen(false);
        }}
        onDiscard={() => {
          if (busy || discardConfirmedRef.current) return;
          discardConfirmedRef.current = true;
          setDiscardOpen(false);
          onClose();
        }}
      />
    ) : null}
    </>
  );
}
