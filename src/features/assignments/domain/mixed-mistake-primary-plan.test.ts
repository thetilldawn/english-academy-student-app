import { describe, expect, it } from "vitest";
import { PrimaryPlannerLimitError, selectMixedPrimaryExact, type MixedPrimaryCandidate, type MixedPrimaryPick } from "./mixed-mistake-primary-plan";

const E = "english_to_korean", K = "korean_to_english";
const candidate = (entryId: number, english: string | null, korean: string | null): MixedPrimaryCandidate => ({
  entryId, options: [ ...(english ? [{ direction: E as typeof E, meaningKey: english, meaningProofHash: `E${entryId}` }] : []),
    ...(korean ? [{ direction: K as typeof K, meaningKey: korean, meaningProofHash: `K${entryId}` }] : []) ],
});
const review = { meaningKeys: ["review"], englishMin: 0, englishMax: 1 };
const run = (candidates: MixedPrimaryCandidate[], totalQuestionCount: number, englishCount: number) =>
  selectMixedPrimaryExact({ candidates, totalQuestionCount, englishCount, review });

describe("혼합 시험의 뜻별 일반 문항 선택", () => {
  it("오답과 겹치는 방향만 빼고 같은 항목의 다른 뜻은 유지한다", () => {
    const result = run([candidate(1, "review", "other")], 2, 1)!;
    expect(result.primary).toMatchObject([{ entryId: 1, direction: K, meaningKey: "other" }]);
    expect(result.reviewEnglishCount).toBe(1);
    expect(selectMixedPrimaryExact({ candidates: [candidate(1, "reserved", "other")], totalQuestionCount: 2,
      englishCount: 1, review, blockedMeaningKeys: ["reserved"] })).toEqual(result);
  });
  it("같은 단어 항목에 방향별 뜻이 교차하면 불가능한 반반 배정을 거절한다", () => {
    const candidates = [candidate(1, "a", "b"), candidate(2, "b", "a")];
    expect(selectMixedPrimaryExact({ candidates, totalQuestionCount: 3, englishCount: 1,
      review: { ...review, englishMax: 0 } })).toBeNull();
    expect(run(candidates, 3, 2)?.primary.map(p => p.direction)).toEqual([E, E]);
  });
  it("공유 뜻 때문에 뒤쪽 항목이 필요해도 전체 원자료 순서에서 가장 앞선 조합을 고른다", () => {
    const result = run([candidate(1, "a", null), candidate(2, "a", null), candidate(3, null, "c"), candidate(4, "d", null)], 3, 1)!;
    expect(result.primary.map(p => p.entryId)).toEqual([1, 3]);
    expect(result.reviewEnglishCount).toBe(0);
  });
  it("일반 문항이 없어도 오답 전체와 정확한 방향 수를 유지한다", () => {
    expect(run([], 1, 1)).toEqual({ primary: [], reviewEnglishCount: 1 });
    expect(run([], 2, 1)).toBeNull();
  });
  it("한도 초과와 잘못된 입력을 출제 가능 0개로 숨기지 않는다", () => {
    const candidates = [candidate(1, "a", "b"), candidate(2, "b", "a")];
    expect(() => selectMixedPrimaryExact({ candidates, totalQuestionCount: 3, englishCount: 1, review, limits: { states: 1, steps: 100 } })).toThrow(PrimaryPlannerLimitError);
    expect(() => run([candidate(1, "a", null), candidate(1, null, "b")], 2, 1)).toThrow("항목");
    expect(() => selectMixedPrimaryExact({ candidates: [], totalQuestionCount: 2, englishCount: 1,
      review: { meaningKeys: ["a", "a"], englishMin: 0, englishMax: 2 } })).toThrow("입력");
  });
  it("중복을 뺀 후보가 부족하면 비싼 계산 전에 불가능으로 반환한다", () => {
    expect(selectMixedPrimaryExact({ candidates: [candidate(1, "a", null), candidate(2, "a", null)], totalQuestionCount: 4,
      englishCount: 4, review, limits: { states: 1, steps: 1 } })).toBeNull();
    expect(() => selectMixedPrimaryExact({ candidates: Array.from({ length: 60 }, (_, i) => candidate(i + 1, `m${i}`, `m${(i + 1) % 60}`)),
      totalQuestionCount: 40, englishCount: 20, review, limits: { states: 100000, steps: 5000 } })).toThrow(PrimaryPlannerLimitError);
  });
  it("공유 뜻이 없는 1만 후보는 500문항을 계산 한도 내에서 고른다", () => {
    const candidates = Array.from({ length: 10000 }, (_, i) => candidate(i + 1, `e${i}`, `k${i}`));
    const result = selectMixedPrimaryExact({ candidates, totalQuestionCount: 500, englishCount: 250, review,
      limits: { states: 1, steps: 1000 } })!;
    expect(result.primary).toHaveLength(499);
    expect(result.primary.at(-1)?.entryId).toBe(499);
    expect(result.primary.filter(p => p.direction === E).length + result.reviewEnglishCount).toBe(250);
  });
  it("작은 무작위 원천을 모든 실제 조합과 대조해 가능 여부·순서·방향·뜻 중복을 검산한다", () => {
    let seed = 9183;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const earlier = (a: MixedPrimaryPick[], b: MixedPrimaryPick[]) => {
      for (let i = 0; i < a.length; i++) if (a[i].sourceIndex !== b[i].sourceIndex) return a[i].sourceIndex < b[i].sourceIndex;
      return false;
    };
    for (let trial = 0; trial < 400; trial++) {
      const candidates = Array.from({ length: 6 }, (_, i) => candidate(i + 1, random(3) ? `m${random(6)}` : null, random(3) ? `m${random(6)}` : null));
      const n = random(6) + 1, e = random(n + 1), rE = random(2), rB = rE ? 1 : random(2);
      const reviewCase = { meaningKeys: ["m0"], englishMin: rE, englishMax: rB };
      let best: MixedPrimaryPick[] | null = null;
      const enumerate = (index: number, path: MixedPrimaryPick[], used: Set<string>, english: number) => {
        if (path.length === n - 1) {
          if (e - english >= rE && e - english <= rB && (!best || earlier(path, best))) best = path;
          return;
        }
        if (index >= candidates.length) return;
        enumerate(index + 1, path, used, english);
        for (const option of candidates[index].options) if (!used.has(option.meaningKey)) {
          enumerate(index + 1, [...path, { ...option, entryId: index + 1, sourceIndex: index }],
            new Set([...used, option.meaningKey]), english + Number(option.direction === E));
        }
      };
      enumerate(0, [], new Set(["m0"]), 0);
      const result = selectMixedPrimaryExact({ candidates, totalQuestionCount: n, englishCount: e, review: reviewCase });
      const expected = best as MixedPrimaryPick[] | null;
      expect(result?.primary.map(p => p.entryId) ?? null, `trial ${trial}`).toEqual(expected?.map(p => p.entryId) ?? null);
      if (result) {
        expect(new Set(result.primary.map(p => p.meaningKey)).size).toBe(n - 1);
        expect(result.primary.filter(p => p.direction === E).length + result.reviewEnglishCount).toBe(e);
        expect(result.reviewEnglishCount).toBeGreaterThanOrEqual(rE);
        expect(result.reviewEnglishCount).toBeLessThanOrEqual(rB);
      }
    }
  });
});
