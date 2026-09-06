import type { QuizContentMode } from "@/lib/quiz/question-content-mode";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";
import type { StudyTextRange } from "../domain/study-example-ranges";
import type { AssignmentRelease } from "@/lib/assignment/assignment-release";

export type AssignmentStudyWord = {
  key: string;
  headword: string;
  meaning: string;
  definition: string | null;
  example: string | null;
  exampleRanges?: StudyTextRange[] | null;
  pronunciation: QuizPronunciation;
};

export type AssignmentStudy = {
  assignmentId: string;
  title: string;
  mode: QuizContentMode;
  words: AssignmentStudyWord[];
};

export type StudyPresentation = "dialog" | "page";

export type LockedAssignmentStudy = {
  assignmentId: string;
  title: string;
  mode: QuizContentMode;
  release: AssignmentRelease;
  // Deliberately no word/meaning/audio fields in a locked response.
  words?: never;
};

export type AssignmentStudyResult = AssignmentStudy | LockedAssignmentStudy;
