import { describe, expect, it } from "vitest";
import { formatKoreanDateTime } from "@/lib/format";
import { directReviewPreviewRows, directReviewRangeView } from "./direct-review-view";

const rangeInput: Parameters<typeof directReviewRangeView>[0] = {
  summary: { status: "ready", message: "" }, capacity: { status: "idle", message: "" },
  hasDatasetOptions: true, totalAvailableCount: 3, questionCount: 3,
  knownLevelCounts: { level1: null, level2: 0 }, selectedLevels: [1],
};

describe("오답 표시 변환", () => {
  it.each(["idle", "loading", "error"] as const)("요약 %s는 정상0을 표시하지 않는다", (status) => {
    const view = directReviewRangeView({ ...rangeInput, totalAvailableCount: 0,
      summary: { status, message: status === "error" ? "오답을 불러오지 못했습니다." : "" } });
    expect(view.totalLabel).not.toContain("0개");
    expect(view.datasetDisabled).toBe(true);
    expect(view.levels.every((l) => l.disabled)).toBe(true);
    expect(status === "error" ? view.calculation.error : view.calculation.countText)
      .toBe(status === "error" ? "오답을 불러오지 못했습니다." : "현재 오답 단어 계산 중…");
  });
  it.each([
    ["idle", "단어장과 오답 단계를 선택해 주세요."],
    ["loading", "오답 단어 계산 중…"],
    ["ready", "단어 3개"],
    ["error", "계산을 완료하지 못했습니다."],
  ] as const)("계산 %s 상태 안내", (status, expected) => {
    const view = directReviewRangeView({ ...rangeInput,
      capacity: { status, message: status === "error" ? expected : "" } });
    expect(view.calculation.countText).toBe(expected);
    expect(view.calculation.status).toBe(status);
    expect(view.calculation.retryLabel).toBe("다시 계산하기");
  });
  it("정상0과 미계산 단계, 선택 상태를 구분한다", () => {
    const view = directReviewRangeView(rangeInput);
    expect(view.levels).toEqual([
      { value: 1, label: "1회 계산 전", selected: true, disabled: false },
      { value: 2, label: "2회 이상 0개", selected: false, disabled: true },
    ]);
    const empty = directReviewRangeView({ ...rangeInput, totalAvailableCount: 0, hasDatasetOptions: false });
    expect(empty.totalLabel).toBe("미배정 오답 전체 0개");
    expect(empty.calculation.countText).toBe("현재 배정할 오답이 없습니다.");
    expect(empty.datasetDisabled).toBe(true);
    expect(directReviewRangeView({ ...rangeInput, questionCount: 0,
      capacity: { status: "ready", message: "" } }).calculation.countText).toBe("현재 배정할 오답이 없습니다.");
  });
  it("요약 오류가 계산 오류보다 우선이고 다른 복구를 표시한다", () => {
    const view = directReviewRangeView({ ...rangeInput,
      summary: { status: "error", message: "요약 확인 실패" },
      capacity: { status: "error", message: "계산 확인 실패" } });
    expect(view.calculation).toMatchObject({ error: "요약 확인 실패", retryLabel: "다시 불러오기" });
  });
});

describe("오답 최종 요약", () => {
  const input: Parameters<typeof directReviewPreviewRows>[0] = {
    studentLabel: "가짜 학생", datasetLabel: "가짜 단어장", selectedLevels: [1, 2], questionCount: 3,
    availability: { mode: "immediate" }, deadline: { mode: "none" },
    timeLimitEnabled: false, timing: { mode: "total", totalSeconds: 300 },
  };
  it("작은 입력으로 기존 순서와 즉시/마감없음/시간없음을 표시한다", () => {
    expect(directReviewPreviewRows(input)).toEqual([
      { label: "학생", value: "가짜 학생" }, { label: "단어장", value: "가짜 단어장" },
      { label: "범위", value: "오답 · 1회 · 2회 이상" }, { label: "단어 수", value: "3개" },
      { label: "공개", value: "즉시" }, { label: "시간", value: "시간 제한 없음" },
      { label: "마감", value: "마감 없음" },
    ]);
  });
  it("시각과 시간 방식은 기존 한국 시각 함수를 따른다", () => {
    const rows = directReviewPreviewRows({ ...input, selectedLevels: [], timeLimitEnabled: true,
      availability: { mode: "at", koreanLocalDateTime: "2026-09-06T17:00" },
      deadline: { mode: "at", koreanLocalDateTime: "2026-09-06T22:00" } });
    expect(rows[2].value).toBe("오답 · 선택 안 함");
    expect(rows[4].value).toBe(formatKoreanDateTime("2026-09-06T08:00:00.000Z"));
    expect(rows[5].value).toBe("전체 5분");
    expect(rows[6].value).toBe(formatKoreanDateTime("2026-09-06T13:00:00.000Z"));
    expect(directReviewPreviewRows({ ...input, timeLimitEnabled: undefined,
      timing: { mode: "per_question", perQuestionSeconds: 20 } })[5].value).toBe("문제당 20초");
  });
});
