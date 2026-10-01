"use client";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { StableDataRegion } from "@/design-system/patterns/route-state/stable-data-region";
import type { ReactNode } from "react";

import { emptyStudentDirectoryFilters, type StudentDirectorySnapshot } from "../contracts/student-directory-read-model";
import { useStudentDirectoryPage } from "../controller/use-student-directory-page";
import { StudentDirectoryFilters } from "./student-directory-filters";
import { StudentDirectoryList } from "./student-directory-list";
import styles from "./student-directory.module.css";

const pendingSnapshot: StudentDirectorySnapshot = {
  filters: emptyStudentDirectoryFilters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] },
  page: { items: [], nextCursor: null }, snapshotAt: "pending", totalCount: 0,
};

export function StudentDirectory({
  initialSnapshot = pendingSnapshot,
  syncInitialSnapshot = false,
  privateDataVisible = true,
  pendingContent,
}: {
  initialSnapshot?: StudentDirectorySnapshot;
  syncInitialSnapshot?: boolean;
  privateDataVisible?: boolean;
  pendingContent?: ReactNode;
}) {
  const controller = useStudentDirectoryPage(initialSnapshot, syncInitialSnapshot, privateDataVisible);
  const { snapshot } = controller;
  return (
    <section aria-busy={!privateDataVisible || controller.filtering}>
      <StudentDirectoryFilters
        filtering={controller.filtering}
        filters={controller.filters}
        onChange={controller.actions.replaceFilters}
        onQueryChange={controller.actions.replaceQuery}
        options={snapshot.filterOptions}
        resultCount={snapshot.totalCount}
        privateDataVisible={privateDataVisible}
      />
      <StableDataRegion pending={!privateDataVisible} fallback={pendingContent}>
      {pendingContent}
      {controller.error ? (
        <Notice role="alert" tone="danger">
          {controller.error}
          <Button onClick={() => void controller.actions.retry()} variant="quiet">{adminStudentsText.page.retry}</Button>
        </Notice>
      ) : null}
      <section className={styles.groupPane}>
        <StudentDirectoryList students={snapshot.page.items} />
        {snapshot.page.nextCursor ? (
          <Button
            className={styles.loadMore}
            disabled={controller.filtering || controller.loadingMore}
            onClick={() => void controller.actions.loadMore()}
            variant="quiet"
          >
            {controller.loadingMore
              ? adminStudentsText.page.loadingMore
              : adminStudentsText.page.loadMore}
          </Button>
        ) : null}
      </section>
      </StableDataRegion>
    </section>
  );
}
