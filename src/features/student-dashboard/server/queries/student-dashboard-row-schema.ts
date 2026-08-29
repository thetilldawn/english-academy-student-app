import "server-only";

import { z } from "zod";

import type { StudentAssignmentSummary } from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import {
  assignmentDisplayTitleForUnits,
  assignmentScopeLabel,
} from "@/lib/admin/history";
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

export const studentDashboardRawItemSchema = z.object({
  _dataset: rawDatasetSchema,
  assignedAt: timestampSchema,
  assignmentPurpose: z.enum(["regular", "review", "mixed"]),
  assignmentStatus: z.enum(["draft", "active", "closed"]),
  availableFrom: nullableTimestampSchema,
  availableUntil: nullableTimestampSchema,
  id: z.uuid(),
  lastAttemptId: z.uuid().nullable(),
  lastCompletedAt: nullableTimestampSchema,
  lastDeadlineAt: nullableDeadlineTimestampSchema,
  lastFinalScore: z.number().nullable(),
  lastInitialCompletedAt: nullableTimestampSchema,
  lastInitialScore: z.number().nullable(),
  lastPassed: z.boolean().nullable(),
  lastPhase: z.enum(["initial", "review", "retry", "completed"]).nullable(),
  lastRetryStartedAt: nullableTimestampSchema,
  lastStartedAt: nullableTimestampSchema,
  lastStatus: z.enum(["in_progress", "completed", "expired"]).nullable(),
  lastUnresolvedWrongCount: z.number().int().nonnegative().nullable(),
  missedAt: nullableTimestampSchema,
  passingScore: z.number(),
  primaryUnitLabels: z.array(z.string()),
  primaryUnitSortIndexes: z.array(z.number().int()),
  questionCount: z.number().int().nonnegative(),
  retakeAllowed: z.boolean(),
  title: z.string(),
  unitLabels: z.array(z.string()),
  unitSortIndexes: z.array(z.number().int()),
});

const pageNodeBaseSchema = z.object({
  assignmentId: z.uuid(),
  effectiveAt: timestampSchema,
  item: studentDashboardRawItemSchema,
}).superRefine((node, context) => {
  if (node.assignmentId !== node.item.id) {
    context.addIssue({
      code: "custom",
      message: "배정 식별자가 일치하지 않습니다.",
      path: ["assignmentId"],
    });
  }
});

export const studentDashboardCurrentNodeSchema = pageNodeBaseSchema.safeExtend({
  dashboardSection: z.enum([
    "open",
    "scheduled",
    "needs_attention",
    "deadline_closed",
  ]),
});

export const studentDashboardCompletedNodeSchema = pageNodeBaseSchema;

export const studentDashboardInitialRowSchema = z.object({
  completed_count: z.coerce.number().int().nonnegative(),
  completed_items: z.array(studentDashboardCompletedNodeSchema).max(11),
  current_items: z.array(studentDashboardCurrentNodeSchema),
  deadline_closed_count: z.coerce.number().int().nonnegative(),
  needs_attention_count: z.coerce.number().int().nonnegative(),
  open_count: z.coerce.number().int().nonnegative(),
  scheduled_count: z.coerce.number().int().nonnegative(),
  snapshot_at: timestampSchema,
});

export const studentDashboardCompletedPageRowSchema = z.object({
  cursor_assignment_id: z.uuid(),
  cursor_effective_at: timestampSchema,
  item: studentDashboardRawItemSchema,
});

export type StudentDashboardCompletedNode = z.infer<
  typeof studentDashboardCompletedNodeSchema
>;

function displayDatasetTitle(
  dataset: z.infer<typeof rawDatasetSchema>,
) {
  return cataloguedDatasetDisplayLabel(
    cataloguedDatasetFromMetadata(
      {
        id: "student-dashboard-read-model",
        title: dataset.title,
        edition: dataset.edition,
      },
      dataset.catalog ?? undefined,
    ),
  );
}

export function mapStudentDashboardItem(
  raw: z.infer<typeof studentDashboardRawItemSchema>,
): StudentAssignmentSummary {
  const {
    _dataset,
    primaryUnitLabels,
    primaryUnitSortIndexes,
    title,
    unitLabels,
    unitSortIndexes,
    ...item
  } = raw;
  const datasetTitle = displayDatasetTitle(_dataset);
  return {
    ...item,
    datasetTitle,
    displayTitle: assignmentDisplayTitleForUnits(
      title,
      [...unitLabels, ...primaryUnitLabels],
      datasetTitle,
    ),
    scopeLabel: assignmentScopeLabel({
      assignmentPurpose: item.assignmentPurpose,
      primaryUnitLabels,
      primaryUnitSortIndexes,
      questionCount: item.questionCount,
      unitLabels,
      unitSortIndexes,
    }),
  };
}
