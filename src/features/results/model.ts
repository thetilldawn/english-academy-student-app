import type { QuestionProvenanceStatus } from "@/lib/quiz/question-provenance";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";
import type { StudentAttemptPointSummary } from "@/features/learning-points/model";

export type AttemptResultQuestion = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  correctAnswer: string;
  correctChoiceIndex: number;
  initialChoice: string | null;
  initialIsCorrect: boolean | null;
  retryChoice: string | null;
  retryIsCorrect: boolean | null;
  wrongCount: number;
  headword: string;
  primaryMeaning: string;
  pronunciation: QuizPronunciation;
  provenanceStatus: QuestionProvenanceStatus;
};

export type StudentAttemptResult = {
  id: string;
  title: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  attemptNumber: number;
  questionCount: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  elapsedSeconds: number | null;
  startedAt: string;
  initialCompletedAt: string | null;
  completedAt: string | null;
  pointSummary: StudentAttemptPointSummary | null;
  questions: AttemptResultQuestion[];
};
