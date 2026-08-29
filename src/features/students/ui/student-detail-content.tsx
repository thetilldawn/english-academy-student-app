"use client";

import { useCallback, useLayoutEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { adminStudentsText } from "@/content/ko/admin-students";
import { DialogBody } from "@/design-system/primitives/dialog/dialog";
import { Tabs } from "@/design-system/primitives/tabs/tabs";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { useStudentAccessController } from "../controller/use-student-access-controller";
import { useStudentDetailView } from "../controller/use-student-detail-view";
import { useStudentHistoryPage } from "../controller/use-student-history-page";
import { useStudentProfileController } from "../controller/use-student-profile-controller";
import { useStudentWrongWordCache } from "../controller/use-student-wrong-word-cache";
import { announceStudentDirectoryRefresh } from "../controller/student-directory-events";
import { StudentAccountPanel } from "./panels/student-account-panel";
import { StudentInfoPanel } from "./panels/student-info-panel";
import styles from "./student-detail.module.css";

const StudentHistoryPanel = dynamic(
  () => import("./panels/student-history-panel").then((module) => module.StudentHistoryPanel),
  {
    loading: () => (
      <section
        aria-labelledby="student-history-tab"
        className={styles.panel}
        id="student-history-panel"
        role="tabpanel"
      >
        <div role="status">{adminStudentsText.page.loadingMore}</div>
      </section>
    ),
  },
);

export type StudentDetailPresentation = "dialog" | "page";

export function StudentDetailContent({
  appOrigin,
  initial,
  onInteractionStateChange,
  onStudentRemoved,
  presentation,
}: {
  appOrigin: string;
  initial: StudentDetailInitial;
  onInteractionStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
  onStudentRemoved: () => void;
  presentation: StudentDetailPresentation;
}) {
  const router = useRouter();
  const refresh = useCallback((includeDirectory: boolean) => {
    if (includeDirectory) announceStudentDirectoryRefresh();
    router.refresh();
  }, [router]);
  const refreshDetail = useCallback(() => refresh(false), [refresh]);
  const refreshStudent = useCallback(() => refresh(true), [refresh]);
  const view = useStudentDetailView();
  const profile = useStudentProfileController({
    onUpdated: refreshStudent,
    student: initial.student,
  });
  const access = useStudentAccessController({
    appOrigin,
    onRemoved: onStudentRemoved,
    onUpdated: refreshStudent,
    student: initial.student,
  });
  const history = useStudentHistoryPage({
    initialPage: initial.history,
    studentId: initial.student.id,
  });
  const wrongCache = useStudentWrongWordCache(initial.student.id);

  useLayoutEffect(() => {
    onInteractionStateChange?.({
      busy: profile.busy || access.interactionBusy,
      dirty: !profile.unchanged,
    });
  }, [
    access.interactionBusy,
    onInteractionStateChange,
    profile.busy,
    profile.unchanged,
  ]);

  const panel = (
    <>
      {view.tab === "info" ? (
        <StudentInfoPanel
          controller={profile}
          learningSources={initial.learningSources}
          student={initial.student}
          vocabBookHistory={initial.vocabBookHistory}
        />
      ) : null}
      {view.tab === "account" ? (
        <StudentAccountPanel controller={access} student={initial.student} />
      ) : null}
      {view.historyVisited ? (
        <div hidden={view.tab !== "history"}>
          <StudentHistoryPanel
            active={view.tab === "history"}
            historyController={history}
            onDataUpdated={refreshDetail}
            student={initial.student}
            wrongCache={wrongCache}
            wrongSummary={initial.wrongSummary}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <>
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
        onChange={view.actions.changeTab}
        value={view.tab}
        variant={presentation === "dialog" ? "dialog" : "default"}
      />
      {presentation === "dialog" ? (
        <DialogBody className={styles.body}>{panel}</DialogBody>
      ) : (
        <div className={styles.pageBody}>{panel}</div>
      )}
    </>
  );
}
