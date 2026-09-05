import type { QuizContentMode } from "@/lib/quiz/question-content-mode";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";

export type AssignmentStudyWord = {
  key: string;
  headword: string;
  meaning: string;
  definition: string | null;
  example: string | null;
  pronunciation: QuizPronunciation;
};

export type AssignmentStudy = {
  assignmentId: string;
  title: string;
  mode: QuizContentMode;
  words: AssignmentStudyWord[];
};

export type StudyPresentation = "dialog" | "page";
