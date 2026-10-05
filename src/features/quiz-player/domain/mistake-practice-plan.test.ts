import { describe, expect, it } from "vitest";
import { buildMistakePracticePlan, mistakePracticeSourceSchema, type MistakePracticeSource } from "./mistake-practice-plan";
import { practiceSelectionSchema, type PracticeSettings } from "../contracts/practice";

const uuid = "20000000-0000-4000-8000-000000000001";
const settings = (count = 1, ratio: 0 | 50 | 100 = 100): PracticeSettings => ({ questionCount: count, englishToKoreanRatio: ratio,
  timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null });
function source(): MistakePracticeSource {
  return { sourceHash: "a".repeat(64), words: [{ key: "b".repeat(64), meaningKey: "b".repeat(64), wordKey: "same-word", episodeId: uuid,
    headword: "collect", primaryMeaning: "과거 뜻", selectedText: "과거 뜻", testedField: "primary_meaning", latestVocabEntryId: 1,
    choiceSafety: null, frozenOnly: false, sourceQuestionId: uuid, sourceAttemptId: uuid, sourcePhase: "initial", sourceContentHash: "c".repeat(64),
    frozenQuestion: { quizContentMode: "book_meaning_choice", direction: "english_to_korean", prompt: "collect", choices: ["과거 뜻", "뜻 2", "뜻 3", "뜻 4"], correctChoiceIndex: 0 } }],
  candidates: ["collect", "travel", "patient", "enormous"].map((headword, n) => ({ entryId: n + 1, datasetId: uuid,
    headword, primaryMeaning: n === 0 ? "현재 뜻" : `뜻 ${n + 1}`, displayKo: null, choiceSafety: null, eligibleDirections: ["english_to_korean", "korean_to_english"] })) };
}
describe("뜻별 연습 계획", () => {
  it("이전 해시 구간키로 연습을 요청하고 원래 오답을 출제한다", () => {
    const input = source(), episodeId = "abcdef01-2345-f678-0123-456789abcdef";
    input.words[0].episodeId = episodeId;
    const word = input.words[0];
    const selection = { mode: "mistakes", view: "current", stateVersion: "42",
      meanings: [{ wordKey: word.wordKey, meaningKey: word.meaningKey, episodeId }] };
    expect(practiceSelectionSchema.parse(selection)).toEqual(selection);
    const parsed = mistakePracticeSourceSchema.parse(input);
    expect(buildMistakePracticePlan(parsed, settings(), "legacy").items[0].word.episodeId).toBe(episodeId);
    expect(mistakePracticeSourceSchema.safeParse({ ...input, words: [{ ...word, episodeId: "invalid" }] }).success).toBe(false);
    expect(mistakePracticeSourceSchema.safeParse({ ...input, words: [{ ...word, sourceAttemptId: episodeId }] }).success).toBe(false);
  });
  it("현재 사전으로 과거에 틀린 뜻을 바꾸지 않는다", () => {
    const input = source(), plan = buildMistakePracticePlan(input, settings(), "same-seed"), q = plan.items[0].word.frozenQuestion;
    expect(plan.items[0].generated).toBeNull();
    expect(plan.error).toBeNull(); expect(q.choices[q.correctChoiceIndex]).toBe("과거 뜻");
    expect(buildMistakePracticePlan(input, settings(), "same-seed").items).toEqual(plan.items);
  });
  it("같은 카드의 두 뜻을 별도 문항으로 유지하며 애매한 반대 방향은 제한한다", () => {
    const input = source();
    input.candidates[0].primaryMeaning = "과거 뜻";
    input.candidates.push({ ...input.candidates[0], entryId: 5, primaryMeaning: "다른 원뜻" });
    input.words.push({ ...input.words[0], key: "d".repeat(64), meaningKey: "d".repeat(64), latestVocabEntryId: 5, primaryMeaning: "다른 원뜻", selectedText: "다른 원뜻" });
    const plan = buildMistakePracticePlan(input, settings(2, 0), "seed");
    expect(plan.error).toBeNull(); expect(plan.items).toHaveLength(2);
    expect(new Set(plan.items.map(item => item.word.wordKey)).size).toBe(1);
    expect(new Set(plan.items.map(item => item.word.meaningKey)).size).toBe(2);
    expect(new Set(plan.items.map(item => item.generated?.prompt))).toEqual(new Set(["과거 뜻", "다른 원뜻"]));
  });
  it.each(["definition", "example"] as const)("%s는 원문과 원래 방향을 유지한다", field => {
    const input = source(), word = input.words[0]; word.testedField = field; input.candidates = [];
    word.frozenQuestion = { quizContentMode: field === "definition" ? "canonical_definition_to_headword" : "canonical_example_to_headword",
      direction: "korean_to_english", prompt: "The original English text ____", choices: ["collect", "travel", "patient", "enormous"], correctChoiceIndex: 0 };
    const plan = buildMistakePracticePlan(input, settings(1, 0), "seed");
    expect(plan.error).toBeNull(); expect(plan.items[0].generated).toBeNull(); expect(plan.items[0].word.frozenQuestion).toEqual(word.frozenQuestion);
    expect(buildMistakePracticePlan(input, settings(1, 100), "seed").error).toContain("원래 방향");
    const diagnosis = buildMistakePracticePlan(input, settings(1, 50), "mixed", { separateBanks: true });
    expect(diagnosis.directionOptions).toEqual([{ word, english: false, korean: true }]);
  });
  it("시험을 나눌 수 있을 때 같은 단어의 다른 뜻 때문에 새 문항 방향을 버리지 않는다", () => {
    const input = source(); input.candidates[0].primaryMeaning = "과거 뜻";
    const first = input.words[0];
    first.frozenQuestion = { ...first.frozenQuestion, direction: "korean_to_english", prompt: "과거 뜻", choices: ["collect", "travel", "patient", "enormous"] };
    input.candidates.push({ ...input.candidates[0], entryId: 5, primaryMeaning: "다른 원뜻" });
    input.words.push({ ...first, key: "d".repeat(64), meaningKey: "d".repeat(64), latestVocabEntryId: 5,
      primaryMeaning: "다른 원뜻", selectedText: "다른 원뜻", frozenQuestion: { ...first.frozenQuestion, prompt: "다른 원뜻" } });
    expect(buildMistakePracticePlan(input, settings(2, 100), "split").items).toHaveLength(0);
    const split = buildMistakePracticePlan(input, settings(2, 100), "split", { separateBanks: true });
    expect(split.error).toBeNull(); expect(split.items).toHaveLength(2);
    expect(split.items.every(item => item.generated?.direction === "english_to_korean")).toBe(true);
    expect(new Set(split.items.map(item => item.word.meaningKey)).size).toBe(2);
  });
  it("혼합 시험의 일부에는 비율을 다시 반올림하지 않고 정해진 방향별 개수를 사용한다", () => {
    const input = source(); input.candidates[0].primaryMeaning = "과거 뜻";
    input.words = input.candidates.slice(0, 3).map((entry, index) => ({ ...input.words[0], key: `${index}`.repeat(64),
      meaningKey: `${index}`.repeat(64), wordKey: `word-${index}`, latestVocabEntryId: entry.entryId,
      headword: entry.headword, primaryMeaning: entry.primaryMeaning, selectedText: entry.primaryMeaning,
      frozenQuestion: { ...input.words[0].frozenQuestion, prompt: entry.headword, choices: [entry.primaryMeaning,"다른1","다른2","다른3"] } }));
    const plan = buildMistakePracticePlan(input, settings(3, 50), "exact", { separateBanks: true, exactEnglishCount: 1 });
    expect(plan.error).toBeNull(); expect(plan.items).toHaveLength(3);
    expect(plan.items.filter(item => (item.generated ?? item.word.frozenQuestion).direction === "english_to_korean")).toHaveLength(1);
    for (const count of [-1, 4, 0.5, NaN]) expect(() => buildMistakePracticePlan(input, settings(3, 50), "bad", { exactEnglishCount: count })).toThrow("방향별");
  });
  it("카드키·뜻키·구간과 학생 자료 상한을 모두 받고 문항키나 학생ID 입력은 거절한다", () => {
    const input = source(), word = input.words[0];
    const selected = { mode: "mistakes", view: "current", stateVersion: "42", meanings: [{ wordKey: word.wordKey, meaningKey: word.meaningKey, episodeId: word.episodeId }] };
    expect(practiceSelectionSchema.safeParse(selected).success).toBe(true);
    expect(practiceSelectionSchema.safeParse({ ...selected, studentId: uuid }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({ ...selected, meanings: [...selected.meanings, ...selected.meanings] }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({ ...selected, stateVersion: "9223372036854775808" }).success).toBe(false);
    expect(practiceSelectionSchema.safeParse({ ...selected, meanings: [{ ...selected.meanings[0], sourceQuestionId: uuid }] }).success).toBe(false);
  });
});
