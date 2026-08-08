export const studentAppText = {
  // 학생 첫 화면 > 브랜드와 관리자 이동
  landing: {
    eyebrow: "ENGLISH STUDY ROOM",
    title: "영어 학습실",
    adminLink: "관리자 페이지 →",
  },

  // 학생 로그인 > 접속코드 폼
  login: {
    codeLabel: "학생 접속코드",
    codeHelp: "선생님에게 받은 12자리 코드를 입력하세요.",
    submit: "인증",
    submitting: "인증 중…",
    loading: "학생 정보를 확인하고 있습니다.",
  },

  // 학생 공통 셸 > 상단 브랜드
  shell: {
    brand: "영어 학습실",
  },

  // 학생 시험 목록 > 페이지와 구역
  dashboard: {
    metadataTitle: "내 단어 시험",
    eyebrow: "MY ASSIGNMENTS",
    titleSuffix: "의 단어 시험",
    firstResult: "첫 시험 결과",
    expired: "마감된 시험",
    current: "지금 할 시험",
    recent: "최근 시험",
    others: "다른 시험",
    emptyTitle: "아직 배정된 시험이 없습니다.",
    emptyHelp: "선생님이 시험을 배정하면 이곳에 표시됩니다.",
    deadline: "응시 시작 마감",
    resultAndRetry: "결과 확인·재시험 선택",
    resume: "이어 풀기",
    result: "결과 보기",
    expiredResult: "종료 결과",
  },

  // 학생 시험 응시 화면 > 문제 도움말
  attempt: {
    keyboardShortcutHelp: "키보드 1~4로도 빠르게 선택할 수 있습니다.",
    keyboardShortcutAria: "답 선택 단축키 도움말",
  },
} as const;
