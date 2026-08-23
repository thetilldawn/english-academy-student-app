"use client";

import type { FormEvent } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
import styles from "../student-detail.module.css";
import { StudentVocabBookHistoryList } from "./student-vocab-book-history-list";

export function StudentInfoPanel({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const student = controller.selectedStudent;
  if (!student) return null;
  const vocabBookHistory = data.vocabBookHistory.filter(
    (item) => item.studentId === student.id,
  );

  const profileUnchanged =
    controller.profile.displayName === student.displayName &&
    controller.profile.schoolName === (student.schoolName ?? "") &&
    controller.profile.gradeLabel === (student.gradeLabel ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.actions.saveProfile();
  }

  return (
    <section
      aria-labelledby="student-info-tab"
      className={styles.panel}
      id="student-info-panel"
      role="tabpanel"
    >
      <form className={styles.profileForm} onSubmit={submit}>
        <div className={styles.profileGrid}>
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.name}</FieldLabel>
            <Input
              maxLength={80}
              onChange={(event) =>
                controller.actions.setProfileField(
                  "displayName",
                  event.target.value,
                )
              }
              required
              value={controller.profile.displayName}
            />
          </Field>
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.school}</FieldLabel>
            <Input
              maxLength={120}
              onChange={(event) =>
                controller.actions.setProfileField(
                  "schoolName",
                  event.target.value,
                )
              }
              value={controller.profile.schoolName}
            />
          </Field>
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.info.grade}</FieldLabel>
            <Input
              maxLength={40}
              onChange={(event) =>
                controller.actions.setProfileField(
                  "gradeLabel",
                  event.target.value,
                )
              }
              value={controller.profile.gradeLabel}
            />
          </Field>
        </div>
        <Button
          disabled={
            controller.interactionBusy ||
            !controller.profile.displayName.trim() ||
            profileUnchanged
          }
          type="submit"
        >
          {controller.busyKey === `profile:${student.id}`
            ? adminStudentsText.info.savePending
            : adminStudentsText.info.save}
        </Button>
      </form>

      <StudentVocabBookHistoryList
        datasets={data.datasets}
        items={vocabBookHistory}
      />
    </section>
  );
}
