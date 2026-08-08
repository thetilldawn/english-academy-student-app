export const adminLearningText = {
  // 학습 관리 > 페이지·시험 종류 탭·검색
  page: {
    title: "학습 관리",
    vocabularyTab: "단어",
    otherLearningTab: "다른 학습",
    otherLearningEmpty:
      "지문·해석·문법·모의고사 학습 구조가 확정되면 이곳에서 관리합니다.",
    searchAriaLabel: "학생 및 학습 자료 검색",
    searchPlaceholder: "이름·학교·학년·단어장 검색",
    filterButton: "필터",
    resetFilters: "초기화",
    noStudents: "조건에 맞는 접속 가능 학생이 없습니다.",
  },

  // 학습 관리 > 학생 카드·상세의 다음 범위 추천
  recommendation: {
    needsWordbook: "단어장 선택 필요",
    complete: "현재 단어장 완료",
    assignedFallback: "배정 범위",
    recentFallback: "최근 범위",
    manual: "과거 시험의 DAY 범위 직접 확인",
    firstFallback: "첫 DAY 선택",
    reasons: {
      needsWordbook: "현재 단어장을 먼저 선택하세요.",
      assigned: "이미 배정했지만 아직 시작하지 않은 범위입니다.",
      resume: "진행 중인 시험을 이어서 완료해야 합니다.",
      repeat: "최근 결과가 통과 기준에 못 미쳐 같은 범위를 권합니다.",
      next: "최근 범위를 통과해 다음 범위를 권합니다.",
      first: "현재 단어장의 첫 범위부터 시작합니다.",
      complete: "현재 단어장의 마지막 범위까지 통과했습니다.",
      manual: "과거 자료에 범위 연결이 없어 직접 확인이 필요합니다.",
    },
  },

  // 학습 관리 > 학생별 단어 학습 배정 모달
  assignmentModal: {
    // 모달 > 헤더
    header: {
      createTitle: "단어 학습 배정",
      editTitle: "배정 수정",
      close: "닫기",
    },

    // 모달 > 1단계 제목과 설명
    range: {
      title: "단어장과 범위",
      help: "학생이 실제로 외울 범위를 정합니다.",
      wordbook: "단어장",
      selectWordbook: "단어장 선택",
    },

    // 모달 > 틀렸던 단어 추가
    wrongWords: {
      title: "틀렸던 단어 추가",
      help:
        "기본은 꺼짐입니다. 다음 시험에 추가해 둔 미해결 단어를 함께 출제하며, 다른 시험에 배정 중인 단어는 제외합니다.",
      scopeLabel: "틀렸던 단어 범위",
      scopeAll: "전체 단어장",
      scopeCurrent: "현재 범위",
      scopeHelp:
        "전체는 현재 단어장의 대기 오답 전체, 현재 범위는 위에서 선택한 DAY·단원 안의 대기 오답만 포함합니다.",
      total: "전체",
      once: "1회",
      repeated: "2회 이상",
      noEligible: "선택한 조건에 추가 가능한 틀렸던 단어가 없습니다.",
    },

    // 모달 > 2단계 문제 조건
    conditions: {
      title: "문제 조건",
      help: "방향·순서·시간과 통과 기준을 정합니다.",
      direction: "출제 방식",
      order: "문제 순서",
      questionCount: "문항 수",
      totalQuestionCount: "총 문항 수",
      timingMode: "시간 제한 방식",
      timingHelp:
        "전체 시험 시간 또는 문제당 시간 중 하나만 적용합니다.",
      totalTime: "전체 시험 시간(분)",
      perQuestionTime: "문제당 시간(초)",
      passingScore: "통과 점수",
    },

    // 모달 > 응시 마감 입력
    deadline: {
      label: "응시 마감 시간 설정",
      help:
        "이 시각까지 시험을 시작하지 않으면 미응시로 기록됩니다. 이미 시작한 시험은 선택한 시간 제한을 따릅니다.",
      invalid: "응시 마감 시간은 현재보다 뒤의 한국시간으로 정해주세요.",
    },

    // 모달 > 자동 시험 이름과 제출부
    submit: {
      optionalTitle: "시험 이름 변경 · 선택",
      titleHelp: "시험 이름은 자동 생성하며 필요할 때만 바꿉니다.",
      autoTitle: "자동 시험 이름",
      assign: "이 학생에게 배정",
      assignWithWrong: "틀렸던 단어 포함해 배정",
      assigning: "배정하는 중…",
      saveChanges: "변경 내용 저장",
      noChanges: "변경 없음",
      saving: "수정하는 중…",
      refreshing: "화면에 반영하는 중…",
    },

    // 모달 > 미응시 배정 수정 비교
    edit: {
      comparisonTitle: "변경 전·후",
      unchanged: "아직 바뀐 조건이 없습니다.",
      rebuildQuestionsHelp:
        "범위·문항 구성 변경으로 문제와 선택지를 다시 구성합니다.",
    },

    // 모달 > 문항 수 오류. 정상일 때는 표시하지 않습니다.
    errors: {
      capacityLoading: "배정 가능한 문항 수를 확인하는 중입니다.",
      unavailableDataset:
        "이 단어장은 아직 시험 배정 준비가 끝나지 않았습니다.",
      tooMany: "문항 수를 현재 배정 가능한 최대값 이하로 줄여주세요.",
      tooFew: "문항 수를 현재 필요한 최소값 이상으로 늘려주세요.",
      countRange: "총 문항 수는 4개 이상 500개 이하여야 합니다.",
      generic: "단어 시험을 배정하지 못했습니다.",
    },
  },

  // 학습 관리 > 오답 재시험 배정 모달 도움말
  reviewAssignmentModal: {
    eyebrow: "오답 재시험 배정",
    fixedTargetTitle: "고정된 재시험 대상",
    conditionsTitle: "문제 조건",
    cancelDraft: "재시험 준비 취소 · 다음 시험 대기 유지",
    cancelingDraft: "취소하는 중…",
    assign: "오답 재시험 배정",
    assigning: "배정하는 중…",
    fixedTargetHelp: "학생·단어장·문항 수는 선택한 오답으로 고정됩니다.",
    conditionsHelp: "출제 방향·순서·시간과 통과 기준을 정합니다.",
    titleHelp: "시험 이름은 자동 생성하며 필요할 때만 바꿉니다.",
    deadlineHelp:
      "이 시각까지 시험을 시작하지 않으면 미응시로 기록됩니다.",
  },

  // 학습 관리 > 학생 일괄 배정 모달 도움말
  bulkAssignmentModal: {
    nextTitle: "다음 범위 일괄 배정",
    withWrongTitle: "틀린 단어 포함 일괄 배정",
    close: "닫기",
    previewTitle: "학생별 배정 미리보기",
    cancel: "취소",
    autoRangeHelp:
      "학생별 다음 범위와 현재 배정 가능한 최대 문항 수를 자동으로 적용합니다.",
    deadlineHelp:
      "이 시각까지 시험을 시작하지 않으면 미응시로 기록됩니다.",
    atomicHelp:
      "한 학생이라도 저장 조건이 맞지 않으면 아무 학생에게도 배정하지 않습니다.",
  },

  // 학습 관리 > 검토 전용 단어장 패널
  reviewDatasetPanel: {
    title: "단어장 검토",
    help:
      "사전 연결 전 원문 내용을 확인하는 자료이며 시험에는 배정되지 않습니다.",
  },
} as const;
