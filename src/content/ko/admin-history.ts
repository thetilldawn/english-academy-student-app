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

  // 내역 목록 > 항목별 작업
  actions: {
    genericError: "요청을 처리하지 못했습니다.",
    cancelSuccess: "배정을 취소했습니다.",
    deleteSuccess: "내역을 삭제했습니다.",
    view: "보기",
    edit: "수정",
    editAria: "{student} · {title} 배정 수정",
    viewHistory: "내역 보기",
    cancel: {
      confirm:
        "{student} 학생의 이 배정만 취소할까요? 틀렸던 단어는 다음 시험 대기에 유지됩니다.",
      pending: "취소 중…",
      action: "배정 취소",
    },
    delete: {
      confirm:
        "이 항목만 내역 목록에서 삭제할까요? 시험 결과와 오답 기록 원본은 안전하게 보존됩니다.",
      pending: "삭제 중…",
      action: "내역 삭제",
    },
  },
  // 내역 목록 > 카드 시각과 시험 요약
  list: {
    direction: {
      englishToMeaning: "영어 → 뜻",
      meaningToEnglish: "뜻 → 영어",
      mixed: "영어 ↔ 뜻 혼합",
    },
    elapsed: "{minutes}분 {seconds}초",
    deadline: "마감 {datetime}",
    cancelled: "취소 {datetime}",
    assigned: "배정 {datetime}",
    failed: "미통과 {datetime}",
    started: "시작 {datetime}",
    remainingWrong: " · 남은 오답 {count}개",
    finished: "종료 {datetime}{wrong}",
    detailLoadError: "응시 상세를 불러오지 못했습니다.",
    count: "{count}개",
    conditions: "{questions}문항 · {minutes}분 · {score}점",
    questionSummary: "오답 {wrong}개 · 미응답 {unanswered}개 · {elapsed}",
    unansweredNotice: "아직 답하지 않은 문항이 {count}개 있습니다.",
    questionCount: "{count}문항",
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
    cancellationReason: "취소 사유",
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

  // 관리자 > 응시 상세 화면
  resultDetail: {
    metadataTitle: "응시 상세",
    eyebrow: "ATTEMPT DETAIL",
    status: {
      initialCorrect: "첫 시험 정답",
      resolvedAfterRetry: "한 번 틀린 단어",
      unresolved: "다시 볼 단어",
      retryPending: "재시험 전",
      incomplete: "미완료",
    },
    attemptNumber: "{count}회",
    backToResults: "닫기",
    backToResultsLong: "닫기",
    summaryAria: "응시 요약",
    summaryTitle: "응시 요약",
    initialScore: "첫 시험 점수",
    finalScore: "최종 점수",
    unresolvedCount: "미해결",
    elapsed: "응시 시간",
    score: "{score}점",
    count: "{count}개",
    flowTitle: "첫 시험부터 재시험까지",
    questionCount: "{count}문항",
    allCorrect: "첫 시험에서 모두 맞혔습니다.",
    noAttempt: "아직 제출된 응시 결과가 없습니다.",
    questionNumber: "문항 {number}",
    initialChoice: "첫 선택",
    retry: "재시험",
    answer: "정답",
    noChoice: "선택 안 함",
    retryPending: "재시험 전",
    retryCorrectSr: "재시험에서 맞힘",
  },
} as const;
