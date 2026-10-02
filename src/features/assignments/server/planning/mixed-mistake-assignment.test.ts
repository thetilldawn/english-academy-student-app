import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), entries: vi.fn(), units: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/eligible-vocabulary-service", () => ({ loadEligibleVocabularyDataset: mocks.entries }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ order: mocks.units }) }) }) }) }));
import { mixedMistakePreviewInputSchema } from "../../contracts/mixed-mistake-assignment";
import { prepareMixedMistakeAssignment } from "./mixed-mistake-assignment";

const id = (n: number) => `a3030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (n: number) => n.toString(16).padStart(64, "0");
const input = mixedMistakePreviewInputSchema.parse({ planVersion: "meaning-episode-v1", studentId: id(1), datasetId: id(2), primaryUnitIds: [id(3)],
  reviewLevels: [1, 2], totalQuestionCount: 4, englishToKoreanRatio: 50, timeLimitSeconds: 60, passingScore: 80,
  retryEnabled: false, retryPassingScore: null, availableUntil: null });
function fixture() {
  const words = [20, 21, 22].map((n, index) => ({ key: hash(n), meaningKey: hash(n), wordKey: `word:wrong${n}`, episodeId: id(n),
    headword: `wrong${n}`, primaryMeaning: `틀렸던 뜻${n}`, selectedText: `틀렸던 뜻${n}`, testedField: "primary_meaning",
    latestVocabEntryId: n, latestDatasetId: id(2), assignmentAvailable: true, choiceSafety: null, frozenOnly: true,
    sourceQuestionId: id(100 + n), sourceAttemptId: id(200 + n), sourcePhase: "retry", sourceContentHash: hash(300 + n),
    stateVersion: "2", queueId: id(400 + n), reasonLevel: 2,
    frozenQuestion: { quizContentMode: "book_meaning_choice", direction: index ? "korean_to_english" : "english_to_korean",
      prompt: index ? `틀렸던 뜻${n}` : `wrong${n}`, choices: index ? [`wrong${n}`, "orange", "circle", "market"] : [`틀렸던 뜻${n}`, "주황", "동그라미", "시장"], correctChoiceIndex: 0 } }));
  const source = { schemaVersion: "mixed-mistake-source-v1", sourceHash: hash(900), words, candidates: [], datasets: [{ id: id(2), available: true }],
    blockedPrimaryMeaningKeys: words.map(word => word.meaningKey), queueIds: words.map(word => word.queueId) };
  const entries = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ id: n, unitId: id(n <= 4 ? 3 : 4), sourceRow: n, headword: `normal${n}`,
    primaryMeaning: `일반뜻${n}`, headwordNormalized: `normal${n}`, canonicalDictionaryId: null, canonicalLexemeId: null,
    canonicalKey: null, eligibleDirections: ["english_to_korean", "korean_to_english"] }));
  mocks.entries.mockResolvedValue(entries);
  mocks.units.mockResolvedValue({ data: [{ id: id(3), sort_index: 1 }, { id: id(4), sort_index: 2 }], error: null });
  const flags = { selectedChanged: false, proofMissing: false };
  mocks.rpc.mockImplementation(async (name: string, args: { p_requests: { entryId: number; direction: string }[]; p_unit_ids: string[] }) => {
    if (name === "prepare_mixed_mistake_source_v1") return { data: source, error: null };
    if (name === "preview_mixed_primary_meanings_v1") return { data: { schemaVersion: "mixed-primary-meanings-v1", datasetId: id(2), unitIds: args.p_unit_ids,
      sourceKind: "raw-v2", sourceHash: hash(args.p_requests.length), items: args.p_requests.slice(flags.proofMissing ? 1 : 0).map(request => ({ ...request,
        meaningKey: hash(request.entryId), wordKey: `word:normal${request.entryId}`,
        meaningProofHash: hash(request.entryId + (flags.selectedChanged && args.p_requests.length === 1 ? 900 : 500)) })) }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  return { source, entries, flags };
}
beforeEach(() => vi.resetAllMocks());
describe("혼합 배정 실제 준비", () => {
  it("1개 일반 문항과 3개 원래 오답의 전체 비율을 맞추고 원 큐와 단계는 보존한다", async () => {
    const f = fixture(), prepared = await prepareMixedMistakeAssignment(id(9), input);
    expect(prepared.preview).toMatchObject({ error: null, primaryQuestionCount: 1, reviewMeaningCount: 3, banks: [{ questionCount: 4, englishToKoreanRatio: 50 }] });
    expect(prepared.primaryRequests).toEqual([{ entryId: 1, direction: "english_to_korean" }]);
    expect(prepared.plan.items.map(item => item.word.sourceQuestionId)).toEqual(f.source.words.map(word => word.sourceQuestionId));
    expect(prepared.source.words.map(word => word.sourcePhase)).toEqual(["retry", "retry", "retry"]);
    expect(JSON.stringify(prepared.preview)).not.toMatch(/correctChoiceIndex|sourceQuestionId|choices/);
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "preview_mixed_primary_meanings_v1")).toHaveLength(2);
  });
  it("저장 확인용 값은 미리보기 확인값에 섞이지 않으며 조건 변경은 확인값을 바꾼다", async () => {
    fixture(); const first = await prepareMixedMistakeAssignment(id(9), input);
    const extra = { ...input, idempotencyKey: id(99), banksConfirmed: true, excludeUnavailableConfirmed: true };
    expect((await prepareMixedMistakeAssignment(id(9), extra)).preview.selectionFingerprint).toBe(first.preview.selectionFingerprint);
    expect((await prepareMixedMistakeAssignment(id(9), { ...input, passingScore: 90 })).preview.selectionFingerprint).not.toBe(first.preview.selectionFingerprint);
  });
  it("선택 범위의 역순과 뜻별 중복 제외를 실제 생성까지 유지한다", async () => {
    const f = fixture(); f.source.blockedPrimaryMeaningKeys.push(hash(5));
    const prepared = await prepareMixedMistakeAssignment(id(9), { ...input, primaryUnitIds: [id(4), id(3)] });
    expect(prepared.primaryRequests[0].entryId).toBe(6);
  });
  it("같은 단어의 다른 뜻은 시험을 나누고 전체 시간은 한 번만 배분한다", async () => {
    const f = fixture(); f.source.words[1].wordKey = f.source.words[0].wordKey;
    const prepared = await prepareMixedMistakeAssignment(id(9), input);
    expect(prepared.preview.banks.length).toBeGreaterThan(1);
    expect(prepared.preview.banks.reduce((sum, bank) => sum + (bank.timeLimitSeconds ?? 0), 0)).toBe(60);
    const short = await prepareMixedMistakeAssignment(id(9), { ...input, timeLimitSeconds: 30 });
    expect(short.preview).toMatchObject({ selectionFingerprint: null, banks: [] });
    expect(short.preview.error).toContain("시간");
  });
  it("전체 수보다 오답이 많거나 원문 방향을 맞출 수 없으면 실패로 설명한다", async () => {
    const f = fixture(); f.source.words.forEach(word => { word.frozenQuestion.direction = "korean_to_english"; });
    const prepared = await prepareMixedMistakeAssignment(id(9), input);
    expect(prepared.preview.error).toContain("출제 비율");
    expect(prepared.preview.selectionFingerprint).toBeNull();
    expect((await prepareMixedMistakeAssignment(id(9), { ...input, englishToKoreanRatio: 100 })).preview.unavailableCount).toBe(3);
  });
  it.each(["selectedChanged", "proofMissing"] as const)("%s 뜻 증명 변경·누락을 빈 목록으로 숨기지 않는다", async flag => {
    const f = fixture(); f.flags[flag] = true;
    await expect(prepareMixedMistakeAssignment(id(9), input)).rejects.toMatchObject({ status: 409, code: "source_changed" });
  });
  it("사라진 단원과 순서 오류는 저장 불명 상태가 아닌 범위 변경으로 돌려준다", async () => {
    fixture();
    await expect(prepareMixedMistakeAssignment(id(9), { ...input, primaryUnitIds: [id(99)] })).rejects.toMatchObject({ status: 409, code: "source_changed" });
  });
});
