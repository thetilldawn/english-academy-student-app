import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { StudentProgressSummary } from "@/lib/admin/progress";
import type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentVocabBookHistory } from "@/lib/admin/student-vocab-book-history";
import type { StudentCurrentVocabWrongSummary } from "@/lib/admin/wrong-history-summary";
import type {
  DatasetOption,
  DatasetSummary,
  VocabUnitSummary,
} from "@/lib/admin/dataset-summary";
import type { StudentSummary } from "@/lib/admin/student-summary";

export type StudentDetailTab = "info" | "account" | "history";
export type StudentWrongFilter = "all" | "wrong" | "repeated" | "retry";

export type StudentCodeView = {
  code: string;
  label: string;
};
export type StudentProfileDraft = {
  datasetId: string;
  displayName: string;
  gradeLabel: string;
  schoolName: string;
};

export type StudentDirectoryFilters = {
  grade: string;
  query: string;
  school: string;
  wordbook: string;
  wrong: StudentWrongFilter;
};

export type StudentManagementData = {
  appOrigin: string;
  assignmentDatasets: DatasetSummary[];
  assignmentUnits: VocabUnitSummary[];
  currentHistory: AssignmentHistorySummary[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  datasets: DatasetOption[];
  history: AssignmentHistorySummary[];
  initialStudentId?: string;
  learningSources: StudentLearningSourceItem[];
  pendingReviewSummaries: StudentPendingReviewSummary[];
  progress: StudentProgressSummary[];
  students: StudentSummary[];
  vocabBookHistory: StudentVocabBookHistory[];
};
