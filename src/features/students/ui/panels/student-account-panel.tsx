"use client";

import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
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

  return (
    <section
      aria-labelledby="student-account-tab"
      className={styles.panel}
      id="student-account-panel"
      role="tabpanel"
    >
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
