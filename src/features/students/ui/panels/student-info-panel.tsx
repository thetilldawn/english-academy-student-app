"use client";

import { useMemo, type FormEvent } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
import styles from "../student-detail.module.css";

export function StudentInfoPanel({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const student = controller.selectedStudent;
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(data.datasets),
    [data.datasets],
  );
  if (!student) return null;

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

      <div className={styles.wordbookForm}>
        <Field as="label">
          <FieldLabel as="span">
            {adminStudentsText.info.currentWordbook}
          </FieldLabel>
          <Select
            onChange={(event) =>
              controller.actions.setProfileField("datasetId", event.target.value)
            }
            value={controller.profile.datasetId}
          >
            <option value="">{adminStudentsText.info.chooseLater}</option>
            {controller.profile.datasetId &&
            !data.datasets.some(
              (dataset) => dataset.id === controller.profile.datasetId,
            ) ? (
              <option disabled value={controller.profile.datasetId}>
                {student.currentVocabBook ??
                  adminStudentsText.info.previousWordbook}{" "}
                · {adminStudentsText.info.assignmentClosed}
              </option>
            ) : null}
            {datasetGroups.map((group) => (
              <optgroup key={group.group} label={group.label}>
                {group.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {cataloguedDatasetDisplayLabel(dataset)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Button
          disabled={
            controller.interactionBusy ||
            controller.profile.datasetId ===
              (student.currentVocabDatasetId ?? "")
          }
          onClick={() => void controller.actions.saveCurrentDataset()}
          variant="secondary"
        >
          {adminStudentsText.info.saveWordbook}
        </Button>
      </div>
    </section>
  );
}
