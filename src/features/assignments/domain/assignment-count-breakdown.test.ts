import { describe, expect, it } from "vitest";
import { checkedAssignmentCountBreakdown } from "./assignment-count-breakdown";

const stages = { sourceCount: 118, candidateCount: 112, activeReviewExcludedCount: 1,
  directionExcludedCount: 1, choiceExcludedCount: 1, allocationExcludedCount: 1, availableCount: 108 };
describe("수록수와 실제 출제 단계 검산", () => {
  it("서로 다른 제외 단계를 중복 없이 합치고 출처가 없는 원인은 생성하지 않는다", () => {
    expect(checkedAssignmentCountBreakdown(stages)).toEqual({ sourceCount: 118, outsideCandidateListCount: 6,
      activeReviewExcludedCount: 1, directionExcludedCount: 1, choiceExcludedCount: 1, allocationExcludedCount: 1, availableCount: 108 });
  });
  it.each([null, -1, 0, 117.5, NaN, Infinity])("원본 조회 실패 또는 불일치 %s를0개로 바꾸지 않는다", sourceCount => {
    expect(checkedAssignmentCountBreakdown({ ...stages, sourceCount })).toBeNull();
  });
  it("단계 감소의 합계 불일치는 내역 미확인이다", () => {
    expect(checkedAssignmentCountBreakdown({ ...stages, candidateCount: 111 })).toBeNull();
    expect(checkedAssignmentCountBreakdown({ ...stages, activeReviewExcludedCount: -1 })).toBeNull();
  });
  it("실제0개는 조회 실패와 다르게 검산 가능하다", () => {
    expect(checkedAssignmentCountBreakdown({ sourceCount: 0, candidateCount: 0, activeReviewExcludedCount: 0,
      directionExcludedCount: 0, choiceExcludedCount: 0, allocationExcludedCount: 0, availableCount: 0 })?.availableCount).toBe(0);
  });
});
