import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => mocks }));
import { loadEntryApprovedKoreanPronunciationRegistry, loadApprovedKoreanPronunciationRegistry } from "./pronunciation-registry";
import { getStudentAttempt } from "./attempt-query";
import { getAttemptQuestionResults } from "./attempt-result-query";

const url = "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3";
const variant = "mw:" + "1".repeat(20);
function row(id = 7) {
  return {
    vocab_entry_id: id, dictionary_id: "word:sample",
    approval: { dictionary_id: "word:sample", pronunciation_variant_id: variant, display_pronunciation_ko: "승인",
      segments: [{ text: "승인", stress: "primary" }], review_status: "approved",
      source_content_sha256: "a".repeat(64), source_review_run_id: "user-directed:TEST" },
    identity: { identity_id: "pron:v2:" + "2".repeat(64), pronunciation_variant_id: variant,
      audio_provider: "merriam_webster", official_audio_url: url, sound_audio: "test0001",
      storage_bucket: null, storage_object_key: null, audio_sha256: null, byte_count: null,
      profile_id: null, request_sha256: null, model: null, voice: null,
      display_pronunciation_ko: "자동", segments: [{ text: "자동", stress: "primary" }],
      engine_version: "cmudict-arpabet-hangul-render-v1", playback_enabled: true, display_enabled: true,
      identity_content_sha256: "A".repeat(64) },
  };
}
let tables: Record<string, unknown> = {};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://wojxpruvbjzbhrpmsbuy.supabase.co");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  tables = {};
  mocks.rpc.mockResolvedValue({ data: [row()], error: null });
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(() => chain), in: vi.fn(() => chain), eq: vi.fn(() => chain),
      order: vi.fn(() => chain), maybeSingle: vi.fn(() => chain),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
    };
    return chain;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("exact entry pronunciation corrections", () => {
  it("validates immutable identity and returns display-only proof", async () => {
    const result = await loadEntryApprovedKoreanPronunciationRegistry([7, 7, 0, NaN]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_entry_approved_korean_pronunciations_v1", { p_vocab_entry_ids: [7] });
    expect(result.get(7)).toMatchObject({ dictionaryId: "word:sample", pronunciation: { displayKo: "승인", audioUrl: url, variantId: variant } });
  });
  it("has no request when empty and chunks unique IDs at 500", async () => {
    expect((await loadEntryApprovedKoreanPronunciationRegistry([])).size).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await loadEntryApprovedKoreanPronunciationRegistry(Array.from({ length: 1001 }, (_, i) => i + 1));
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_vocab_entry_ids.length)).toEqual([500, 500, 1]);
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("rejects unrequested/duplicate/malformed/incorrect source or variant responses", async () => {
    const base = row();
    const cases = [
      [row(8)], [base, base], [null], [{ ...base, identity: null }],
      [{ ...base, dictionary_id: "word:other" }],
      [{ ...base, approval: { ...base.approval, source_review_run_id: "unapproved" } }],
      [{ ...base, approval: { ...base.approval, source_content_sha256: "b".repeat(64) } }],
      [{ ...base, approval: { ...base.approval, pronunciation_variant_id: "mw:other" } }],
      [{ ...base, approval: { ...base.approval, segments: [{ text: "승", stress: "primary" }, { text: "인", stress: "primary" }] } }],
    ];
    for (const data of cases) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await loadEntryApprovedKoreanPronunciationRegistry([7])).size).toBe(0);
    }
  });
  it("failure is not approval, raw SQL and partial results never escape", async () => {
    for (const response of [{ data: null, error: null }, { data: [], error: { message: "secret SQL" } }]) {
      mocks.rpc.mockResolvedValueOnce(response);
      expect((await loadEntryApprovedKoreanPronunciationRegistry([7])).size).toBe(0);
    }
    mocks.rpc.mockRejectedValueOnce(new Error("private token"));
    expect((await loadEntryApprovedKoreanPronunciationRegistry([7])).size).toBe(0);
    mocks.rpc.mockResolvedValueOnce({ data: [row()], error: null }).mockResolvedValueOnce({ data: null, error: { code: "timeout" } });
    expect((await loadEntryApprovedKoreanPronunciationRegistry(Array.from({ length: 501 }, (_, i) => i + 1))).size).toBe(0);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/secret SQL|private token/);
  });
  it("legacy dictionary read cannot bypass exact-entry proof", async () => {
    const user = row().approval;
    tables.vocab_approved_korean_pronunciations = [user, { ...user, dictionary_id: "word:legacy", source_review_run_id: "review-a+review-b" }];
    const result = await loadApprovedKoreanPronunciationRegistry(["word:sample", "word:legacy"]);
    expect([...result.keys()]).toEqual(["word:legacy\u0000" + variant]);
  });
  it("attempt target and English choices without dictionary snapshots share corrections without answers", async () => {
    const identity = row().identity;
    tables.quiz_attempts = { id: "attempt", assignment_id: "assignment", status: "in_progress", phase: "initial", started_at: "2026-01-01T00:00:00Z", deadline_at: null };
    tables.assignments = { title: "Fake", timing_mode: "none", quiz_content_mode: "canonical_definition_to_headword" };
    tables.quiz_questions = [{
      id: "question", vocab_entry_id: 7, order_index: 1, direction: "korean_to_english", prompt: "fake definition",
      choices: ["sample", "other", "another", "last"], correct_choice_index: 0,
      initial_choice_index: null, initial_is_correct: null, retry_choice_index: null, retry_is_correct: null, prior_wrong_count: 0,
      assignment_question: { vocab_entry_id: 7, choice_vocab_entry_ids: [7, 8, 9, 10] },
    }];
    tables.vocab_pronunciation_releases_v2 = [{ release_id: "active" }];
    tables.vocab_entry_pronunciation_bindings_v2 = [{ release_id: "active", vocab_entry_id: 7, identity_id: identity.identity_id }];
    tables.vocab_pronunciation_identities_v2 = [identity];
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "list_active_vocab_pronunciation_bindings_v3"
        ? tables.vocab_entry_pronunciation_bindings_v2 : [row()],
      error: null,
    }));
    const result = await getStudentAttempt("test-student", "attempt");
    expect(result?.questions[0].pronunciation.available).toBe(false);
    expect(result?.questions[0].choicePronunciations[0].displayKo).toBe("승인");
    expect(result?.questions[0].revealedCorrectChoiceIndex).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/source_content|source_review|identity_content|dictionaryId/);
    const results = await getAttemptQuestionResults("attempt");
    expect(results[0].pronunciation.displayKo).toBe("승인");
    expect(results[0].pronunciation.audioUrl).toBe(url);
    tables.assignments = { title: "Fake", timing_mode: "none", quiz_content_mode: "canonical_headword_to_definition" };
    (tables.quiz_questions as { direction: string }[])[0].direction = "english_to_korean";
    const inverse = await getStudentAttempt("test-student", "attempt");
    expect(inverse?.questions[0].pronunciation.displayKo).toBe("승인");
    expect(inverse?.questions[0].choicePronunciations.every(p => !p.available && !p.audioUrl && !p.displayKo)).toBe(true);
  });
});
