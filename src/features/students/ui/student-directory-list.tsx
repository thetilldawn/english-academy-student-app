import { adminStudentsText } from "@/content/ko/admin-students";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import type { StudentDirectoryListItem } from "../contracts/student-directory-read-model";
import { StudentDirectoryCard } from "./student-directory-card";
import styles from "./student-directory.module.css";

export function StudentDirectoryList({
  students,
}: {
  students: readonly StudentDirectoryListItem[];
}) {
  if (students.length === 0) {
    return <EmptyState>{adminStudentsText.page.noMatches}</EmptyState>;
  }

  return (
    <div className={styles.cardGrid}>
      {students.map((student) => (
        <StudentDirectoryCard key={student.id} student={student} />
      ))}
    </div>
  );
}
