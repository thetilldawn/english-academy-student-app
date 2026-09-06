import { describe, expect, it } from "vitest";
import { buildBulkPlanAudience } from "./bulk-plan-audience";
import { vocabQuestionView, vocabUnitAllocationView } from "./vocab-question-view";

const base: Parameters<typeof vocabQuestionView>[0] = {
  audience: { mode: "single", sameCount: 1, separateCount: 0, totalCount: 1,
    reference: { availableQuestionCount: 86, selectedQuestionCount: 40, remainingQuestionCount: 46, defaultSessionCount: 3 } },
  defaultSessionCount: 1, distribution: "split", assignmentMode: "word_count", questionCountMode: "all", manualQuestionCount: 0,
  previewState: "ready",
};
describe("수량 표시값", () => {
  it.each([
    ["unselected", "시험 범위를 선택해 주세요."],
    ["loading", "출제 가능 단어 수를 확인하는 중입니다."],
    ["error", "출제 가능 단어 수를 확인하지 못했습니다. 다시 시도해 주세요."],
    ["blocked", "출제 가능 단어 수는 배정 조건을 정한 뒤 확인할 수 있습니다."],
  ] as const)("현재 %s 상태는 과거 숫자 대신 쉬운 안내를 표시한다", (previewState, message) => {
    const view = vocabQuestionView({ ...base, previewState });
    expect(view.countSummary).toBe(message);
    expect(view.allCountLabel).toBe("전체 사용");
    expect(view.manualCountValue).toBe("");
    expect(view.manualActivationCount).toBe(0);
    expect(vocabQuestionView({ ...base, previewState, questionCountMode: "manual", manualQuestionCount: 20 }).manualCountValue).toBe(20);
  });
  it("정상 0개와 공통 학생의 예외 수량을 미확정과 구분한다", () => {
    const zero = vocabQuestionView({ ...base, audience: { ...base.audience,
      reference: { availableQuestionCount: 0, selectedQuestionCount: 0, remainingQuestionCount: 0, defaultSessionCount: 0 } } });
    expect(zero.countSummary).toContain("출제 가능 0개");
    expect(zero.allCountLabel).toBe("전체 사용 · 0개");
    const common = vocabQuestionView({ ...base, audience: { ...base.audience, mode: "common", sameCount: 2, separateCount: 1, totalCount: 3 } });
    expect(common.countSummary).toContain("공통 2명 기준");
    expect(common.countSummary).toContain("다른 1명");
  });
  it.each([
    ["all_sessions", "repeat", "출제 가능 86개 · 배정 40개 · 남음 46개 · 회차당 40개"],
    ["per_session", "split", "출제 가능 86개 · 범위별 배정 · 기본 3회"],
    ["word_count", "split", "출제 가능 86개 · 배정 40개 · 남음 46개 · 기본 3회"],
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
    expect(empty).toEqual({ countSummary: "출제 가능 단어 수를 확인하지 못했습니다. 아래 미리보기 안내를 확인해 주세요.", allCountLabel: "전체 사용", canRetry: false, manualCountValue: "", manualActivationCount: 0 });
    const audience = buildBulkPlanAudience({ commonPlanSummary: null,
      items: [86, 640].map((count) => ({ available: true, error: null, availableQuestionCount: count,
        selectedQuestionCount: 40, remainingQuestionCount: count - 40, defaultSessionCount: 3 })) });
    expect(vocabQuestionView({ ...base, audience }).countSummary).toBe("학생별 출제 가능 수는 마지막 미리보기에서 확인해 주세요.");
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
