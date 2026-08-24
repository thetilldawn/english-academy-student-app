export type VocabTimeTemplateSummary = {
  id: string;
  name: string;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
  timingMode: "none" | "total" | "per_question";
  totalSeconds: number | null;
  perQuestionSeconds: number | null;
};
