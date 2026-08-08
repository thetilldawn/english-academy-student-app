export const adminHistoryText = {
  // 내역 페이지 > 브레드크럼과 브라우저 제목
  page: {
    title: "내역",
  },

  // 내역 페이지 > 검색·상태 필터
  filters: {
    searchLabel: "학생·시험 검색",
    searchPlaceholder: "학생, 학교, 시험, DAY",
    statusLabel: "상태",
    statusOptions: {
      all: "전체",
      open: "응시 전·응시 중",
      needsAttention: "미통과·미응시",
      completed: "첫 시험 완료",
      retried: "재시험",
      archived: "취소·삭제",
    },
  },

  // 내역 페이지 > 목록 빈 상태
  emptyState: {
    noAssignments: "배정된 학습이 없습니다.",
    noMatches: "조건에 맞는 내역이 없습니다.",
  },

  // 내역 페이지 > 학습 내역 상세 모달
  detailModal: {
    eyebrow: "학습 내역",
    close: "닫기",
    status: "상태",
    score: "점수",
    unresolvedWords: "다시 볼 단어",
    dataset: "단어장",
    range: "범위",
    conditions: "조건",
    directionAndOrder: "출제·순서",
    assignedAt: "배정",
    startDeadline: "응시 시작 마감",
    finishedAt: "종료",
    loadingQuestions: "응시 문항을 불러오는 중…",
    questionSummary: "문항 요약",
    unansweredChoice: "선택 안 함",
    retryCorrect: "재시험 정답",
    retryWrong: "재시험 오답",
    noRetry: "재시험 없음",
    allCorrect: "첫 시험에서 모두 맞았습니다.",
    truncatedHelp:
      "처음 8개만 표시합니다. 전체 문항은 상세 내역에서 확인할 수 있습니다.",
    openDetail: "상세 내역 보기",
    openStudent: "학생 관리",
  },
} as const;
