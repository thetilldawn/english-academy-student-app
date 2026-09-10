import { z } from "zod";
import type { AssignmentGradeReview } from "./assignment-grade-review";
export const BULK_PREVIEW_COUNTS_HEADER = "x-assignment-preview-counts";
import type { AssignmentCountBreakdown } from "../domain/assignment-count-breakdown";
export { assignmentCountBreakdownSchema, type AssignmentCountBreakdown } from "../domain/assignment-count-breakdown";

export type BulkAssignmentPreviewFieldKey =
  | "dataset"
  | "students"
  | "preview"
  | "range"
  | "questionCount"
  | "overflowPolicy"
  | "weekdays";

export type BulkAssignmentPreviewSession = {
  sessionNumber: number;
  sourceSessionNumber: number;
  cycleIndex: number;
  available: boolean;
  unitId: string | null;
  unitLabel: string | null;
  unitIds: string[];
  unitLabels: string[];
  rangeTruncated: boolean;
  questionCount: number;
  availableFrom: string | null;
  availableUntil: string | null;
  error: string | null;
  errorFieldKey?: BulkAssignmentPreviewFieldKey;
};

export type BulkAssignmentPreviewItem = {
  countBreakdown?: AssignmentCountBreakdown | null;
  uniqueScheduledQuestionCount?: number | null;
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  sessions: BulkAssignmentPreviewSession[];
  availableQuestionCount: number | null;
  totalAvailableQuestionCount?: number | null;
  maximumSessionQuestionCount?: number | null;
  selectedQuestionCount: number | null;
  remainingQuestionCount: number | null;
  defaultSessionCount: number | null;
  scheduledQuestionCount: number | null;
  requiresExtraDateDecision: boolean;
  error: string | null;
  errorFieldKey?: BulkAssignmentPreviewFieldKey;
};

export type BulkAssignmentCommonPlanSummary = {
  uniqueScheduledQuestionCount?: number | null;
  representativeStudentId: string;
  normalStudentIds: string[];
  exceptionStudentIds: string[];
  availableQuestionCount: number;
  totalAvailableQuestionCount?: number | null;
  maximumSessionQuestionCount?: number | null;
  selectedQuestionCount: number;
  remainingQuestionCount: number;
  defaultSessionCount: number;
  scheduledQuestionCount: number;
  requiresExtraDateDecision: boolean;
  sessions: Array<{
    sessionNumber: number;
    availableFrom: string | null;
    availableUntil: string | null;
    questionCount: number;
    cycleIndex: number;
    unitLabel: string | null;
  }>;
};

export type BulkAssignmentPreview = {
  gradeReview?: AssignmentGradeReview;
  items: BulkAssignmentPreviewItem[];
  assignableCount: number;
  blockedCount: number;
  assignmentCount: number;
  commonPlanSummary: BulkAssignmentCommonPlanSummary | null;
  planSignature: string;
  rangeLabel: string | null;
};

export const bulkAssignmentResultSchema = z.array(
  z.object({
    student_id: z.uuid(),
    assignment_id: z.uuid().nullable(),
    queue_series_id: z.uuid().nullable().optional().default(null),
    queue_item_id: z.uuid().nullable().optional().default(null),
    session_number: z.coerce.number().int().positive(),
    status: z
      .enum(["assigned", "queued"])
      .optional()
      .default("assigned"),
  }),
);

export type BulkAssignmentResult = z.infer<
  typeof bulkAssignmentResultSchema
>[number];
