"use client";

import { StudentAssignmentQueueHistory } from "@/features/assignment-queue/public-ui";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";

import type {
  StudentCurrentWrongSummary,
  StudentDetailProfile,
} from "../../contracts/student-detail-read-model";
import type { StudentHistoryPageController } from "../../controller/use-student-history-page";
import type { StudentWrongWordCacheController } from "../../controller/use-student-wrong-word-cache";
import styles from "../student-detail.module.css";
import { StudentLearningHistory } from "./student-learning-history";
import { StudentWrongWordPanel } from "./student-wrong-word-panel";

export function StudentHistoryPanel({
  active,
  historyController,
  student,
  wrongCache,
  wrongSummary,
}: {
  active: boolean;
  historyController: StudentHistoryPageController;
  student: StudentDetailProfile;
  wrongCache: StudentWrongWordCacheController;
  wrongSummary: StudentCurrentWrongSummary;
}) {
  return (
    <section
      aria-labelledby="student-history-tab"
      className={styles.panel}
      id="student-history-panel"
      role="tabpanel"
    >
      <section aria-labelledby="student-wrong-words-title" className={styles.historySection}>
        <div className={styles.sectionHeading}>
          <h3 id="student-wrong-words-title">오답 단어</h3>
          <MetaTagList>
            <MetaTag>
              {adminStudentsText.learning.wrongWordsPanel.summary.current}{" "}
              {formatContentText(
                adminStudentsText.learning.wrongWordsPanel.summary.count,
                { count: wrongSummary.wrongWordCount },
              )}
            </MetaTag>
            <MetaTag>
              {adminStudentsText.learning.wrongWordsPanel.summary.repeated}{" "}
              {formatContentText(
                adminStudentsText.learning.wrongWordsPanel.summary.count,
                { count: wrongSummary.repeatedWrongWordCount },
              )}
            </MetaTag>
          </MetaTagList>
        </div>
        <StudentWrongWordPanel
          active={active}
          cachedAt={wrongCache.entry?.loadedAt ?? null}
          cachedHistory={wrongCache.entry?.history ?? null}
          initialCurriculumStage={student.readingCurriculumStage}
          initialDatasetId={student.currentVocabDatasetId ?? ""}
          initialReadingContextSyncStatus={student.readingContextSyncStatus}
          key={student.id}
          onLoaded={wrongCache.actions.cache}
          studentId={student.id}
        />
      </section>
      <StudentAssignmentQueueHistory
        headingLevel={3}
        onHistoryChanged={historyController.actions.refreshFirstPage}
        studentId={student.id}
      />
      <section aria-labelledby="student-learning-history-title" className={styles.historySection}>
        <h3 id="student-learning-history-title">시험 내역</h3>
        <StudentLearningHistory controller={historyController} />
      </section>
    </section>
  );
}
