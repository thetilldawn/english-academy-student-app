import { describe, expect, it } from "vitest";
import { reviewedChoiceSafetySchema } from "./choice-safety";
import { buildQuizChoiceIndex, quizIndependentTargetDirectionEligibility, selectSimilarQuizChoicePool } from "./choice-policy";
import { createExplicitTargetedQuizQuestions, createQuizQuestions } from "./question-generator";
import type { QuizDirection, QuizVocabularyEntry } from "./question-types";

function fixtures(): QuizVocabularyEntry[] {
  return [
    { id: 1, headword: "first", primaryMeaning: "가짜 기준 뜻", choiceSafety: {
      version: "reviewed-choice-conflicts-v1", evidenceSha256: "a".repeat(64),
      target: { headword: "first", primaryMeaning: "가짜 기준 뜻" }, exclusions: [
        { direction: "english_to_korean", choice: "가짜 비슷한 뜻" },
        { direction: "korean_to_english", choice: "similar" },
      ],
    } },
    { id: 2, headword: "similar", primaryMeaning: "가짜 비슷한 뜻" },
    { id: 3, headword: "copy", primaryMeaning: "가짜 비슷한 뜻" },
    { id: 4, headword: "similar", primaryMeaning: "가짜 다른 뜻" },
    ...Array.from({ length: 4 }, (_, i) => ({ id: 5 + i, headword: `safe${i}`, primaryMeaning: `안전한 가짜 뜻 ${i}` })),
  ];
}
const fixedRandom = () => 0.4;

describe("reviewed choice exclusions through the real engine", () => {
  it.each(["english_to_korean", "korean_to_english"] as const)("excludes the actual display in %s even with other occurrences and copied IDs", direction => {
    const pool = fixtures();
    for (const groupBySimilarity of [false, true]) {
      const index = buildQuizChoiceIndex(pool, { groupBySimilarity });
      const [q] = createExplicitTargetedQuizQuestions([{ id: 1, direction }], pool, fixedRandom, { choiceIndex: index });
      expect(q!.choices).toHaveLength(4);
      expect(q!.choices).not.toContain(direction === "english_to_korean" ? "가짜 비슷한 뜻" : "similar");
      expect(q!.choices[q!.correctChoiceIndex]).toBe(direction === "english_to_korean" ? pool[0]!.primaryMeaning : pool[0]!.headword);
    }
  });
  it("keeps a directional exclusion from becoming an unreviewed reverse exclusion", () => {
    const pool = fixtures();
    pool[0]!.choiceSafety!.exclusions = [{ direction: "english_to_korean", choice: "가짜 비슷한 뜻" }];
    const smaller = [pool[0]!, pool[1]!, pool[4]!, pool[5]!];
    const eligibility = quizIndependentTargetDirectionEligibility([pool[0]!], smaller)[0]!;
    expect(eligibility.eligibleDirections).toEqual(["korean_to_english"]);
    expect(createExplicitTargetedQuizQuestions([{ id: 1, direction: "korean_to_english" }], smaller, fixedRandom)[0]!.choices).toContain("similar");
  });
  it.each([2, 3])("agrees on eligibility and actual generation with %i safe distractors", safe => {
    const source = fixtures(), pool = [source[0]!, source[1]!, source[2]!, ...source.slice(4, 4 + safe)];
    const eligible = quizIndependentTargetDirectionEligibility([pool[0]!], pool)[0]!.eligibleDirections;
    for (const direction of ["english_to_korean", "korean_to_english"] as QuizDirection[]) {
      if (safe === 2 && direction === "english_to_korean") {
        expect(eligible).not.toContain(direction);
        expect(() => createExplicitTargetedQuizQuestions([{ id: 1, direction }], pool)).toThrow("보기가 부족");
      } else {
        expect(eligible).toContain(direction);
        expect(createExplicitTargetedQuizQuestions([{ id: 1, direction }], pool)[0]!.choices).toHaveLength(4);
      }
    }
  });
  it("continues past an excluded similarity bucket", () => {
    const pool = fixtures();
    pool[0]!.choiceSafety!.exclusions.push(...pool.slice(4, 7).map(e => ({ direction: "english_to_korean" as const, choice: e.primaryMeaning })));
    pool.push(...Array.from({ length: 3 }, (_, i) => ({ id: i + 20, headword: `a long safe fixture phrase ${i}`, primaryMeaning: `서로 다른 충분히 긴 가짜 용례와 뜻 ${i}` })));
    const index = buildQuizChoiceIndex(pool, { groupBySimilarity: true });
    expect(selectSimilarQuizChoicePool(pool[0]!, "english_to_korean", index).some(e => e.id >= 20)).toBe(true);
    expect(createExplicitTargetedQuizQuestions([{ id: 1, direction: "english_to_korean" }], pool, fixedRandom, { choiceIndex: index })[0]!.choices).toHaveLength(4);
  });
  it.each(["evidence", "exclusions"])("rejects a cached index after %s changes on the same entry object", field => {
    const pool = fixtures(), index = buildQuizChoiceIndex(pool);
    if (field === "evidence") pool[0]!.choiceSafety!.evidenceSha256 = "b".repeat(64);
    else pool[0]!.choiceSafety!.exclusions.push({ direction: "english_to_korean", choice: "사용하지 않은 뜻" });
    expect(() => createExplicitTargetedQuizQuestions([{ id: 1, direction: "english_to_korean" }], pool, fixedRandom, { choiceIndex: index })).toThrow("색인");
  });
  it.each([0, 50, 100])("keeps real generated papers safe at ratio %i in either source order", ratio => {
    for (const reverse of [false, true]) {
      const pool = fixtures().filter(e => ![3, 4].includes(e.id));
      if (reverse) pool.reverse();
      const questions = createQuizQuestions(pool, 6, ratio, fixedRandom);
      expect(questions).toHaveLength(6);
      const q = questions.find(q => q.vocabEntryId === 1)!;
      expect(q.choices).not.toContain(q.direction === "english_to_korean" ? "가짜 비슷한 뜻" : "similar");
    }
  });
  it("rejects unknown, duplicated, self-excluding or unbound policies", () => {
    const policy = fixtures()[0]!.choiceSafety!;
    expect(reviewedChoiceSafetySchema.safeParse({ ...policy, version: "unreviewed" }).success).toBe(false);
    expect(reviewedChoiceSafetySchema.safeParse({ ...policy, exclusions: [...policy.exclusions, policy.exclusions[0]] }).success).toBe(false);
    expect(reviewedChoiceSafetySchema.safeParse({ ...policy, exclusions: [{ direction: "korean_to_english", choice: "ＦＩＲＳＴ" }] }).success).toBe(false);
    const pool = fixtures(); pool[0]!.choiceSafety!.target.headword = "other";
    expect(() => buildQuizChoiceIndex(pool)).toThrow("검토 정보");
  });
});
