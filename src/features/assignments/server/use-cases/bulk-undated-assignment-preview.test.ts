import { beforeEach, expect, it, vi } from "vitest";
import type { RegularAssignmentPreparationCache } from "@/lib/services/regular-assignment-service";
import { bulkAssignmentPreviewSchema } from "../../contracts/bulk-assignment-request";
const mocks = vi.hoisted(() => ({ load: vi.fn(), client: vi.fn(), count: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../queries/bulk-assignment-planning-query", () => ({ loadCommonBulkAssignmentPlanningData: mocks.load, loadSelectedVocabularyRowCount: mocks.count }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { resolveBulkAssignmentPreview } from "./bulk-assignment-preview";
import { prepareCommonPlanSeries } from "./bulk-assignment-series-preparation";
import { calculateRegularAssignmentCapacity } from "@/lib/services/regular-assignment-service";
import type { AdminContext } from "@/lib/auth/admin";

beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(null); mocks.client.mockRejectedValue(new Error("UNEXPECTED_DATABASE_ACCESS")); });
it.each([
  [50, false, 12, 9, 0, 0, 0, 3],
  [100, false, 12, 8, 0, 4, 0, 0],
  [0, false, 12, 4, 0, 8, 0, 0],
  [100, true, 12, 7, 1, 4, 0, 0],
  [100, false, 3, 0, 0, 0, 3, 0],
] as const)("실제 보기/방향/오답 계산의 감소 단계를 검산한다: 방향%i 제외%s 원본%i", async (ratio, excluded, total, available, active, direction, choice, allocation) => {
  const candidates = Array.from({ length: total }, (_, i) => ({ id: i + 1, unitId: "unit", sourceRow: i + 1,
    headword: `fake-${i}`, headwordNormalized: `fake-${i}`, primaryMeaning: `뜻-${i}`, canonicalKey: null,
    canonicalDictionaryId: null, canonicalLexemeId: null,
    eligibleDirections: [i < 8 ? "english_to_korean" as const : "korean_to_english" as const] }));
  const snapshot = { identities: new Set<string>(), queueIds: new Set<string>(),
    reviewIdentities: new Set(excluded ? ["entry:1"] : []), words: [] };
  const noQuery = vi.fn(() => { throw new Error("UNEXPECTED_DATABASE_ACCESS"); });
  const cache = { supabase: Promise.resolve({ from: noQuery, rpc: noQuery }),
    datasets: new Map([["book", Promise.resolve({ datasetResult: { data: { id: "book", title: "가짜", edition: null }, error: null },
      datasetLabel: "가짜", unitResult: { data: [{ id: "unit", unit_label: "DAY 1", sort_index: 1 }], error: null }, allCandidates: candidates })]]),
    activeAssignments: new Map([[JSON.stringify([["student"], "book", null, null]), Promise.resolve({ ...snapshot, byStudent: new Map([["student", snapshot]]) })]]),
  } as unknown as RegularAssignmentPreparationCache;
  const input = { datasetId: "book", unitIds: ["unit"], studentIds: ["student"], englishToKoreanRatio: ratio };
  const actual = await calculateRegularAssignmentCapacity({ ...input, includeCountDiagnostics: true }, {} as AdminContext, cache);
  expect(actual.countStages).toEqual({ candidateCount: total, activeReviewExcludedCount: active, directionExcludedCount: direction,
    choiceExcludedCount: choice, allocationExcludedCount: allocation, availableCount: available });
  const plain = await calculateRegularAssignmentCapacity(input, {} as AdminContext, cache);
  expect(plain).toEqual({ ...actual, countStages: undefined });
  expect(noQuery).not.toHaveBeenCalled();
});
it.each([[12, 5, [4, 4, 4]], [320, 100, [100, 100, 100, 20]], [601, 100, [100, 100, 100, 100, 100, 97, 4]], [5, 4, []]] as const)(
  "일반 단어장 %i개·회차당%i개가 실제 미리보기와 문항 생성에서 누락 없이 분할된다", async (total, perSession, expected) => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const dataset = id(10), unit = id(11), student = id(12);
    const candidates = Array.from({ length: total }, (_, i) => ({ id: i + 1, unitId: unit, sourceRow: i + 1,
      headword: `fake-word-${i}`, headwordNormalized: `fake-word-${i}`, primaryMeaning: `가짜 뜻-${i}`,
      canonicalKey: null, canonicalDictionaryId: null, canonicalLexemeId: null,
      eligibleDirections: ["english_to_korean", "korean_to_english"] as const }));
    const snapshot = { identities: new Set<string>(), queueIds: new Set<string>(), reviewIdentities: new Set<string>(), words: [] };
    const noQuery = vi.fn(() => { throw new Error("UNEXPECTED_DATABASE_ACCESS"); });
    const cache = { supabase: Promise.resolve({ from: noQuery, rpc: noQuery }),
      datasets: new Map([[dataset, Promise.resolve({ datasetResult: { data: { id: dataset, title: "가짜 단어장", edition: null }, error: null },
        datasetLabel: "가짜 단어장", unitResult: { data: [{ id: unit, unit_label: "DAY 1", sort_index: 1 }], error: null }, allCandidates: candidates })]]),
      activeAssignments: new Map([[JSON.stringify([[student], dataset, null, null]), Promise.resolve({ ...snapshot, byStudent: new Map([[student, snapshot]]) })]]),
    } as unknown as RegularAssignmentPreparationCache;
    mocks.load.mockResolvedValue({ dataset: { id: dataset, title: "가짜 단어장", displayName: "가짜 단어장", edition: null, status: "ready", isActive: true, isAssignable: true },
      students: [{ id: student, displayName: "가짜 학생", status: "active", currentVocabDatasetId: dataset }],
      units: [{ id: unit, datasetId: dataset, label: "DAY 1", sortIndex: 1, entryCount: total }] });
    const admin = { userId: id(1), displayName: "가짜 관리자" };
    const input = bulkAssignmentPreviewSchema.parse({ questionMode: "book_meaning_choice", englishToKoreanRatio: 100, studentIds: [student],
      commonPlan: { datasetId: dataset, planNonce: id(13), orderedUnitIds: [unit], distribution: "split", splitBasis: "question_count",
        rangeUnitCounts: [], unitAllocationRule: null, questionCount: { mode: "manual", value: perSession }, selectedDateCount: 0,
        selectionMode: "source_order", overflowPolicy: "leave", extraDatePolicy: "unconfirmed",
        sessions: [{ unitIds: [unit], availableFrom: null, availableUntil: null }], recurrenceSessions: [{ availableFrom: null, availableUntil: null }] } });
    mocks.count.mockResolvedValue(total);
    const result = await resolveBulkAssignmentPreview(input, admin, { regular: cache });
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith(dataset, [unit]);
    expect(result.preview.items[0]!.countBreakdown).toMatchObject({ sourceCount: total, availableCount: total, outsideCandidateListCount: 0, activeReviewExcludedCount: 0 });
    const item = result.preview.items[0]!;
    expect(result.canonicalPlansByStudent).toBeUndefined();
    if (!expected.length) {
      expect(item).toMatchObject({ available: false, sessions: [] });
      expect(result.targetPlansByStudent.size).toBe(0);
    } else {
      expect(item.available, item.error ?? undefined).toBe(true);
      expect(item.sessions.map(s => s.questionCount)).toEqual(expected);
      expect(item.sessions.every(s => s.availableFrom === null && s.availableUntil === null && s.cycleIndex === 0)).toBe(true);
      expect(item).toMatchObject({ selectedQuestionCount: total, scheduledQuestionCount: total, remainingQuestionCount: 0 });
      const prepared = await prepareCommonPlanSeries({ request: input, commonPlan: input.commonPlan, studentId: student, datasetId: dataset,
        availableQuestionCount: item.availableQuestionCount!, maximumSessionQuestionCount: item.maximumSessionQuestionCount!,
        sessions: item.sessions, admin, cache, materializeQuestions: true });
      expect(prepared.sessionTargets).toEqual(result.targetPlansByStudent.get(student));
      expect(prepared.preparedSeries.map(p => p.questions.length)).toEqual(expected);
      const questions = prepared.preparedSeries.flatMap(p => p.questions);
      expect(questions.map(q => q.vocab_entry_id)).toEqual(candidates.map(c => c.id));
      expect(new Set(questions.map(q => q.vocab_entry_id)).size).toBe(total);
      expect(questions.every(q => q.direction === "english_to_korean" && q.choice_vocab_entry_ids.length === 4
        && new Set(q.choice_vocab_entry_ids).size === 4 && q.choice_vocab_entry_ids.includes(q.vocab_entry_id))).toBe(true);
    }
    expect(noQuery).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
