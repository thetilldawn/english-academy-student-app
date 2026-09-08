"use client";

import Link from "next/link";

import { useLayoutEffect } from "react";
import dynamic from "next/dynamic";

import { adminStudentsText } from "@/content/ko/admin-students";
import { DialogBody } from "@/design-system/primitives/dialog/dialog";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { GuardedLink } from "@/components/guarded-link";
import { buttonRecipe } from "@/design-system/primitives/button/button";
import type { StudentDetailTab } from "../controller/use-student-detail-view";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { useStudentAccessController } from "../controller/use-student-access-controller";
import { useStudentDetailView } from "../controller/use-student-detail-view";
import { useStudentHistoryPage } from "../controller/use-student-history-page";
import { useStudentProfileController } from "../controller/use-student-profile-controller";
import { useSchoolSearch } from "../controller/use-school-search";
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
  initialTab,
  onInteractionStateChange,
  onStudentRemoved,
  onStudentUpdated,
  presentation,
}: {
  appOrigin: string;
  initial: StudentDetailInitial;
  initialTab?: StudentDetailTab;
  onInteractionStateChange?: (state: { busy: boolean; dirty: boolean; locked?: boolean }) => void;
  onStudentRemoved: () => void;
  onStudentUpdated: (student: Partial<StudentDetailInitial["student"]>) => void;
  presentation: StudentDetailPresentation;
}) {
  const view = useStudentDetailView(initialTab);
  const profile = useStudentProfileController({
    onUpdated: (receipt) => {
      onStudentUpdated(receipt.student);
      announceStudentDirectoryRefresh();
    },
    student: initial.student,
  });
  const school = useSchoolSearch({ ownerKey: initial.student.id, value: profile.draft.schoolName,
    onChange: value => profile.actions.setField("schoolName", value), active: view.tab === "info", locked: profile.locked });
  const locked = profile.locked || school.locked;
  const access = useStudentAccessController({
    appOrigin,
    onRemoved: onStudentRemoved,
    onUpdated: (patch) => {
      onStudentUpdated(patch);
      announceStudentDirectoryRefresh();
    },
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
      dirty: !locked && !profile.unchanged,
      locked,
    });
  }, [
    access.interactionBusy,
    onInteractionStateChange,
    profile.busy,
    profile.unchanged,
    locked,
  ]);

  const panel = (
    <>
      {view.tab === "info" ? (
        <StudentInfoPanel
          controller={profile}
          school={school}
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
          <GuardedLink className={buttonRecipe({ variant: "quiet" })} href={`/admin/assignments?student=${initial.student.id}&view=assign`} scroll={false}>단어 시험 배정</GuardedLink>
          <StudentHistoryPanel
            active={view.tab === "history"}
            historyController={history}
            student={initial.student}
            wrongCache={wrongCache}
            wrongSummary={initial.wrongSummary}
          />
        </div>
      ) : null}
    </>
  );

  if (locked) return <Notice tone="danger">{adminStudentsText.info.profileAuthError} <Link href="/admin/login">관리자 로그인</Link></Notice>;

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
