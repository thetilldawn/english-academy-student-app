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
    const adminService = compact(
      source("src/lib/services/admin-service.ts"),
    );
    const mixedService = compact(
      source("src/lib/services/mixed-assignment-service.ts"),
    );

    expect(adminService).toContain(
      "const choiceCandidates = allCandidates.filter( (candidate) => unitIdSet.has(candidate.unitId)",
    );
    expect(adminService).toContain(
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
    const adminService = compact(
      source("src/lib/services/admin-service.ts"),
    );

    expect(adminService).toContain(
      "const unitPositionById = new Map( orderedUnitIds.map",
    );
    expect(adminService).toContain(
      "unitPositionById.get( unitIdByCandidateId.get(left.vocabEntryId)",
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
    const bulkService = compact(
      source("src/lib/services/bulk-assignment-service.ts"),
    );

    expect(
      bulkService.match(/prepareCommonPlanSeries\(/g),
    ).toHaveLength(3);
    expect(bulkService).toContain(
      "let seriesPreparationError: string | null = null",
    );
    expect(bulkService).toContain(
      "seriesPreparationError === null && orderedSessions.length > 0",
    );
    expect(bulkService).toContain(
      "item.availableQuestionCount === null || item.sessions.length === 0",
    );
    expect(bulkService).toContain(
      "planDirectionalVocabSeriesTargets({",
    );
    expect(bulkService).toContain("materializeQuestions: false");
    expect(bulkService).toContain("materializeQuestions: true");
    expect(bulkService).toContain(
      "preview.items.filter((item) => item.sessions.length > 0)",
    );
    expect(bulkService).toContain(
      "batches.length > MAXIMUM_BULK_ASSIGNMENT_COUNT",
    );
    expect(bulkService).toContain(
      "maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT",
    );
    expect(bulkService).toContain(
      "totalBatchQuestionCount > MAXIMUM_BULK_QUESTION_COUNT",
    );
    expect(bulkService).not.toContain(
      "maximumSessionCount: Math.floor(210 / input.studentIds.length)",
    );
    expect(bulkService).not.toContain(
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
