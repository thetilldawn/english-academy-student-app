export const adminShellText = {
  // 관리자 공통 셸 > 좌측·상단 브랜드
  brand: "영어 학습실 관리",

  // 관리자 공통 셸 > PC·태블릿·모바일 내비게이션
  navigation: {
    overview: "Overview",
    students: "학생 관리",
    learning: "학습 관리",
    history: "내역",
    pcAriaLabel: "PC 관리 메뉴",
    tabletAriaLabel: "태블릿 관리 메뉴",
    mobileAriaLabel: "모바일 관리 메뉴",
  },

  // 관리자 공통 셸 > 현재 페이지 제목
  pageTitles: {
    overview: "Overview",
    students: "학생 관리",
    learning: "학습 관리",
    history: "내역",
  },

  // 관리자 공통 셸 > 브레드크럼
  breadcrumb: {
    ariaLabel: "현재 위치",
  },

  // 관리자 로그인 페이지
  login: {
    eyebrow: "TEACHER ADMIN",
    title: "관리자 로그인",
    accountScopeHelp: "직접 만든 관리자 계정으로만 들어갈 수 있습니다.",
    backToStudent: "← 학생 인증 화면",
  },

  // 관리자 공통 셸 > 로그아웃 버튼
  logout: {
    idle: "로그아웃",
    pending: "종료 중…",
  },
} as const;
