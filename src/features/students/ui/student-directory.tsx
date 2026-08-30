"use client";

import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { StudentDirectorySnapshot } from "../contracts/student-directory-read-model";
import { useStudentDirectoryPage } from "../controller/use-student-directory-page";
import { StudentDirectoryFilters } from "./student-directory-filters";
import { StudentDirectoryList } from "./student-directory-list";
import styles from "./student-directory.module.css";

export function StudentDirectory({
  initialSnapshot,
}: {
  initialSnapshot: StudentDirectorySnapshot;
}) {
  const controller = useStudentDirectoryPage(initialSnapshot);
  const { snapshot } = controller;
  return (
    <section aria-busy={controller.filtering}>
      <StudentDirectoryFilters
        filtering={controller.filtering}
        filters={controller.filters}
        onChange={controller.actions.replaceFilters}
        onQueryChange={controller.actions.replaceQuery}
        options={snapshot.filterOptions}
        resultCount={snapshot.totalCount}
      />
      {controller.error ? (
        <Notice role="alert" tone="danger">{controller.error}</Notice>
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
    </section>
  );
}
