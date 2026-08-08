export const adminStudentsText = {
  // 학생 관리 > 페이지와 검색·필터
  page: {
    title: "학생 관리",
    searchAriaLabel: "학생 및 학습 자료 검색",
    searchPlaceholder: "이름·학교·학년·단어장 검색",
    filterButton: "필터",
    resetFilters: "초기화",
    noMatches: "조건에 맞는 학생이 없습니다.",
  },

  // 학생 관리 > 학생 카드의 다음 범위
  recommendation: {
    complete: "현재 단어장 완료",
    manual: "DAY 범위 확인 필요",
    needsWordbook: "단어장 선택 필요",
  },

  // 학생 관리 > 학생 추가 모달 > 이름 입력 도움말
  createStudent: {
    open: "학생 추가",
    nameLabel: "학생 이름",
    nameHelp: "학생이 앱에서 확인할 이름을 입력합니다.",
    namePlaceholder: "예: 김하늘",
    schoolLabel: "학교",
    schoolPlaceholder: "예: 심석고등학교",
    gradeLabel: "학년",
    gradePlaceholder: "예: 고1",
    startingWordbookLabel: "시작 단어장",
    startingWordbookHelp:
      "처음 사용할 단어장을 지정하면 다음 시험 범위를 바로 추천할 수 있습니다.",
    chooseLater: "나중에 선택",
    memoLabel: "관리 메모",
    memoPlaceholder: "선택 사항",
    required: "필수",
    optional: "선택",
    submit: "학생과 코드 만들기",
    submitting: "만드는 중…",
    refreshing: "화면에 반영하는 중…",
  },

  // 학생 관리 > 학생 상세 모달 > 탭
  detailTabs: {
    learning: "학습 관리",
    account: "계정 설정",
    history: "내역",
  },

  // 학생 관리 > 학생 상세 > 학습 관리
  learning: {
    nextVocabularyTitle: "다음 단어 시험",
    assign: "배정하기",
    nextVocabularyHelp:
      "최근 학습 기록과 미응시 시험을 기준으로 다음 범위를 추천합니다.",
    nextExamWrongWordHelp:
      "아직 추가 가능한 오답만 다음 일반 시험 대기에 보냅니다.",
    worksheetWrongWordHelp:
      "대기·배정 중인 오답도 한 번에 50개까지 별도 자료 요청에 담습니다.",
    wrongHistoryRefreshHelp:
      "첫 시험이 끝나는 즉시 오답 이력과 현재 오답 단어를 반영합니다.",
  },

  // 학생 관리 > 학생 코드 모달
  codeModal: {
    instruction: "학생에게 이 코드만 전달하세요.",
    sendKakao: "카카오톡으로 보내기",
    copy: "코드 복사",
    copied: "복사됨",
    close: "닫기",
  },
} as const;
