export const commonText = {
  // 앱 공통 > 브라우저 제목과 바로가기
  app: {
    title: "영어 학습실",
    titleTemplate: "%s | 영어 학습실",
    description: "학생별 단어 시험과 오답을 관리하는 영어 학습 앱",
    skipToContent: "본문 바로가기",
  },
  // 앱 공통 > 오류 경계
  errorBoundary: {
    eyebrow: "오류",
    title: "화면을 불러오지 못했습니다",
    description: "잠시 뒤 다시 시도해 주세요.",
    referenceLabel: "오류번호",
    retry: "다시 시도",
  },
  // 앱 공통 > 찾을 수 없는 화면
  notFound: {
    title: "찾을 수 없는 화면입니다",
    description: "주소가 바뀌었거나 접근할 수 없는 항목입니다.",
    home: "처음으로",
  },
  // 공통 모달 > 헤더 작업
  modal: {
    close: "닫기",
    back: "이전 화면으로 돌아가기",
  },
  // 앱 공통 > 시험·계정 상태 뱃지와 시간 열
  activityStatus: {
    deadline: "마감",
    assigned: "배정",
    notStarted: "응시 전",
    cancelled: "배정 취소",
    missed: "미응시",
    inProgress: "응시 중",
    retry: "재시험",
    completed: "완료",
    failed: "미통과",
    available: "접속 가능",
  },
  // 학생·학습 관리 > 공통 검색 필터
  filters: {
    wrongAvailability: "오답 유무",
    all: "전체",
    hasWrong: "오답 있음",
    repeatedWrong: "2회 이상 오답",
    retryNeeded: "재시험 필요",
    bySchool: "학교별",
    byGrade: "학년별",
    byWordbook: "단어장별",
    byClassGroup: "수업그룹",
    byStatus: "재원 상태",
    active: "재원",
    blocked: "차단",
    studentCount: "{count}명",
  },
} as const;
