import { GuardedLink } from "@/components/guarded-link";
import { adminStudentsText } from "@/content/ko/admin-students";
import { learningPointsText } from "@/content/ko/learning-points";
import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { formatVisiblePoints } from "@/features/learning-points/public-presentation";
import { formatKoreanDateTime } from "@/lib/format";

import type { StudentDirectoryListItem } from "../contracts/student-directory-read-model";
import styles from "./student-directory.module.css";

export function StudentDirectoryCard({
  student,
}: {
  student: StudentDirectoryListItem;
}) {
  const currentWordbook = student.currentVocabBook ??
    adminStudentsText.card.wordbookMissing;

  return (
    <GuardedLink
      className={styles.card}
      href={`/admin/students/${student.id}`}
      prefetch={false}
    >
      <span className={styles.cardHeading}>
        <span className={styles.cardTitleRow}>
          <strong className={styles.cardName}>{student.displayName}</strong>
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
          <strong className={styles.primarySource} title={currentWordbook}>
            {currentWordbook}
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
          <span>{adminStudentsText.card.completed} {student.completedCount}개</span>
          <span>{adminStudentsText.card.missed} {student.missedCount}개</span>
          <span>{adminStudentsText.card.notStarted} {student.notStartedCount}개</span>
          <span>
            {learningPointsText.current} {formatVisiblePoints(student.rawPoints)}
          </span>
        </span>
      </span>
    </GuardedLink>
  );
}
