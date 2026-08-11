"use client";

import type { FormEvent } from "react";

import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { adminStudentsText } from "@/content/ko/admin-students";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import styles from "../student-detail.module.css";

export function StudentAccountPanel({
  controller,
}: {
  controller: StudentDetailController;
}) {
  const student = controller.selectedStudent;
  if (!student) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.actions.saveProfile();
  }

  const profileUnchanged =
    controller.profile.displayName === student.displayName &&
    controller.profile.schoolName === (student.schoolName ?? "") &&
    controller.profile.gradeLabel === (student.gradeLabel ?? "");

  return (
    <section
      aria-labelledby="student-account-tab"
      className={styles.panel}
      id="student-account-panel"
      role="tabpanel"
    >
      <form className={styles.profileForm} onSubmit={submit}>
        <div className={styles.profileGrid}>
          <Field as="label">
            <FieldLabel as="span">{adminStudentsText.account.name}</FieldLabel>
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
            <FieldLabel as="span">{adminStudentsText.account.school}</FieldLabel>
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
            <FieldLabel as="span">{adminStudentsText.account.grade}</FieldLabel>
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
            ? adminStudentsText.account.savePending
            : adminStudentsText.account.save}
        </Button>
      </form>
      <div className={styles.managementSummary}>
        <div>
          <span>{adminStudentsText.account.status}</span>
          <strong>{student.displayName}</strong>
        </div>
        <StatusBadge tone={student.status === "active" ? "success" : "danger"}>
          {student.status === "active"
            ? adminStudentsText.account.active
            : adminStudentsText.account.blocked}
        </StatusBadge>
      </div>
      {student.codeStatus === "expired" ? (
        <Notice role="status" tone="danger">
          {adminStudentsText.account.expiredNotice}
        </Notice>
      ) : null}
      <div className={styles.accountActions}>
        {student.status === "active" ? (
          <>
            {student.codeStatus === "active" ? (
              <Button
                disabled={controller.interactionBusy}
                onClick={() => void controller.actions.revealCode()}
                variant="quiet"
              >
                {adminStudentsText.account.viewCode}
              </Button>
            ) : null}
            <Button
              disabled={controller.interactionBusy}
              onClick={() => void controller.actions.rotateCode()}
            >
              {adminStudentsText.account.rotateCode}
            </Button>
            <Button
              disabled={controller.interactionBusy}
              onClick={() => void controller.actions.blockAccess()}
              variant="danger"
            >
              {adminStudentsText.account.block}
            </Button>
          </>
        ) : (
          <Button
            disabled={controller.interactionBusy}
            onClick={() => void controller.actions.rotateCode()}
            variant="primary"
          >
            {adminStudentsText.account.resume}
          </Button>
        )}
        <Button
          disabled={controller.interactionBusy}
          onClick={() => void controller.actions.removeStudent()}
          variant="danger"
        >
          {controller.busyKey === `delete:${student.id}`
            ? adminStudentsText.account.deletePending
            : adminStudentsText.account.delete}
        </Button>
      </div>
    </section>
  );
}
