"use client";

import type { FormEvent } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import {
  Field,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { CurrentPointSummary } from "@/features/learning-points/public-ui";
import { SchoolTimeline } from "@/features/school-schedules/public-ui";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentVocabBookHistory } from "../../public-contracts";

import type { StudentDetailProfile } from "../../contracts/student-detail-read-model";
import type { StudentProfileController } from "../../controller/use-student-profile-controller";
import type { SchoolSearchController } from "../../controller/use-school-search";
import { SchoolSearchField } from "../school-search-field";
import styles from "../student-detail.module.css";
import { StudentLearningSourceList } from "./student-learning-source-list";
import { StudentVocabBookHistoryList } from "./student-vocab-book-history-list";

export function StudentInfoPanel({
  controller,
  school,
  learningSources,
  student,
  vocabBookHistory,
}: {
  controller: StudentProfileController;
  school: SchoolSearchController;
  learningSources: StudentLearningSourceItem[];
  student: StudentDetailProfile;
  vocabBookHistory: StudentVocabBookHistory[];
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.actions.save();
  }

  return (
    <section
      aria-labelledby="student-info-tab"
      className={styles.panel}
      id="student-info-panel"
      role="tabpanel"
    >
      <CurrentPointSummary currentPoints={student.rawPoints} />
      <form className={styles.profileForm} onSubmit={submit}>
        <div className={styles.profileGrid}>
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.name}</FieldLabel>
            <Input
              maxLength={80}
              onChange={(event) =>
                controller.actions.setField("displayName", event.target.value)
              }
              required
              value={controller.draft.displayName}
            />
          </Field>
          <SchoolSearchField controller={school} />
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.grade}</FieldLabel>
            <Input
              maxLength={40}
              onChange={(event) =>
                controller.actions.setField("gradeLabel", event.target.value)
              }
              value={controller.draft.gradeLabel}
            />
          </Field>
        </div>
        <Button
          disabled={
            controller.busy ||
            controller.needsCheck ||
            controller.locked ||
            controller.unchanged ||
            !controller.draft.displayName.trim()
          }
          type="submit"
        >
          {controller.checking ? adminStudentsText.info.profileChecking : controller.busy
            ? adminStudentsText.info.savePending
            : adminStudentsText.info.save}
        </Button>
        {!controller.busy && !controller.needsCheck && !controller.locked && !controller.unchanged ? <Notice role="status">
          저장하지 않은 변경사항이 있습니다.
        </Notice> : null}
        {controller.feedback ? <Notice role={controller.feedback.tone === "danger" ? "alert" : "status"} tone={controller.feedback.tone}>
          {controller.feedback.message}
          {controller.needsCheck ? <Button disabled={controller.busy} onClick={() => void controller.actions.checkResult()} type="button" variant="quiet">
            {controller.checking ? adminStudentsText.info.profileChecking : adminStudentsText.info.profileCheck}
          </Button> : null}
        </Notice> : null}
      </form>
      {student.schoolSchedule ? <SchoolTimeline overview={{ status: student.schoolSchedule.status === "error" ? "error" : "ready",
        today: student.schoolSchedule.today, groups: [{ summary: student.schoolSchedule, studentCount: 1 }] }} student
        retry={<Button disabled={controller.busy || controller.locked} onClick={() => void controller.actions.checkResult()} variant="quiet">{controller.checking ? "확인 중…" : "다시 시도"}</Button>} /> : null}

      <section className={styles.historySection}>
        <h3>{adminStudentsText.info.currentWordbook}</h3>
        <StudentLearningSourceList
          fallbackPrimaryLabel={student.currentVocabBook}
          sources={learningSources}
        />
      </section>
      <StudentVocabBookHistoryList datasets={[]} items={vocabBookHistory} />
    </section>
  );
}
