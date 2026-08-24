import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentProgressSummary } from "@/lib/admin/progress";
import type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";
import type { VocabTimeTemplateSummary } from "@/lib/admin/vocab-time-template";
import type { StudentCurrentVocabWrongSummary } from "@/lib/admin/wrong-history-summary";

import type {
  DatasetSummary,
  VocabUnitSummary,
} from "./dataset-summary";
import type {
  StudentClassGroupSummary,
  StudentSummary,
} from "./student-summary";

export type AssignmentManagerData = {
  datasets: DatasetSummary[];
  students: StudentSummary[];
  units: VocabUnitSummary[];
  history: AssignmentHistorySummary[];
  progress: StudentProgressSummary[];
  pendingReviewSummaries: StudentPendingReviewSummary[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  learningSources: StudentLearningSourceItem[];
  classGroups: StudentClassGroupSummary[];
  timeTemplates: VocabTimeTemplateSummary[];
  assignmentQueues: VocabAssignmentQueueSummary[];
};
