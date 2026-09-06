import { describe, expect, it } from "vitest";
import { buildBulkPlanAudience } from "./bulk-plan-audience";
import { vocabQuestionView, vocabUnitAllocationView } from "./vocab-question-view";

const base: Parameters<typeof vocabQuestionView>[0] = {
  audience: { mode: "single", sameCount: 1, separateCount: 0, totalCount: 1,
    reference: { availableQuestionCount: 86, selectedQuestionCount: 40, remainingQuestionCount: 46, defaultSessionCount: 3 } },
  defaultSessionCount: 1, distribution: "split", assignmentMode: "word_count", questionCountMode: "all", manualQuestionCount: 0,
};
describe("수량 표시값", () => {
  it.each([
    ["all_sessions", "repeat", "전체 86개 · 배정 40개 · 남음 46개 · 회차당 40개"],
    ["per_session", "split", "전체 86개 · 범위별 배정 · 기본 3회"],
    ["word_count", "split", "전체 86개 · 배정 40개 · 남음 46개 · 기본 3회"],
  ] as const)("%s의 기존 요약", (assignmentMode, distribution, expected) => {
    expect(vocabQuestionView({ ...base, assignmentMode, distribution }).countSummary).toBe(expected);
  });
  it("전체↔직접 선택의 입력 보존과 500개 활성화 상한", () => {
    expect(vocabQuestionView(base)).toMatchObject({ manualCountValue: 86, manualActivationCount: 86 });
    expect(vocabQuestionView({ ...base, manualQuestionCount: 20 }).manualCountValue).toBe(20);
    expect(vocabQuestionView({ ...base, questionCountMode: "manual" }).manualCountValue).toBe(0);
    expect(vocabQuestionView({ ...base, audience: { ...base.audience,
      reference: { ...base.audience.reference!, availableQuestionCount: 640 } } }))
      .toMatchObject({ manualCountValue: 640, manualActivationCount: 500 });
  });
  it("미준비와 여러 학생의 서로 다른 값을 구분한다", () => {
    const empty = vocabQuestionView({ ...base, audience: buildBulkPlanAudience(null) });
    expect(empty).toEqual({ countSummary: "범위와 단어 수를 정하면 기본 회차를 계산합니다.", manualCountValue: "", manualActivationCount: 0 });
    const audience = buildBulkPlanAudience({ commonPlanSummary: null,
      items: [86, 640].map((count) => ({ available: true, error: null, availableQuestionCount: count,
        selectedQuestionCount: 40, remainingQuestionCount: count - 40, defaultSessionCount: 3 })) });
    expect(vocabQuestionView({ ...base, audience }).countSummary).toBe("학생별 계획을 마지막 미리보기에서 확인해 주세요.");
  });
});
describe("단위 배분 표시", () => {
  const units = [1, 2, 3].map((n) => ({ id: `u${n}`, label: `DAY ${n}`, sortIndex: n }));
  it("날짜 없는5회 분할은 시각 선택 없이 회차를 표시한다", () => {
    expect(vocabUnitAllocationView({ assignmentMode: "per_session", scheduleEnabled: false,
      defaultSessionCount: 5, remainingUnitIds: [], selectedUnits: units }))
      .toEqual({ visible: true, showUnitsPerSession: true, showOverflow: false, summary: "기본 5회" });
  });
  it("남은 범위의 역순을 정렬하지 않는다", () => {
    expect(vocabUnitAllocationView({ assignmentMode: "per_session", scheduleEnabled: true,
      defaultSessionCount: 3, remainingUnitIds: ["u3", "u2"], selectedUnits: units }).summary)
      .toBe("기본 3회 · 남음 DAY 3~DAY 2 (2단위)");
  });
  it.each(["all_sessions", "word_count"] as const)("%s에서 단위 수 요약을 숨긴다", (assignmentMode) => {
    expect(vocabUnitAllocationView({ assignmentMode, scheduleEnabled: undefined,
      defaultSessionCount: 3, remainingUnitIds: [], selectedUnits: units }))
      .toMatchObject({ visible: assignmentMode === "word_count", showUnitsPerSession: false, showOverflow: true, summary: null });
  });
});
