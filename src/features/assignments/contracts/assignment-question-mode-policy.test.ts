import { describe, expect, it } from "vitest";
import { bulkAssignmentPreviewSchema, type BulkAssignmentPreviewInput } from "./bulk-assignment-request";
import { assignmentQuestionModes, type BulkSeriesAssignmentDraft } from "../domain/model";
import { assignmentQuestionModeErrors } from "../domain/assignment-question-mode-policy";
import { validateBulkPreviewProjection } from "../domain/validation";
import { buildBulkAssignmentPreviewRequest } from "../api/request-adapters";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function request(): BulkAssignmentPreviewInput {
  return { studentIds: [uid(1)], questionMode: "canonical_example_to_headword", englishToKoreanRatio: 0,
    commonPlan: { datasetId: uid(2), planNonce: uid(3), orderedUnitIds: [uid(4)], distribution: "repeat",
      splitBasis: "question_count", rangeUnitCounts: [], unitAllocationRule: null, questionCount: { mode: "all" },
      overflowPolicy: "leave", extraDatePolicy: "unconfirmed", selectedDateCount: 0, selectionMode: "source_order",
      sessions: [{ unitIds: [uid(4)], availableFrom: null, availableUntil: null }],
      recurrenceSessions: [{ availableFrom: null, availableUntil: null }] } };
}
function draft(input: BulkAssignmentPreviewInput): BulkSeriesAssignmentDraft {
  return { kind: "bulk_series", questionMode: input.questionMode, studentIds: input.studentIds,
    exam: { directionRatio: input.englishToKoreanRatio, questionOrderMode: "ascending", passingScore: 80, timing: { mode: "total", totalSeconds: 300 } },
    commonPlan: { ...input.commonPlan,
      sessions: input.commonPlan.sessions.map(s => ({ unitIds: s.unitIds, availableLocalDateTime: s.availableFrom, deadlineLocalDateTime: s.availableUntil })),
      recurrenceSessions: input.commonPlan.recurrenceSessions.map(s => ({ availableLocalDateTime: s.availableFrom, deadlineLocalDateTime: s.availableUntil })) } };
}
const changes: [string, (r: BulkAssignmentPreviewInput) => void][] = [
  ["valid", () => {}], ["direction", r => { r.englishToKoreanRatio = 50; }],
  ["date", r => { r.commonPlan.selectedDateCount = 1; }],
  ["distribution", r => { r.commonPlan.distribution = "split"; }],
  ["split basis", r => { r.commonPlan.splitBasis = "range_unit"; }],
  ["second session", r => { r.commonPlan.sessions.push({ ...r.commonPlan.sessions[0]! }); }],
  ["second recurrence", r => { r.commonPlan.recurrenceSessions.push({ ...r.commonPlan.recurrenceSessions[0]! }); }],
  ["start time", r => { r.commonPlan.sessions[0]!.availableFrom = "2026-09-10T00:00:00Z"; }],
  ["deadline", r => { r.commonPlan.sessions[0]!.availableUntil = "2026-09-11T00:00:00Z"; }],
  ["recurrence time", r => { r.commonPlan.recurrenceSessions[0]!.availableUntil = "2026-09-11T00:00:00Z"; }],
];
describe("question mode policy at draft and request boundaries", () => {
  it.each(assignmentQuestionModes)("preserves valid %s serialization", mode => {
    const input = request(); input.questionMode = mode;
    const value = draft(input);
    expect(validateBulkPreviewProjection(value)).toEqual([]);
    expect(buildBulkAssignmentPreviewRequest(value)).toEqual({
      method: "POST", endpoint: "/api/admin/bulk-assignments/preview", body: input,
    });
    expect(bulkAssignmentPreviewSchema.parse(input)).toEqual(input);
  });
  it.each(changes)("keeps the same mode errors and field paths: %s", (name, change) => {
    for (const mode of assignmentQuestionModes) {
      const input = request(); input.questionMode = mode; change(input);
      const currentDraft = draft(input);
      const local = validateBulkPreviewProjection(currentDraft).filter(x => Object.values(assignmentQuestionModeErrors).includes(x.message as never));
      const parsed = bulkAssignmentPreviewSchema.safeParse(input);
      const remote = parsed.success ? [] : parsed.error.issues.filter(x => Object.values(assignmentQuestionModeErrors).includes(x.message as never));
      expect(remote.map(x => x.message)).toEqual(local.map(x => x.message));
      if (mode !== "book_meaning_choice" && name !== "valid") {
        const direction = name === "direction";
        expect(remote).toContainEqual(expect.objectContaining({
          path: direction ? ["englishToKoreanRatio"] : ["commonPlan", "selectedDateCount"],
          message: direction ? assignmentQuestionModeErrors.direction : assignmentQuestionModeErrors.schedule,
        }));
      }
    }
  });
});
