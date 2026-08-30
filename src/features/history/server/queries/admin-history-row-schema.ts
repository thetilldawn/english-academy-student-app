import "server-only";

import { z } from "zod";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  cataloguedDatasetDisplayLabel,
  cataloguedDatasetFromMetadata,
} from "@/lib/admin/dataset-catalog";

const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const nullableDeadlineTimestampSchema = z.preprocess(
  (value) =>
    value === "infinity" || value === "-infinity" ? null : value,
  nullableTimestampSchema,
);
const assignmentStatusSchema = z.enum(["draft", "active", "closed"]);
const assignmentPurposeSchema = z.enum(["regular", "review", "mixed"]);
const activityStatusSchema = z.enum([
  "not_started",
  "cancelled",
  "missed",
  "in_progress",
  "completed",
  "expired",
]);
const attemptPhaseSchema = z.enum([
  "initial",
  "review",
  "retry",
  "completed",
]);
const timingModeSchema = z.enum(["none", "total", "per_question"]);
const questionOrderModeSchema = z.enum([
  "fixed",
  "ascending",
  "descending",
  "random",
]);

const catalogSchema = z.object({
  academicYear: z.number().int().nullable(),
  catalogGroup: z.enum(["middle", "high", "high_mock", "csat"]),
  curriculumRevision: z.string().nullable(),
  displayName: z.string(),
  editionLabel: z.string().nullable(),
  gradeCode: z.string().nullable(),
  isAssignable: z.boolean(),
  materialKind: z.enum([
    "textbook",
    "wordbook",
    "exam_collection",
    "exam_prep",
    "supplement",
  ]),
  publisher: z.string().nullable(),
  seriesTitle: z.string().nullable(),
  sortIndex: z.number().int(),
});

const rawDatasetSchema = z.object({
  catalog: catalogSchema.nullable(),
  edition: z.string().nullable(),
  title: z.string(),
});

export const adminHistoryListItemSchema = z.object({
  _dataset: rawDatasetSchema,
  activityAt: timestampSchema,
  assignedAt: timestampSchema,
  assignmentId: z.uuid(),
  assignmentPurpose: assignmentPurposeSchema,
  assignmentTitle: z.string(),
  attemptId: z.uuid().nullable(),
  availableUntil: nullableTimestampSchema,
  cancelledAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  datasetTitle: z.string(),
  deadlineAt: nullableDeadlineTimestampSchema,
  finalScore: z.number().nullable(),
  id: z.string().min(1),
  initialCompletedAt: nullableTimestampSchema,
  initialScore: z.number().nullable(),
  missedAt: nullableTimestampSchema,
  passed: z.boolean().nullable(),
  passingScore: z.number(),
  phase: attemptPhaseSchema.nullable(),
  primaryUnitLabels: z.array(z.string()),
  questionCount: z.number().int().nonnegative(),
  retryStartedAt: nullableTimestampSchema,
  startedAt: nullableTimestampSchema,
  status: activityStatusSchema,
  studentId: z.uuid(),
  studentName: z.string(),
  unitLabels: z.array(z.string()),
});

export const adminHistoryDetailItemSchema = adminHistoryListItemSchema.extend({
  assignmentDeleted: z.boolean(),
  assignmentStatus: assignmentStatusSchema,
  attemptNumber: z.number().int().positive().nullable(),
  availableFrom: nullableTimestampSchema,
  cancellationReason: z.string().nullable(),
  datasetId: z.uuid(),
  englishToKoreanRatio: z.number().int(),
  gradeLabel: z.string().nullable(),
  initialCorrectCount: z.number().int().nonnegative().nullable(),
  primaryUnitIds: z.array(z.uuid()),
  primaryUnitSortIndexes: z.array(z.number().int()).nullable(),
  questionOrderMode: questionOrderModeSchema,
  questionTimeLimitSeconds: z.number().int().nonnegative().nullable(),
  retryCorrectCount: z.number().int().nonnegative().nullable(),
  schoolName: z.string().nullable(),
  studentDeleted: z.boolean(),
  studentStatus: z.enum(["active", "blocked"]),
  timeLimitSeconds: z.number().int().nonnegative(),
  timingMode: timingModeSchema,
  unitIds: z.array(z.uuid()),
  unitSortIndexes: z.array(z.number().int()).nullable(),
  unresolvedWrongCount: z.number().int().nonnegative().nullable(),
});

export const adminHistoryPageNodeSchema = z.object({
  effectiveAt: timestampSchema,
  entryKey: z.string().min(1),
  item: adminHistoryListItemSchema,
});

export const adminHistoryInitialRowSchema = z.object({
  group_key: z.string().min(1),
  items: z.array(adminHistoryPageNodeSchema).max(11),
  snapshot_at: timestampSchema,
  total_count: z.coerce.number().int().nonnegative(),
});

export const adminHistoryPageRowSchema = z.object({
  cursor_effective_at: timestampSchema,
  cursor_entry_key: z.string().min(1),
  item: adminHistoryListItemSchema,
});

export type AdminHistoryPageNode = z.infer<
  typeof adminHistoryPageNodeSchema
>;

function displayDatasetTitle(
  dataset: z.infer<typeof rawDatasetSchema>,
) {
  return cataloguedDatasetDisplayLabel(
    cataloguedDatasetFromMetadata(
      {
        id: "history-read-model",
        title: dataset.title,
        edition: dataset.edition,
      },
      dataset.catalog ?? undefined,
    ),
  );
}

export function mapAdminHistoryListItem(
  raw: z.infer<typeof adminHistoryListItemSchema>,
): AdminHistoryListItem {
  const { _dataset, ...item } = raw;
  return {
    ...item,
    datasetTitle: displayDatasetTitle(_dataset),
  };
}

export function mapAdminHistoryDetailItem(
  raw: z.infer<typeof adminHistoryDetailItemSchema>,
): AssignmentHistorySummary {
  const {
    _dataset,
    primaryUnitSortIndexes,
    unitSortIndexes,
    ...item
  } = raw;
  return {
    ...item,
    datasetTitle: displayDatasetTitle(_dataset),
    ...(primaryUnitSortIndexes ? { primaryUnitSortIndexes } : {}),
    ...(unitSortIndexes ? { unitSortIndexes } : {}),
  };
}

export function projectAdminHistoryListItem(
  item: AssignmentHistorySummary,
): AdminHistoryListItem {
  return {
    activityAt: item.activityAt,
    assignedAt: item.assignedAt,
    assignmentId: item.assignmentId,
    assignmentPurpose: item.assignmentPurpose,
    assignmentTitle: item.assignmentTitle,
    attemptId: item.attemptId,
    availableUntil: item.availableUntil,
    cancelledAt: item.cancelledAt,
    completedAt: item.completedAt,
    datasetTitle: item.datasetTitle,
    deadlineAt: item.deadlineAt,
    finalScore: item.finalScore,
    id: item.id,
    initialCompletedAt: item.initialCompletedAt ?? null,
    initialScore: item.initialScore,
    missedAt: item.missedAt,
    passed: item.passed,
    passingScore: item.passingScore,
    phase: item.phase,
    primaryUnitLabels: item.primaryUnitLabels,
    questionCount: item.questionCount,
    retryStartedAt: item.retryStartedAt,
    startedAt: item.startedAt,
    status: item.status,
    studentId: item.studentId,
    studentName: item.studentName,
    unitLabels: item.unitLabels,
  };
}
