import type { AssignmentPurpose } from "@/lib/admin/history";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";

export type StudentAssignmentSummary = {
  id: string;
  title: string;
  displayTitle: string;
  datasetTitle: string;
  assignmentPurpose: AssignmentPurpose;
  scopeLabel: string;
  questionCount: number;
  questionOrderMode: QuestionOrderMode;
  timeLimitSeconds: number;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  retakeAllowed: boolean;
  lastAttemptId: string | null;
  lastStatus: "in_progress" | "completed" | "expired" | null;
  lastPhase: "initial" | "review" | "retry" | "completed" | null;
  lastInitialScore: number | null;
  lastFinalScore: number | null;
  lastPassed: boolean | null;
  lastRetryStartedAt: string | null;
  lastStartedAt: string | null;
  lastInitialCompletedAt: string | null;
  lastCompletedAt: string | null;
  lastDeadlineAt: string | null;
  lastUnresolvedWrongCount: number | null;
  assignedAt: string;
  availableUntil: string | null;
  missedAt: string | null;
  missed: boolean;
  canStart: boolean;
};
