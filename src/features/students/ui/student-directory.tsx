"use client";

import { GuardedLink } from "@/components/guarded-link";
import { adminStudentsText } from "@/content/ko/admin-students";
import { learningPointsText } from "@/content/ko/learning-points";
import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { EmptyState, Notice } from "@/design-system/patterns/feedback/feedback";
import { formatVisiblePoints } from "@/features/learning-points/presentation/point-presentation";
import { formatKoreanDateTime } from "@/lib/format";

import type { StudentDirectorySnapshot } from "../contracts/student-directory-read-model";
import { useStudentDirectoryPage } from "../controller/use-student-directory-page";
import { StudentDirectoryFilters } from "./student-directory-filters";
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
        {snapshot.page.items.length === 0 ? (
          <EmptyState>{adminStudentsText.page.noMatches}</EmptyState>
        ) : (
          <div className={styles.cardGrid}>
            {snapshot.page.items.map((student) => {
              const primary = student.currentVocabBook ??
                adminStudentsText.card.wordbookMissing;
              return (
                <GuardedLink
                  className={styles.card}
                  href={`/admin/students/${student.id}`}
                  key={student.id}
                  prefetch={false}
                >
                  <span className={styles.cardHeading}>
                    <span className={styles.cardTitleRow}>
                      <strong className={styles.cardName}>
                        {student.displayName}
                      </strong>
                      <span className={styles.accountStatuses}>
                        <StatusBadge
                          tone={student.status === "active" ? "success" : "danger"}
                        >
                          {student.status === "active"
                            ? adminStudentsText.card.active
                            : adminStudentsText.card.blocked}
                        </StatusBadge>
                        {student.codeStatus === "expired" ? (
                          <StatusBadge tone="danger">
                            {adminStudentsText.card.codeExpired}
                          </StatusBadge>
                        ) : null}
                      </span>
                    </span>
                    <MetaTagList>
                      <MetaTag>
                        {student.schoolName ?? adminStudentsText.card.schoolMissing}
                      </MetaTag>
                      <MetaTag>
                        {student.gradeLabel ?? adminStudentsText.card.gradeMissing}
                      </MetaTag>
                    </MetaTagList>
                  </span>
                  <span className={styles.cardDetails}>
                    <span className={styles.infoRow}>
                      <small>{adminStudentsText.card.currentWordbook}</small>
                      <strong className={styles.primarySource} title={primary}>
                        {primary}
                      </strong>
                    </span>
                    <span className={styles.infoRow}>
                      <small>{adminStudentsText.card.recentExam}</small>
                      <strong className={styles.primarySource}>
                        {student.recentExamAt
                          ? formatKoreanDateTime(student.recentExamAt)
                          : adminStudentsText.card.noHistory}
                      </strong>
                    </span>
                    <span className={styles.activityStats}>
                      <span>
                        {adminStudentsText.card.completed} {student.completedCount}개
                      </span>
                      <span>
                        {adminStudentsText.card.missed} {student.missedCount}개
                      </span>
                      <span>
                        {adminStudentsText.card.notStarted} {student.notStartedCount}개
                      </span>
                      <span>
                        {learningPointsText.current}{" "}
                        {formatVisiblePoints(student.rawPoints)}
                      </span>
                    </span>
                  </span>
                </GuardedLink>
              );
            })}
          </div>
        )}
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
