export const adminShellText = {
  // 관리자 공통 셸 > 좌측·상단 브랜드
  brand: "영어 학습실 관리",

  // 관리자 공통 셸 > PC·태블릿·모바일 내비게이션
  navigation: {
    overview: "Overview",
    students: "학생 관리",
    learning: "단어 시험 관리",
    history: "내역",
    pcAriaLabel: "PC 관리 메뉴",
    tabletAriaLabel: "태블릿 관리 메뉴",
    mobileAriaLabel: "모바일 관리 메뉴",
  },

  // 관리자 공통 셸 > 현재 페이지 제목
  pageTitles: {
    overview: "Overview",
    students: "학생 관리",
    learning: "단어 시험 관리",
    history: "내역",
  },

  // 관리자 공통 셸 > 브레드크럼
  breadcrumb: {
    ariaLabel: "현재 위치",
  },

  // 관리자 로그인 페이지
  login: {
    title: "관리자 로그인",
    accountScopeHelp: "직접 만든 관리자 계정으로만 들어갈 수 있습니다.",
    backToStudent: "← 학생 인증 화면",
    email: "관리자 이메일",
    password: "비밀번호",
    submit: "관리자 로그인",
    submitting: "로그인 중…",
    opening: "관리자 확인 후 화면을 여는 중입니다.",
    error: "로그인하지 못했습니다.",
    timeout: "응답이 늦어지고 있습니다. 다시 시도해주세요.",
    network: "연결을 확인한 뒤 다시 시도해주세요.",
    helpAria: "관리자 로그인 도움말",
  },

  // 관리자 공통 셸 > 로딩과 오류 경계
  loading: "화면을 불러오는 중…",
  errorBoundary: {
    safeDescription:
      "자료는 변경되지 않았습니다. 잠시 뒤 다시 불러와 주세요.",
  },

  // 관리자 공통 셸 > 로그아웃 버튼
  logout: {
    idle: "로그아웃",
    pending: "종료 중…",
    error: "로그아웃 실패",
  },

  // 관리자 공통 셸 > 테마 전환
  theme: {
    ariaLabel: "화면 테마",
    toLight: "라이트 모드로 전환",
    toDark: "다크 모드로 전환",
  },
} as const;
