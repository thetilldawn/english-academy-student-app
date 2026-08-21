"use client";

import type { FormEvent } from "react";
import { toast } from "sonner";

import {
  AssignmentEditorLayout,
  AssignmentEditorSettings,
  AssignmentEditorSummary,
} from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import {
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import type { AssignmentStudentItem } from "../catalog-types";
import {
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "../controller/use-vocab-assignment-screen";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import { VocabRangePicker } from "./vocab-range-picker";
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
  onSuccess: (assignmentCount: number, studentCount: number) => void;
  students: readonly AssignmentStudentItem[];
}) {
  const controller = useVocabAssignmentScreen({
    data,
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    students,
  });
  const readyDatasets = controller.readyDatasets;
  const bulk = controller.bulk;
  const busy = bulk.state.submission.status === "submitting";
  const previousSourceStudent = students.find(
    (student) => student.id === controller.previousExamSourceStudentId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await controller.actions.submitPlan();
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    onSuccess(
      outcome.result.assignmentCount,
      outcome.result.studentCount,
    );
    onClose();
  }

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
          onSubmit={submit}
        >
          <fieldset className={editorStyles.fieldset} disabled={busy}>
            <legend className="sr-only">단어 시험 배정 조건</legend>
            <section
              aria-label="직전 시험 복사"
              className={styles.copyPanel}
            >
              <div className={styles.copySource}>
                <FieldLabel as="span">복사 기준</FieldLabel>
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
                    : "현재 단어장에서 복사할 직전 시험이 없습니다."}
                </small>
              </div>
              <Button
                disabled={!controller.hasPreviousExam || busy}
                onClick={() => {
                  if (controller.actions.copyPreviousExam()) {
                    toast.success(
                      controller.previousExam?.scheduleRule
                        ? "직전 시험의 조건과 시간 규칙을 적용했습니다."
                        : "직전 시험 조건을 적용했습니다. 시간 이력이 없어 현재 시간은 유지했습니다.",
                    );
                  }
                }}
                size="small"
                title={controller.previousExam
                  ? `${controller.previousExam.sourceStudentName} · ${controller.previousExam.assignmentTitle}`
                  : "현재 단어장에서 복사할 직전 시험이 없습니다."}
              >
                직전 시험 복사
              </Button>
            </section>
            <AssignmentEditorLayout>
              <AssignmentEditorSettings>
                <VocabRangePicker
                  controller={controller}
                  datasets={readyDatasets}
                />
                <VocabScheduleFields controller={controller} />
                <section>
                  <h3>시험 조건</h3>
                  <BulkExamFields controller={bulk} />
                </section>
              </AssignmentEditorSettings>
              <AssignmentEditorSummary
                busy={bulk.previewLoading}
                className={editorStyles.previewSection}
              >
                <BulkSeriesPreview
                  controller={bulk}
                  collisionDecisions={controller.collisionDecisionRecords}
                  distribution={controller.planner.distribution}
                  onClearCollisionDecision={controller.actions.clearCollisionDecision}
                  onCollisionDecision={controller.actions.decideCollision}
                  onCollisionDecisionChange={controller.actions.changeCollisionDecision}
                  students={students}
                />
              </AssignmentEditorSummary>
            </AssignmentEditorLayout>
          </fieldset>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={!bulk.canSubmit}
          form="vocab-assignment-plan-form"
          size="large"
          type="submit"
          variant="primary"
        >
          {busy
            ? "저장 중…"
            : `${bulk.preview?.assignableCount ?? students.length}명에게 ${bulk.preview?.assignmentCount ?? 0}개 시험 배정`}
        </Button>
      </DialogFooter>
    </DialogFrame>
  );
}
