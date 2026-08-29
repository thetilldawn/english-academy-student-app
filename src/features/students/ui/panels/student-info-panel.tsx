"use client";

import type { FormEvent } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { CurrentPointSummary } from "@/features/learning-points/ui/point-summary";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";

import type { StudentDetailProfile } from "../../contracts/student-detail-read-model";
import type { StudentProfileController } from "../../controller/use-student-profile-controller";
import styles from "../student-detail.module.css";
import { StudentLearningSourceList } from "./student-learning-source-list";
import { StudentVocabBookHistoryList } from "./student-vocab-book-history-list";

export function StudentInfoPanel({
  controller,
  learningSources,
  student,
  vocabBookHistory,
}: {
  controller: StudentProfileController;
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
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.school}</FieldLabel>
            <Input
              maxLength={120}
              onChange={(event) =>
                controller.actions.setField("schoolName", event.target.value)
              }
              value={controller.draft.schoolName}
            />
          </Field>
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
            controller.unchanged ||
            !controller.draft.displayName.trim()
          }
          type="submit"
        >
          {controller.busy
            ? adminStudentsText.info.savePending
            : adminStudentsText.info.save}
        </Button>
      </form>

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
