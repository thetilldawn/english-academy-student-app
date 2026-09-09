import type { BulkAssignmentPreviewItem } from "../contracts/bulk-assignment-response";

type CountItem = Pick<BulkAssignmentPreviewItem, "available" | "error" | "sessions" |
  "totalAvailableQuestionCount" | "maximumSessionQuestionCount" | "uniqueScheduledQuestionCount" | "countBreakdown">;

export function bulkCountView(item: CountItem) {
  const breakdown = item.countBreakdown;
  const ready = item.available && !item.error && item.sessions.length > 0 &&
    item.sessions.every(session => session.available && !session.error);
  const available = breakdown?.availableCount ?? (ready ? item.totalAvailableQuestionCount : null);
  const summary: string[] = [];
  if (available !== null && available !== undefined) summary.push("한 번씩 나눌 때 출제 가능 " + available + "개");
  if ((breakdown || ready) && item.maximumSessionQuestionCount != null) summary.push("한 회차 최대 " + item.maximumSessionQuestionCount + "개");
  if (ready) {
    const total = item.sessions.reduce((sum, session) => sum + session.questionCount, 0);
    summary.push("이번 배정 합계 " + total + "문항 · " + item.sessions.length + "회 (반복 포함)");
    const used = item.uniqueScheduledQuestionCount;
    if (used != null && used <= total) {
      summary.push("선택 범위에서 사용 " + used + "개 (반복 제외)");
    }
  } else {
    summary.push("배정 합계는 조건을 확인한 뒤 표시합니다.");
  }
  const details: string[] = [];
  if (breakdown) {
    details.push("선택 범위의 실제 수록 " + breakdown.sourceCount + "개");
    if (breakdown.outsideCandidateListCount > 0) details.push("현재 유형의 출제 목록에 없는 항목 " + breakdown.outsideCandidateListCount + "개 · 미작성·검토 제외·중복 연결 등 세부 사유는 미확인");
    if (breakdown.activeReviewExcludedCount > 0) details.push("활성 오답 시험에 포함 " + breakdown.activeReviewExcludedCount + "개");
    if (breakdown.directionExcludedCount > 0) details.push("선택한 출제 방향에 맞는 문제 없음 " + breakdown.directionExcludedCount + "개");
    if (breakdown.choiceExcludedCount > 0) details.push("서로 다른 보기 4개를 만들 수 없음 " + breakdown.choiceExcludedCount + "개");
    if (breakdown.allocationExcludedCount > 0) details.push("한 번씩 나눌 때 출제 방향 비율·최소 문항 조건으로 제외 " + breakdown.allocationExcludedCount + "개 · 반복 배정에서는 다른 회차에 사용될 수 있습니다.");
    details.push("한 번씩 나눌 때 출제 가능 " + breakdown.availableCount + "개 · 위 제외 수는 서로 겹치지 않습니다.");
  } else {
    details.push("제외 사유별 수량을 확인하지 못했습니다. 단어 수를 다시 확인해 주세요.");
  }
  details.push("수록 수에는 같은 영어의 다른 뜻과 중복 수록이 포함될 수 있습니다. 한 회차에는 중복·뜻 충돌·보기 조건도 적용되므로 여러 회차의 출제 가능 수와 다를 수 있습니다.");
  return { summary, details };
}
