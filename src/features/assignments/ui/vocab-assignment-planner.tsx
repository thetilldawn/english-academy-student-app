"use client";

import { useState, type FormEvent } from "react";
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
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import type { AssignmentStudentItem } from "../catalog-types";
import { useVocabAssignmentPlanner } from "../controller/use-vocab-assignment-planner";
import { toVocabTimeTemplate } from "../api/vocab-time-template-adapter";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import { VocabRangePicker } from "./vocab-range-picker";
import { VocabScheduleFields } from "./vocab-schedule-fields";
import editorStyles from "./bulk-assignment-editor.module.css";
import styles from "./vocab-assignment-planner.module.css";

function commonInitialDatasetId(
  students: readonly AssignmentStudentItem[],
  readyDatasetIds: ReadonlySet<string>,
) {
  const selected = new Set(
    students
      .map((student) => student.currentVocabDatasetId)
      .filter((value): value is string => Boolean(value)),
  );
  const only = [...selected][0];
  return selected.size === 1 && only && readyDatasetIds.has(only) ? only : "";
}

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
  data: AssignmentManagerData;
  initialDatasetId?: string;
  onClose: () => void;
  onSuccess: (assignmentCount: number, studentCount: number) => void;
  students: readonly AssignmentStudentItem[];
}) {
  const [today] = useState(() =>
    isoToKoreanDateTimeLocal(new Date().toISOString()).slice(0, 10),
  );
  const [previousExamSourceStudentId, setPreviousExamSourceStudentId] =
    useState(() => students[0]?.id ?? "");
  const readyDatasets = data.datasets.filter(
    (dataset) => dataset.status === "ready" && dataset.isActive && dataset.isAssignable,
  );
  const readyDatasetIds = new Set(readyDatasets.map((dataset) => dataset.id));
  const controller = useVocabAssignmentPlanner({
    datasets: readyDatasets,
    genericErrorMessage: "단어 시험 배정을 저장하지 못했습니다.",
    initialDatasetId:
      initialDatasetId && readyDatasetIds.has(initialDatasetId)
        ? initialDatasetId
        : commonInitialDatasetId(students, readyDatasetIds),
    initialTimeTemplates: data.timeTemplates.map(toVocabTimeTemplate),
    previousExamHistory: data.history,
    previousExamSourceStudentId,
    previewErrorMessage: "배정 후보를 계산하지 못했습니다.",
    studentIds: students.map((student) => student.id),
    today,
    units: data.units,
  });
  const bulk = controller.bulk;
  const busy = bulk.state.submission.status === "submitting";
  const previousSourceStudent = students.find(
    (student) => student.id === previousExamSourceStudentId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await bulk.actions.submit();
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    onSuccess(
      outcome.result.assignments.length,
      new Set(outcome.result.assignments.map((item) => item.student_id)).size,
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
          <h2 id="vocab-assignment-plan-title">단어 시험 배정</h2>
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
                      setPreviousExamSourceStudentId(event.target.value)
                    }
                    value={previousExamSourceStudentId}
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
