import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function compact(value: string) {
  return value.replace(/\s+/g, " ");
}

describe("regular assignment scope contract", () => {
  it("builds regular questions and capacity from the selected units only", () => {
    const regularService = compact(
      source("src/lib/services/regular-assignment-service.ts"),
    );
    const mixedService = compact(
      source("src/lib/services/mixed-assignment-service.ts"),
    );

    expect(regularService).toContain(
      "const choiceCandidates = allCandidates.filter( (candidate) => unitIdSet.has(candidate.unitId)",
    );
    expect(regularService).toContain(
      "buildAssignmentQuestionPlan({ requiredTargets, primaryCandidates: selectablePrimaryCandidates, allCandidates: choiceCandidates,",
    );
    expect(mixedService).toContain(
      "calculateAssignmentQuestionRange({ primaryCandidates, allCandidates: primaryCandidates,",
    );
    expect(mixedService).toContain(
      "calculateAssignmentSeriesQuestionCapacity({ requiredTargets: prepared.reviewTargets, primaryCandidates: prepared.primaryCandidates, allCandidates: input.includePendingReview ? prepared.allCandidates : prepared.primaryCandidates,",
    );
  });

  it("orders the base question bank by the teacher's selected unit direction", () => {
    const regularService = compact(
      source("src/lib/services/regular-assignment-service.ts"),
    );

    expect(regularService).toContain(
      "const unitPositionById = new Map( orderedUnitIds.map",
    );
    expect(regularService).toContain(
      "unitPositionById.get( unitIdByCandidateId.get(left.vocabEntryId)",
    );
  });

  it("keeps regular preparation out of the integrated admin service", () => {
    const adminService = source(
      "src/features/history/server/queries/admin-history-detail-query.ts",
    );
    const bulkPreparation = source(
      "src/features/assignments/server/use-cases/bulk-assignment-series-preparation.ts",
    );
    const replacementPreparation = source(
      "src/lib/services/assignment-replacement-preparation-service.ts",
    );

    expect(adminService).not.toContain("prepareRegularAssignment");
    expect(adminService).not.toContain("createRegularAssignment");
    expect(bulkPreparation).toContain(
      'from "@/lib/services/regular-assignment-service"',
    );
    expect(replacementPreparation).toContain(
      'from "@/lib/services/regular-assignment-service"',
    );
  });

  it("allows sparse ordered units for regular and legacy mixed capacity", () => {
    const mixedService = compact(
      source("src/lib/services/mixed-assignment-service.ts"),
    );

    expect(mixedService).toContain(
      "primaryUnits = resolveOrderedUnitSelection( availableUnits, input.primaryUnitIds, )",
    );
    expect(mixedService).not.toContain("orderContiguousPrimaryUnits");
  });

  it("uses the same deterministic series preparation for preview and save", () => {
    const previewService = compact(
      source("src/features/assignments/server/use-cases/bulk-assignment-preview.ts"),
    );
    const commandService = compact(
      source("src/features/assignments/server/use-cases/bulk-assignment-command.ts"),
    );
    const preparationService = compact(
      source("src/features/assignments/server/use-cases/bulk-assignment-series-preparation.ts"),
    );

    expect(previewService).toContain("prepareCommonPlanSeries({");
    expect(commandService).toContain("prepareCommonPlanSeries({");
    expect(previewService).toContain(
      "let seriesPreparationError: string | null = null",
    );
    expect(previewService).toContain(
      "seriesPreparationError === null && orderedSessions.length > 0",
    );
    expect(previewService).toContain(
      "item.availableQuestionCount === null || item.selectedQuestionCount === null",
    );
    expect(preparationService).toContain(
      "planDirectionalVocabSeriesTargets({",
    );
    expect(previewService).toContain("materializeQuestions: false");
    expect(commandService).toContain("materializeQuestions: true");
    expect(commandService).toContain(
      "preview.items.filter((item) => item.sessions.length > 0)",
    );
    expect(commandService).toContain(
      "batches.length > MAXIMUM_BULK_ASSIGNMENT_COUNT",
    );
    expect(previewService).toContain(
      "maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT",
    );
    expect(commandService).toContain(
      "totalBatchQuestionCount > MAXIMUM_BULK_QUESTION_COUNT",
    );
    expect(previewService).not.toContain(
      "maximumSessionCount: Math.floor(210 / input.studentIds.length)",
    );
    expect(preparationService).not.toContain(
      "requiredTargetIds = requiredTargetIds.slice(0, -1)",
    );
  });

  it("restores only previously selected unresolved review words", () => {
    const migration = source(
      "supabase/migrations/20260731020000_reopen_selected_unresolved_review_queue.sql",
    );

    expect(migration).toContain(
      "private.reopen_selected_vocab_review_queue_v1",
    );
    expect(migration).toContain(
      "queue.status in ('consumed', 'cancelled')",
    );
    expect(migration).toContain(
      "assignment_review_targets_reopen_queue_after_missed",
    );
    expect(migration).not.toContain(
      "insert into public.student_vocab_review_queue",
    );
  });
});
