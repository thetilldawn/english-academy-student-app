"use client";

import { adminStudentsText } from "@/content/ko/admin-students";
import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { StudentDetailProfile } from "../../contracts/student-detail-read-model";
import type { StudentAccessController } from "../../controller/use-student-access-controller";
import styles from "../student-detail.module.css";
import { StudentCodePanel } from "./student-code-panel";

export function StudentAccountPanel({
  controller,
  student,
}: {
  controller: StudentAccessController;
  student: StudentDetailProfile;
}) {
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
              onClick={() => void controller.actions.block()}
              variant="danger"
            >
              {adminStudentsText.account.block}
            </Button>
          </>
        ) : (
          <Button
            disabled={controller.interactionBusy}
            onClick={() => void controller.actions.rotateCode()}
          >
            {adminStudentsText.account.resume}
          </Button>
        )}
        <Button
          disabled={controller.interactionBusy}
          onClick={() => void controller.actions.remove()}
          variant="danger"
        >
          {controller.busyKey === "delete"
            ? adminStudentsText.account.deletePending
            : adminStudentsText.account.delete}
        </Button>
      </div>
      {controller.code ? (
        <section className={styles.historySection}>
          <div className={styles.codeHeading}>
            <h3>{controller.code.label}</h3>
            <Button onClick={controller.actions.clearCode} size="small" variant="quiet">
              {adminStudentsText.codeModal.close}
            </Button>
          </div>
          <StudentCodePanel
            code={controller.code.code}
            onCopy={controller.actions.copyCode}
            onShare={controller.actions.shareCode}
          />
        </section>
      ) : null}
    </section>
  );
}
