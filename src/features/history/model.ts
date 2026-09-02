import type { AttemptResultQuestion } from "@/features/results/model";
import type { AdminAttemptPointSummary } from "@/features/learning-points/model";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { QuizContentMode } from "@/lib/quiz/question-content-mode";

export type AttemptSummary = {
  id: string;
  studentName: string;
  assignmentTitle: string;
  attemptNumber: number;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  questionCount: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  startedAt: string;
  completedAt: string | null;
};

export type AdminAttemptDetail = AttemptSummary & {
  elapsedSeconds: number | null;
  quizContentMode: QuizContentMode;
  questions: AttemptResultQuestion[];
};

export type AdminHistoryDetail = {
  summary: AssignmentHistorySummary;
  attempt: AdminAttemptDetail | null;
  canonicalKey: string;
  pointSummary: AdminAttemptPointSummary | null;
};
