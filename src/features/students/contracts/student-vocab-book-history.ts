import type { AssignmentActivityStatus } from "@/lib/admin/history";

export type StudentVocabBookHistory = {
  studentId: string;
  datasetId: string;
  datasetTitle: string;
  lastScopeLabel: string;
  lastActivityAt: string;
  lastStatus: Extract<
    AssignmentActivityStatus,
    "in_progress" | "completed" | "expired"
  >;
  lastPassed: boolean;
  attemptCount: number;
};
