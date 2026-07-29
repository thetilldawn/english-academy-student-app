export type ReviewAssignmentDraftSummary = {
  id: string;
  studentId: string;
  studentName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  datasetId: string;
  datasetLabel: string;
  questionCount: number;
  expiresAt: string;
  generatedTitle: string;
};
