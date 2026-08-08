export const adminOverviewText = {
  // Overview > 브레드크럼과 브라우저 제목
  page: {
    title: "Overview",
  },

  // Overview > 우선 확인 목록 구역
  sections: {
    missed: "미응시 마감",
    failed: "미통과·재시험 필요",
    dueSoon: "곧 마감",
    noDeadline: "마감 없음",
  },

  // Overview > 확인할 학습이 없을 때
  emptyState: "지금 확인할 미응시·미통과·대기 학습이 없습니다.",

  // Overview > 구역별 항목 수 뒤에 붙는 단위
  countSuffix: "건",
} as const;
