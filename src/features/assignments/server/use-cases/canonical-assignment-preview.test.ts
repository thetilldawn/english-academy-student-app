import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminContext } from "@/lib/auth/admin";
import type { BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
const mocks = vi.hoisted(() => ({ load: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../queries/bulk-assignment-planning-query", () => ({ loadCommonBulkAssignmentPlanningData: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { resolveCanonicalBulkAssignmentPreview } from "./canonical-assignment-preview";

function request(): BulkAssignmentPreviewInput {
  return { questionMode: "canonical_example_to_headword", englishToKoreanRatio: 0, studentIds: ["fake-student"],
    commonPlan: { datasetId: "fake-book", planNonce: "fake-nonce", orderedUnitIds: ["fake-unit"], distribution: "repeat",
      splitBasis: "question_count", rangeUnitCounts: [], unitAllocationRule: null, questionCount: { mode: "all" },
      overflowPolicy: "leave", extraDatePolicy: "unconfirmed", selectedDateCount: 0, selectionMode: "source_order",
      sessions: [{ unitIds: ["fake-unit"], availableFrom: null, availableUntil: null }],
      recurrenceSessions: [{ availableFrom: null, availableUntil: null }] } };
}
const changes: [string, (r: BulkAssignmentPreviewInput) => void][] = [
  ["direction", r => { r.englishToKoreanRatio = 50; }],
  ["date", r => { r.commonPlan.selectedDateCount = 1; }],
  ["distribution", r => { r.commonPlan.distribution = "split"; }],
  ["split basis", r => { r.commonPlan.splitBasis = "range_unit"; }],
  ["second session", r => { r.commonPlan.sessions.push({ ...r.commonPlan.sessions[0]! }); }],
  ["second recurrence", r => { r.commonPlan.recurrenceSessions.push({ ...r.commonPlan.recurrenceSessions[0]! }); }],
  ["start", r => { r.commonPlan.sessions[0]!.availableFrom = "2026-09-10T00:00:00Z"; }],
  ["end", r => { r.commonPlan.sessions[0]!.availableUntil = "2026-09-11T00:00:00Z"; }],
  ["recurrence time", r => { r.commonPlan.recurrenceSessions[0]!.availableUntil = "2026-09-11T00:00:00Z"; }],
];
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockRejectedValue(new Error("LOCAL_READ_BOUNDARY")); });
describe("canonical server restriction before data access", () => {
  it.each(changes)("rejects %s before any query", async (_name, change) => {
    for (const mode of ["canonical_definition_to_headword", "canonical_example_to_headword"] as const) {
      const input = request(); input.questionMode = mode; change(input);
      await expect(resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext))
        .rejects.toMatchObject({ reason: "invalid_selection", message: "영영풀이·예문 시험은 시험일 없이 1회만 바로 배정할 수 있습니다." });
    }
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["canonical_definition_to_headword", "canonical_example_to_headword"] as const)("allows valid %s through the unchanged read boundary", async mode => {
    const input = request(); input.questionMode = mode;
    await expect(resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext)).rejects.toThrow("LOCAL_READ_BOUNDARY");
    expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.client).not.toHaveBeenCalled();
  });
});
