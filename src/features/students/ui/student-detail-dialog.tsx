"use client";

import { adminStudentsText } from "@/content/ko/admin-students";
import { commonText } from "@/content/ko/common";
import {
  DialogBody,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { Tabs } from "@/design-system/primitives/tabs/tabs";

import type { StudentDetailController } from "../controller/use-student-detail-controller";
import type { StudentManagementData } from "../model";
import { StudentAccountPanel } from "./panels/student-account-panel";
import { StudentCodePanel } from "./panels/student-code-panel";
import { StudentHistoryPanel } from "./panels/student-history-panel";
import { StudentInfoPanel } from "./panels/student-info-panel";
import styles from "./student-detail.module.css";

function detailHeading(controller: StudentDetailController) {
  const route = controller.route;
  const student = controller.selectedStudent;
  if (route.kind === "code") {
    return { description: "", title: route.code.label };
  }
  return {
    description:
      [student?.schoolName, student?.gradeLabel].filter(Boolean).join(" · ") ||
      adminStudentsText.detail.missingSchoolGrade,
    title: student?.displayName ?? "",
  };
}
export function StudentDetailDialog({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const route = controller.route;
  if (route.kind === "closed") return null;
  const heading = detailHeading(controller);
  const standaloneCode = route.kind === "code" && route.studentId === null;
  const hasBack = route.kind === "code" && route.returnTo !== null;
  const layout = route.kind === "detail" ? "tabs" : "body";

  return (
    <DialogFrame
      aria-labelledby="student-detail-title"
      fullScreenMobile={!standaloneCode}
      height={standaloneCode ? "auto" : "medium"}
      layout={layout}
      onRequestClose={controller.actions.requestClose}
      size={standaloneCode ? "compact" : "wide"}
    >
      <DialogHeader
        backLabel={commonText.modal.back}
        closeLabel={commonText.modal.close}
        onBack={hasBack ? controller.actions.backOneLevel : undefined}
      >
        <div className={styles.headerCopy}>
          <h2 id="student-detail-title">{heading.title}</h2>
          {heading.description ? <p>{heading.description}</p> : null}
        </div>
      </DialogHeader>

      {route.kind === "detail" ? (
        <Tabs
          ariaLabel={adminStudentsText.detail.tabsAria}
          items={[
            {
              controls: "student-info-panel",
              id: "student-info-tab",
              label: adminStudentsText.detailTabs.info,
              value: "info",
            },
            {
              controls: "student-account-panel",
              id: "student-account-tab",
              label: adminStudentsText.detailTabs.account,
              value: "account",
            },
            {
              controls: "student-history-panel",
              id: "student-history-tab",
              label: adminStudentsText.detailTabs.history,
              value: "history",
            },
          ]}
          onChange={controller.actions.changeTab}
          value={route.tab}
          variant="dialog"
        />
      ) : null}

      {route.kind === "code" ? (
        <DialogBody className={styles.codeBody}>
          <StudentCodePanel controller={controller} />
        </DialogBody>
      ) : (
        <DialogBody className={styles.body}>
          {route.tab === "info" ? (
            <StudentInfoPanel controller={controller} data={data} />
          ) : route.tab === "account" ? (
            <StudentAccountPanel controller={controller} />
          ) : (
            <StudentHistoryPanel controller={controller} data={data} />
          )}
        </DialogBody>
      )}
    </DialogFrame>
  );
}
