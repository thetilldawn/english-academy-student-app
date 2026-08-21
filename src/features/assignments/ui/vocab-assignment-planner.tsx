"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { FieldLabel, Select } from "@/design-system/primitives/form/field";

import type { AssignmentStudentItem } from "../catalog-types";
import {
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "../controller/use-vocab-assignment-screen";
import {
  hasVocabAssignmentFieldError,
  hasVocabScheduleFieldError,
} from "../presentation/vocab-assignment-field-errors";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import {
  VocabQuestionFields,
  VocabRangeFields,
} from "./vocab-range-picker";
import { VocabScheduleFields } from "./vocab-schedule-fields";
import editorStyles from "./bulk-assignment-editor.module.css";
import styles from "./vocab-assignment-planner.module.css";

function previousSourceLabel(student: AssignmentStudentItem) {
  return [student.displayName, student.schoolName, student.gradeLabel]
    .filter(Boolean)
    .join(" · ");
}

export function VocabAssignmentPlanner({
  data,
  initialDatasetId = "",
  onClose,
  onSuccess,
  students,
}: {
  data: VocabAssignmentScreenData;
  initialDatasetId?: string;
  onClose: () => void;
  onSuccess: (
    assignmentCount: number,
    studentCount: number,
    queuedCount: number,
  ) => void;
  students: readonly AssignmentStudentItem[];
}) {
  const controller = useVocabAssignmentScreen({
    data,
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    students,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const bulk = controller.bulk;
  const busy = bulk.state.submission.status === "submitting";
  const visibleErrors = submitAttempted ? controller.fieldErrors : {};
  const previousSourceStudent = students.find(
    (student) => student.id === controller.previousExamSourceStudentId,
  );
  const formRef = useRef<HTMLFormElement>(null);

  function focusFirstInvalidField() {
    const key = controller.firstFieldKey;
    if (!key) return;
    window.requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(
        `[data-field-key="${key}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const focusTarget = target.matches("button, input, select, textarea")
        ? target
        : target.querySelector<HTMLElement>(
            "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
          );
      focusTarget?.focus({ preventScroll: true });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (!controller.canSubmit) {
      focusFirstInvalidField();
      return;
    }
    const outcome = await controller.actions.submitPlan();
    if (!outcome.ok) {
      toast.error(outcome.message);
      focusFirstInvalidField();
      return;
    }
    onSuccess(
      outcome.result.assignmentCount,
      outcome.result.studentCount,
      outcome.result.queuedCount,
    );
    onClose();
  }

  const rangeStatus = hasVocabAssignmentFieldError(visibleErrors, ["dataset", "range"])
    ? "범위 확인"
    : null;
  const conditionStatus = hasVocabAssignmentFieldError(visibleErrors, [
    "distribution",
    "questionCount",
    "overflowPolicy",
    "selectionMode",
    "direction",
    "questionOrder",
    "passingScore",
    "timing",
  ])
    ? "조건 확인"
    : null;
  const scheduleStatus = hasVocabScheduleFieldError(visibleErrors)
    ? "일정 확인"
    : null;

  return (
    <DialogFrame
      aria-labelledby="vocab-assignment-plan-title"
      closeDisabled={busy}
      height="large"
      layout="body-footer"
      onRequestClose={() => !busy && onClose()}
      size="extra-wide"
    >
      <DialogHeader closeLabel="닫기">
        <div>
          <h2 id="vocab-assignment-plan-title">단어 배정</h2>
          <p>{students.length}명 선택</p>
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
            <div className={styles.plannerSections}>
              <AssignmentSection
                help="시험에 사용할 단어장과 연속 범위를 고릅니다."
                helpLabel="시험 범위 설명"
                index={1}
                status={rangeStatus}
                title="시험 범위"
              >
                <VocabRangeFields
                  controller={controller}
                  datasets={controller.readyDatasets}
                  fieldErrors={visibleErrors}
                />
              </AssignmentSection>
              <AssignmentSection
                help="문항 수, 문제 순서, 풀이 조건을 정합니다."
                helpLabel="시험 조건 설명"
                index={2}
                status={conditionStatus}
                title="시험 조건"
              >
                <VocabQuestionFields
                  controller={controller}
                  datasets={controller.readyDatasets}
                  fieldErrors={visibleErrors}
                />
                <section
                  aria-label="직전 시험 복사"
                  className={styles.copyPanel}
                >
                  <div className={styles.copySource}>
                    <FieldLabel as="span">직전 시험</FieldLabel>
                    {students.length > 1 ? (
                      <Select
                        aria-label="직전 시험 복사 기준 학생"
                        onChange={(event) =>
                          controller.actions.changePreviousExamSourceStudentId(
                            event.target.value,
                          )
                        }
                        value={controller.previousExamSourceStudentId}
                      >
                        {students.map((student) => (
                          <option key={student.id} value={student.id}>
                            {previousSourceLabel(student)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <strong>
                        {previousSourceStudent
                          ? previousSourceLabel(previousSourceStudent)
                          : "학생 선택 필요"}
                      </strong>
                    )}
                    <small>
                      {controller.previousExam
                        ? controller.previousExam.assignmentTitle
                        : "복사할 직전 시험 없음"}
                    </small>
                  </div>
                  <Button
                    disabled={!controller.hasPreviousExam || busy}
                    onClick={() => {
                      if (controller.actions.copyPreviousExam()) {
                        toast.success("직전 시험 조건을 적용했습니다.");
                      }
                    }}
                    size="small"
                  >
                    조건 복사
                  </Button>
                </section>
                <BulkExamFields
                  controller={bulk}
                  fieldErrors={visibleErrors}
                  orderLabel="풀이 순서"
                />
              </AssignmentSection>
              <AssignmentSection
                help="요일을 고르면 기본 회차를 날짜에 배치합니다."
                helpLabel="시험 일정 설명"
                index={3}
                status={scheduleStatus}
                title="시험 일정"
              >
                <VocabScheduleFields
                  controller={controller}
                  fieldErrors={visibleErrors}
                />
                {controller.scheduleSlots.length > 0 ? (
                  <BulkSeriesPreview
                    collisionDecisions={controller.collisionDecisionRecords}
                    controller={bulk}
                    distribution={controller.planner.distribution}
                    onClearCollisionDecision={controller.actions.clearCollisionDecision}
                    onCollisionDecision={controller.actions.decideCollision}
                    onCollisionDecisionChange={controller.actions.changeCollisionDecision}
                    students={students}
                  />
                ) : null}
              </AssignmentSection>
            </div>
          </fieldset>
        </form>
      </DialogBody>
      <DialogFooter>
        <div className={styles.submitRow}>
          <AssignmentSubmitAction
            blockedReason={null}
            canSubmit={!busy && (!submitAttempted || controller.canSubmit)}
            formId="vocab-assignment-plan-form"
            label={busy ? "배정 중…" : "배정하기"}
          />
        </div>
      </DialogFooter>
    </DialogFrame>
  );
}
