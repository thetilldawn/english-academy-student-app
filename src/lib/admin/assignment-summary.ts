import type { QuestionOrderMode } from "@/lib/admin/assignment-settings";

export type AssignmentSummary = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  datasetId: string;
  datasetTitle: string;
  unitLabels: string[];
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  studentCount: number;
  createdAt: string;
};
