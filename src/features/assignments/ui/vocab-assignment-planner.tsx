"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { GuardedLink } from "@/components/guarded-link";
import { useRouteExitGuard } from "@/components/use-route-exit-guard";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { hasRequiredStudentProfile, STUDENT_PROFILE_REQUIRED_MESSAGE } from "@/lib/admin/student-profile-requirements";
import { assignmentStudentContext } from "../domain/assignment-student-context";

import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import type { AssignmentGradeReview } from "../contracts/assignment-grade-review";
import { AssignmentGradeDialog } from "./assignment-grade-dialog";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { prefersReducedMotion } from "@/lib/ui/motion";

import type { AssignmentStudentItem, AssignmentDatasetItem } from "../catalog-types";
import { WordbookLibrary } from "@/features/wordbook-compositions/public-ui";
import type { CreatedLibraryBook } from "@/features/wordbook-compositions/public-contracts";
import { useAssignmentDatasetPicker } from "../client/controllers/use-assignment-dataset-picker";
import {
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "../controller/use-vocab-assignment-screen";
import { useDirectReviewAssignmentController } from "../controller/use-direct-review-assignment-controller";
import { useMixedMistakeAssignmentController } from "../controller/use-mixed-mistake-assignment-controller";
import { MixedMistakeAssignmentSections } from "./mixed-mistake-assignment-sections";
import { useAssignmentDatasetUnitCatalog } from "../controller/use-assignment-dataset-unit-catalog";
import { useAssignmentDatasetMetadata, type RefreshDatasetMetadata } from "../controller/use-assignment-dataset-metadata";
import { useAssignmentAuthenticationFailure } from "../controller/assignment-authentication-boundary";
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

export function VocabAssignmentPlanner(props: Parameters<typeof VocabAssignmentPlannerSession>[0]) {
  return <VocabAssignmentPlannerSession key={`${props.selectionMode}:${props.students.map(student => student.id).join(',')}`} {...props} />;
}

function VocabAssignmentPlannerSession({
  bulkFilterLabels = [],
  data,
  initialDatasetId = "",
  interactionAllowed = true,
  refreshDatasetMetadata,
  onClose,
  onSuccess,
  selectionMode,
  students,
}: {
  bulkFilterLabels?: readonly string[];
  data: VocabAssignmentScreenData;
  initialDatasetId?: string;
  interactionAllowed?: boolean;
  refreshDatasetMetadata?: RefreshDatasetMetadata;
  onClose: () => void;
  onSuccess: (
    assignmentCount: number,
    studentCount: number,
    queuedCount: number,
  ) => void;
  selectionMode: "single" | "bulk";
  students: readonly AssignmentStudentItem[];
}) {
  const captureAuthenticationFailure = useAssignmentAuthenticationFailure();
  const [assignmentPurpose, setAssignmentPurpose] = useState<"range" | "review" | "mixed">(
    "range",
  );
  const [composedDatasets, setComposedDatasets] = useState<AssignmentDatasetItem[]>([]);
  const displayedCatalog = useAssignmentDatasetMetadata(
    [...data.datasets.filter(book => !composedDatasets.some(updated => updated.id === book.id)), ...composedDatasets],
    interactionAllowed, refreshDatasetMetadata,
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStarted, setComposerStarted] = useState(false);
  const [composerLocked, setComposerLocked] = useState(false);
  const [composerDirty, setComposerDirty] = useState(false);
  const unitCatalog = useAssignmentDatasetUnitCatalog(data.units, initialDatasetId);
  const cancelUnitRequest = unitCatalog.actions.cancel;
  const ensureDatasetUnits = unitCatalog.actions.ensureDataset;
  const controller = useVocabAssignmentScreen({
    audienceMode: selectionMode,
    data: { ...data, datasets: displayedCatalog.datasets, units: unitCatalog.units },
    enabled: interactionAllowed && assignmentPurpose === "range",
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    students,
  });
  const mixedController = useMixedMistakeAssignmentController({
    audienceMode: selectionMode,
    student: selectionMode === "single" && students.length === 1 ? students[0]! : null,
    datasets: controller.readyDatasets, units: unitCatalog.units, unitLoadState: unitCatalog.state,
    enabled: interactionAllowed && assignmentPurpose === "mixed", initialDatasetId,
  });
  const activeRangeDatasetId = assignmentPurpose === "mixed" ? mixedController.datasetId : controller.planner.datasetId;
  useEffect(() => {
    if (!interactionAllowed || assignmentPurpose === "review") {
      cancelUnitRequest();
      return;
    }
    void ensureDatasetUnits(activeRangeDatasetId);
  }, [
    assignmentPurpose,
    cancelUnitRequest,
    activeRangeDatasetId,
    ensureDatasetUnits,
    interactionAllowed,
  ]);
  const reviewController = useDirectReviewAssignmentController({
    datasets: controller.readyDatasets,
    enabled: interactionAllowed && assignmentPurpose === "review",
    initialDatasetId,
    student: students[0]!,
  });
  const selectedDatasetId = assignmentPurpose === "range"
    ? controller.planner.datasetId
    : assignmentPurpose === "mixed" ? mixedController.datasetId : reviewController.draft.datasetId;
  const studentContext = assignmentStudentContext(controller.selectedStudents);
  const incompleteStudents = controller.selectedStudents.filter(student => !hasRequiredStudentProfile(student));
  const datasetPicker = useAssignmentDatasetPicker({
    contextKey: studentContext.key,
    initialFilters: studentContext.filters,
    options: assignmentPurpose === "range"
      ? controller.readyDatasets.map((dataset) => ({ dataset }))
      : assignmentPurpose === "mixed" ? mixedController.datasetOptions.map(dataset => ({ dataset }))
        : reviewController.datasetOptions.map(({ dataset, count }) => ({ dataset, reviewCount: count })),
    selectedId: selectedDatasetId,
    onSelect: assignmentPurpose === "range"
      ? controller.actions.changeDataset
      : assignmentPurpose === "mixed" ? mixedController.onDatasetChange : reviewController.actions.changeDataset,
  });
  function receiveCreatedBook(book: CreatedLibraryBook) {
    setComposedDatasets(current => [...current.filter(d => d.id !== book.dataset.id), { ...book.dataset, vocabularyRole: "composition" }]);
    controller.actions.changeDataset(book.dataset.id);
    datasetPicker.actions.rememberSelection(book.dataset.id);
    datasetPicker.actions.close();
    setComposerOpen(false); setComposerStarted(false); setComposerLocked(false); setComposerDirty(false);
  }
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [gradeReview, setGradeReview] = useState<AssignmentGradeReview | null>(null);
  const discardConfirmedRef = useRef(false);
  const bulk = controller.bulk;
  const busy = assignmentPurpose === "range"
    ? bulk.state.submission.status === "submitting"
    : assignmentPurpose === "mixed" ? mixedController.busy : reviewController.submitting;
  const uncertain = assignmentPurpose === "range"
    ? bulk.state.submission.status === "uncertain" : assignmentPurpose === "mixed" ? mixedController.uncertain : reviewController.uncertain;
  const editingLocked = busy || uncertain || (assignmentPurpose === "range"
    ? bulk.state.submission.status === "succeeded" : assignmentPurpose === "mixed" ? mixedController.succeeded : reviewController.succeeded);
  const recoveryPendingRef = useRef(false);
  const successHandledRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const exitGuard = useRouteExitGuard({
    // Keep the guard armed until the success continuation removes its history
    // entry; a succeeded render can commit before the awaited handler resumes.
    busy: editingLocked,
    dirty: false,
    idPrefix: "assignment-save",
    confirmMessage: "먼저 저장 결과를 확인해 주세요.",
  });
  const reviewCalculationPending = assignmentPurpose === "review" &&
    reviewController.calculationPending;
  const reviewCalculationFailed = assignmentPurpose === "review" && (
    reviewController.summary.status === "error" ||
    reviewController.capacity.status === "error"
  );
  const reviewSelectionBlocked = assignmentPurpose === "review" &&
    reviewController.capacity.status === "ready" &&
    (!reviewController.exclusionConfirmed || reviewController.capacity.value.wrongEligible === 0);
  const rangeCalculationPending = assignmentPurpose === "range" &&
    bulk.previewLoading;
  const mixedCalculationBlocked = assignmentPurpose === "mixed" && (mixedController.calculationPending ||
    mixedController.preview.status === "error" || Boolean(mixedController.value && !mixedController.canSubmit));
  const visibleErrors = submitAttempted ? controller.fieldErrors : {};
  const visibleReviewErrors = submitAttempted
    ? reviewController.fieldErrors
    : {};
  const formRef = useRef<HTMLFormElement>(null);
  const excludedUndoRef = useRef<HTMLButtonElement>(null);
  const previousExcludedCountRef = useRef(controller.excludedStudentCount);
  useEffect(() => {
    if (previousExcludedCountRef.current === controller.excludedStudentCount) return;
    previousExcludedCountRef.current = controller.excludedStudentCount;
    const target = controller.excludedStudentCount > 0 ? excludedUndoRef.current : datasetPicker.triggerRef.current;
    const frame = window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [controller.excludedStudentCount, datasetPicker.triggerRef]);
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
  const mixedDraftSignature = JSON.stringify(mixedController.draft);
  const initialMixedDraftSignatureRef = useRef(mixedDraftSignature);
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
    if (!interactionAllowed || editingLocked || discardOpen || gradeReview) return;
    if (composerOpen) {
      if (!composerLocked) {
        setComposerOpen(false);
        requestAnimationFrame(() => datasetPicker.searchRef.current?.focus());
      }
      return;
    }
    if (datasetPicker.open) {
      datasetPicker.actions.close();
      return;
    }
    const draftChanged =
      composerDirty ||
      rangeDraftSignature !== initialRangeDraftSignatureRef.current ||
      reviewDraftSignature !== initialReviewDraftSignatureRef.current ||
      mixedDraftSignature !== initialMixedDraftSignatureRef.current;
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
        : assignmentPurpose === "mixed" ? mixedController.firstFieldKey : reviewController.firstFieldKey
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
    if (!interactionAllowed || editingLocked || discardOpen || gradeReview || incompleteStudents.length) return;
    setSubmitAttempted(true);
    const canSubmit = assignmentPurpose === "range"
      ? controller.canSubmit
      : assignmentPurpose === "mixed" ? mixedController.canSubmit : reviewController.canSubmit;
    if (!canSubmit) {
      focusFirstInvalidField();
      return;
    }
    const review = bulk.preview?.gradeReview;
    if (assignmentPurpose === "range" && selectionMode === "bulk" && review && review.mismatches.length > 0) {
      setGradeReview(review);
      return;
    }
    await submitReady();
  }

  async function submitReady(gradeReviewToken?: string) {
    if (!interactionAllowed || editingLocked || discardOpen || incompleteStudents.length) return;
    if (gradeReviewToken && !isCurrentGradeReview(gradeReviewToken)) return;
    setGradeReview(null);
    const outcome = assignmentPurpose === "range"
      ? await controller.actions.submitPlan(gradeReviewToken)
      : assignmentPurpose === "mixed" ? await mixedController.submit() : await reviewController.actions.submit();
    if (!mountedRef.current) return;
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
    if (successHandledRef.current) return;
    successHandledRef.current = true;
    exitGuard.forceExit(() => {
      if (!mountedRef.current) return false;
      if (assignmentPurpose === "range") {
        const result = outcome.result as {
          assignmentCount: number;
          studentCount: number;
          queuedCount: number;
        };
        onSuccess(result.assignmentCount, result.studentCount, result.queuedCount);
      } else {
        const result = outcome.result;
        onSuccess("kind" in result && result.kind === "mistake_batch" ? result.assignments.length : 1, 1, 0);
      }
      onClose();
    });
  }

  async function recoverSavedPlan() {
    if (!interactionAllowed || busy || !uncertain || recoveryPendingRef.current || successHandledRef.current) return;
    recoveryPendingRef.current = true;
    try {
      const outcome = assignmentPurpose === "range"
        ? await controller.actions.recoverPlan()
        : assignmentPurpose === "mixed" ? await mixedController.recover() : await reviewController.actions.recoverSubmission();
      if (!mountedRef.current) return;
      if (!outcome.ok) { toast.error(outcome.message); return; }
      successHandledRef.current = true;
      exitGuard.forceExit(() => {
        if (!mountedRef.current) return false;
        const result = outcome.result;
        if ("assignmentCount" in result) onSuccess(result.assignmentCount, result.studentCount, result.queuedCount);
        else onSuccess("kind" in result && result.kind === "mistake_batch" ? result.assignments.length : 1, 1, 0);
        onClose();
      });
    } finally {
      recoveryPendingRef.current = false;
    }
  }

  function isCurrentGradeReview(token: string) {
    if (controller.canSubmit && bulk.preview?.gradeReview?.token === token) return true;
    setGradeReview(null);
    toast.error("학생이나 단어장 정보가 바뀌었습니다. 다시 확인해 주세요.");
    return false;
  }

  const canSubmit = assignmentPurpose === "range"
    ? controller.canSubmit
    : assignmentPurpose === "mixed" ? mixedController.canSubmit : reviewController.canSubmit;
  const reviewAssignmentAvailable =
    selectionMode === "single" && students.length === 1;
  const singleStudent = selectionMode === "single" ? students[0] ?? null : null;
  const headerDetail = singleStudent
    ? `${singleStudent.displayName} · ${singleStudent.schoolName || "학교 미입력"}`
    : `${controller.selectedStudents.length}명 선택`;
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
    {
      controls: "vocab-assignment-mixed-panel", id: "vocab-assignment-mixed-tab", label: "범위+오답", value: "mixed" as const,
      disabled: !reviewAssignmentAvailable, describedBy: !reviewAssignmentAvailable ? "review-assignment-unavailable" : undefined,
    },
  ];

  return (
    <>
    <DialogFrame
      aria-labelledby="vocab-assignment-plan-title"
      closeDisabled={editingLocked || composerLocked}
      height="large"
      layout={datasetPicker.open ? "body" : "body-footer"}
      onRequestClose={requestClose}
      size="extra-wide"
    >
      <DialogHeader
        backLabel={composerOpen ? "단어장 찾기로 돌아가기" : "배정 조건으로 돌아가기"}
        closeLabel={datasetPicker.open ? "선택 취소" : "닫기"}
        onBack={datasetPicker.open ? requestClose : undefined}
      >
        <div>
          <h2 id="vocab-assignment-plan-title">
            {composerOpen ? "단어장과 템플릿" : datasetPicker.open ? "단어장 찾기" : selectionMode === "bulk" ? "일괄 배정" : "단일 배정"}
          </h2>
          {datasetPicker.open ? <p>{composerOpen ? "시험에 넣을 범위를 담아 주세요." : "단어장을 골라주세요."}</p> : selectionMode === "bulk" ? (
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
        {composerStarted ? <div hidden={!composerOpen}>
          <WordbookLibrary key={studentContext.key} initialTarget={studentContext.target} active={composerOpen} enabled={composerOpen && interactionAllowed && !editingLocked} captureAuthenticationFailure={captureAuthenticationFailure} onSaved={receiveCreatedBook} onLibraryChanged={displayedCatalog.refreshMetadata} onBack={requestClose} onLockChange={setComposerLocked} onDirtyChange={setComposerDirty} />
        </div> : null}
        {datasetPicker.open && !composerOpen ? (
          <>
          {assignmentPurpose === "range" ? <Button disabled={editingLocked || !interactionAllowed} onClick={() => { if (editingLocked || !interactionAllowed) return; setComposerStarted(true); setComposerOpen(true); }}>템플릿 찾기·범위로 새로 만들기</Button> : null}
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
            onSemester={datasetPicker.actions.changeSemester}
            onClear={datasetPicker.actions.clear}
            onSelect={datasetPicker.actions.choose}
            reviewOnly={assignmentPurpose === "review"}
          />
          </>
        ) : null}
        <div hidden={datasetPicker.open}>
        <AssignmentEditorForm
          busy={editingLocked}
          formId="vocab-assignment-plan-form"
          formRef={formRef}
          legend="단어 시험 배정 조건"
          onSubmit={submit}
        >
          {incompleteStudents.length ? <Notice tone="danger" role="alert">
            <p>{STUDENT_PROFILE_REQUIRED_MESSAGE}</p>
            {incompleteStudents.map(student => <p key={student.id}><GuardedLink href={`/admin/students/${student.id}`} prefetch={false}>
              {student.displayName || "학생"} 정보 수정
            </GuardedLink></p>)}
          </Notice> : null}
          <AssignmentEditorModeTabs
            ariaLabel="시험 종류"
            items={purposeTabs}
            onChange={(purpose) => {
              if (editingLocked) return;
              setAssignmentPurpose(purpose);
              setSubmitAttempted(false);
            }}
            value={assignmentPurpose}
          />
          {controller.excludedStudentCount > 0 ? <div className={styles.gradeNotice} role="status">
            <span>학년이 다른 {controller.excludedStudentCount}명을 이번 배정에서 제외했습니다.</span>
            <Button disabled={editingLocked} ref={excludedUndoRef} onClick={controller.actions.restoreExcludedStudents}>제외 되돌리기</Button>
          </div> : null}
          {controller.selectedStudents.length === 0 ? <p role="alert">배정할 학생을 선택해 주세요.</p> : null}
          {!reviewAssignmentAvailable ? (
            <p
              className={styles.assignmentKindHint}
              id="review-assignment-unavailable"
            >
              오답 시험과 범위+오답은 단일 배정에서만 사용할 수 있습니다.
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
                onOpenDatasetPicker={() => { if (interactionAllowed && !editingLocked) datasetPicker.actions.open(); }}
                datasetTriggerRef={datasetPicker.triggerRef}
                student={students[0]!}
              />
            ) : assignmentPurpose === "mixed" ? (
              <MixedMistakeAssignmentSections controller={mixedController} units={unitCatalog.units} showErrors={submitAttempted}
                datasetTriggerRef={datasetPicker.triggerRef} onOpenDatasetPicker={() => { if (interactionAllowed && !editingLocked) datasetPicker.actions.open(); }}
                unitLoadState={unitCatalog.state} onRetryUnits={() => void unitCatalog.actions.retry()} />
            ) : (
              <VocabRangeAssignmentSections
                busy={editingLocked}
                controller={controller}
                fieldErrors={visibleErrors}
                onOpenDatasetPicker={() => { if (interactionAllowed && !editingLocked) datasetPicker.actions.open(); }}
                datasetTriggerRef={datasetPicker.triggerRef}
                unitLoadState={unitCatalog.state}
                onRetryUnits={() =>
                  void unitCatalog.actions.retry()
                }
                students={controller.selectedStudents}
              />
            )}
          </AssignmentEditorPanel>
        </AssignmentEditorForm>
        </div>
      </DialogBody>
      {!datasetPicker.open ? (
      <DialogFooter>
        {uncertain ? <Notice tone="danger" role="alert">
          <p>저장 결과를 확인하지 못했습니다. 창을 닫지 말고 같은 요청으로 다시 확인해 주세요.</p>
          <Button disabled={!interactionAllowed || busy} onClick={() => void recoverSavedPlan()}>저장 결과 다시 확인</Button>
        </Notice> : null}
        <div className={styles.submitRow}>
          <AssignmentSubmitAction
            blockedReason={null}
            canSubmit={
              interactionAllowed &&
              !editingLocked &&
              !discardOpen &&
              !gradeReview &&
              incompleteStudents.length === 0 &&
              controller.selectedStudents.length > 0 &&
              !rangeCalculationPending &&
              !reviewCalculationPending &&
              !reviewCalculationFailed &&
              !reviewSelectionBlocked &&
              !mixedCalculationBlocked &&
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
    {gradeReview ? <AssignmentGradeDialog
      busy={busy}
      datasetGrade={gradeReview.datasetGrade}
      students={gradeReview.mismatches}
      unknownCount={gradeReview.unknownStudentIds.length}
      onCancel={() => setGradeReview(null)}
      onExclude={() => {
        if (!interactionAllowed || busy || !isCurrentGradeReview(gradeReview.token)) return;
        controller.actions.excludeStudents(gradeReview.mismatches.map(s => s.studentId));
        setGradeReview(null);
        setSubmitAttempted(false);
      }}
      onInclude={() => void submitReady(gradeReview.token)}
    /> : null}
    {discardOpen ? (
      <AssignmentDiscardDialog
        busy={editingLocked}
        onCancel={() => {
          if (!editingLocked) setDiscardOpen(false);
        }}
        onDiscard={() => {
          if (editingLocked || discardConfirmedRef.current) return;
          discardConfirmedRef.current = true;
          setDiscardOpen(false);
          onClose();
        }}
      />
    ) : null}
    </>
  );
}
