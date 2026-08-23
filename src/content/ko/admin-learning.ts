export const adminLearningText = {
  // 학습 관리 > 페이지·시험 종류 탭·검색
  page: {
    title: "단어 시험",
    vocabularyTab: "배정",
    otherLearningTab: "다른 학습",
    otherLearningEmpty:
      "지문·해석·문법·모의고사 학습 구조가 확정되면 이곳에서 관리합니다.",
    searchAriaLabel: "학생 및 학습 자료 검색",
    searchPlaceholder: "이름·학교·학년·단어장 검색",
    filterButton: "필터",
    resetFilters: "필터 초기화",
    noStudents: "조건에 맞는 접속 가능 학생이 없습니다.",
    tabsAria: "학습 종류",
    expiredReviewDraft:
      "재시험 초안이 만료되었거나 이미 사용되었습니다. 학생 관리의 내역에서 다시 선택해 주세요.",
    bulk: {
      selectedCount: "{count}명 선택",
      maximum: "배정 시험 합계 최대 210개",
      selectVisible: "현재 목록 {count}명 선택",
      clearVisible: "현재 목록 선택 해제",
      clearAll: "전체 해제",
      includeWrong: "틀린 단어 포함",
      assignNext: "다음 범위 일괄 배정",
      prepare: "단어 배정",
      noReadyDatasets:
        "검수가 끝난 단어장이 없어 아직 시험을 배정할 수 없습니다.",
      selectStudentAria: "{student} 일괄 배정 선택",
      success: "{studentCount}명에게 {assignmentCount}개 시험을 배정했습니다.",
      queueSuccess:
        "{studentCount}명에게 첫 시험 {assignmentCount}개를 배정하고 이후 시험 {queuedCount}개를 저장했습니다.",
    },
    studentCard: {
      schoolMissing: "학교 미입력",
      gradeMissing: "학년 미입력",
      wordbookMissing: "단어장 미선택",
      wrongAvailable: "틀린 단어 {count}개 추가 가능",
      wrongAssigned: "틀린 단어 배정 중",
      noActivity: "배정된 학습 없음",
      recommendedRange: "추천 범위 · {range}",
      view: "보기",
      newAssignment: "단어 배정",
      deadline: "마감 {datetime}",
      assignedWithoutDeadline: "배정 {datetime} · 마감 없음",
      finished: "종료 {datetime}",
      expired: "시간 종료 {datetime}",
      failed: "미통과 {datetime}",
      missed: "미응시 마감 {datetime}",
      started: "시작 {datetime}",
    },
  },

  // 학습 관리 > 학생 카드·상세의 다음 범위 추천
  recommendation: {
    needsWordbook: "단어장 선택 필요",
    complete: "현재 단어장 완료",
    assignedFallback: "배정 범위",
    recentFallback: "최근 범위",
    manual: "과거 시험 범위 직접 확인",
    firstFallback: "첫 범위 선택",
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
    labels: {
      missed: "{range} 미응시",
      resume: "{range} 이어서",
      repeat: "{range} 다시 배정",
    },
  },

  // 학습 관리 > 시험 목록과 삭제 작업
  assignmentManagement: {
    status: {
      active: "배정 중",
      closed: "마감",
      draft: "준비 중",
    },
    originalRows: "원본 행 {start}~{end}",
    empty: "관리할 시험이 없습니다.",
    questionCount: "{count}문항",
    studentCount: "학생 {count}명",
    delete: {
      confirm:
        '"{title}" 시험 전체를 삭제할까요?\n\n학생 화면에서는 사라지고, 이미 완료된 성적은 보존되어 내역에 \'삭제됨\'으로 표시됩니다. 진행 중인 응시가 있으면 삭제되지 않습니다.',
      error: "시험을 삭제하지 못했습니다.",
      success:
        "시험을 삭제했습니다. 완료된 내역은 삭제됨으로 보존됩니다.",
      pending: "삭제 중…",
      action: "시험 전체 삭제",
    },
  },

  // 학습 관리 > 여러 배정 모달에서 공통으로 쓰는 시험 조건
  controls: {
    direction: {
      label: "출제 방식",
      englishToMeaning: "영어 → 뜻",
      meaningToEnglish: "뜻 → 영어",
      mixed: "영어 ↔ 뜻 혼합",
    },
    order: {
      label: "출제 순서",
      ascending: "오름차순",
      descending: "내림차순",
      random: "무작위",
    },
    timing: {
      label: "시간 제한 방식",
      helpAria: "시간 제한 방식 도움말",
      total: "전체 시험",
      totalShort: "전체",
      perQuestion: "문제당",
      totalMinutes: "전체 시간(분)",
      totalExamMinutes: "전체 시험 시간(분)",
      perQuestionSeconds: "문제당 시간(초)",
    },
    passingScore: "통과 점수",
    deadlineHelpAria: "응시 마감 시간 설정 도움말",
    titleHelpAria: "시험 이름 도움말",
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
      helpAria: "단어장과 {unit} 도움말",
      wordbook: "단어장",
      selectWordbook: "단어장 선택",
      unavailableWordbook: "사용할 수 없는 단어장",
      previousWordbook: "이전 단어장",
      assignmentClosed: "신규 배정 종료",
      rangeMissing: "범위 미선택",
      unknownUnit: "알 수 없음",
      dayTerm: "DAY",
      unitTerm: "단원",
      start: "시작 {unit}",
      end: "끝 {unit}",
      selectStart: "시작 {unit} 선택",
      selectEnd: "끝 {unit} 선택",
      groupFallback: "범위",
      unitEntryCount: "{unit} · {count}개",
      sourceWordCount: "{range} · 원본 {count}개",
      eligibleWordCount: "출제 검토 통과 {count}개",
      sourceExcluded: "검토·중복 {count}개 제외",
      activeAssignmentExcluded: "오답 배정 중 {count}개 제외",
      questionPlanExcluded: "출제 방식 조건 {count}개 제외",
      maximumQuestionCount: "현재 최대 {count}문항",
      activeAssignmentHelpAria: "다른 시험 중복 제외 도움말",
      activeAssignmentHelp:
        "미응시 또는 진행 중인 시험에 이미 들어간 동일 단어는 중복 배정하지 않습니다. 기존 배정을 취소하거나 완료한 뒤 다시 사용할 수 있습니다.",
      activeAssignmentSelectionRequired:
        "미응시·진행 중 시험의 범위는 새 시험에 다시 자동 선택하지 않습니다. 새로 배정할 범위를 직접 선택해 주세요.",
    },

    // 모달 > 틀렸던 단어 추가
    wrongWords: {
      title: "틀렸던 단어 추가",
      help:
        "기본은 꺼짐입니다. 다음 시험에 추가해 둔 미해결 단어를 함께 출제하며, 다른 시험에 배정 중인 단어는 제외합니다.",
      helpAria: "틀렸던 단어 추가 도움말",
      scopeLabel: "틀렸던 단어 범위",
      scopeAll: "전체 단어장",
      scopeCurrent: "현재 범위",
      scopeHelp:
        "전체는 현재 단어장의 대기 오답 전체, 현재 범위는 위에서 고른 범위 안의 대기 오답만 포함합니다.",
      scopeHelpAria: "틀렸던 단어 범위 도움말",
      total: "전체",
      once: "1회",
      repeated: "2회 이상",
      noEligible: "선택한 조건에 추가 가능한 틀렸던 단어가 없습니다.",
      levelGroupAria: "포함할 오답 단계",
      count: "{count}개",
      countSummary: "{label} {count}개",
    },

    // 모달 > 2단계 문제 조건
    conditions: {
      title: "문제 조건",
      help: "방향·순서·시간과 통과 기준을 정합니다.",
      helpAria: "문제 조건 도움말",
      direction: "출제 방식",
      order: "출제 순서",
      questionCount: "문항 수",
      totalQuestionCount: "총 문항 수",
      timingMode: "시간 제한 방식",
      timingHelp:
        "전체 시험 시간 또는 문제당 시간 중 하나만 적용합니다.",
      totalTime: "전체 시험 시간(분)",
      perQuestionTime: "문제당 시간(초)",
      passingScore: "통과 점수",
      englishDefinitionDisabled: "영영풀이 → 영어 · 자료 준비 필요",
      exampleDisabled: "예문 → 영어 · 자료 준비 필요",
      restoreRecommended: "전체 {count}개로 되돌리기",
    },

    // 모달 > 응시 마감 입력
    deadline: {
      label: "응시 마감 시간 설정",
      helpAria: "응시 마감 시간 설정 도움말",
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
      headerSaveChanges: "변경 저장",
      blockedReason: {
        loading: "불러오는 중",
        loadFailed: "불러오기 실패",
        unchanged: "변경 내용 없음",
        capacityLoading: "문항 계산 중",
        capacityFailed: "문항 계산 실패",
        rangeUnavailable: "출제 단어 부족",
        questionCountTooLow: "문항 수 부족",
        questionCountTooHigh: "문항 수 초과",
        noReviewWords: "추가 오답 없음",
        noReadyDataset: "단어장 없음",
        scheduledAssignment: "예약 시험 있음",
        processing: "처리 중",
        validation: {
          student: "학생 확인",
          dataset: "단어장 선택",
          range: "범위 선택",
          review: "오답 조건 확인",
          direction: "출제 방식 확인",
          order: "순서 확인",
          score: "점수 확인",
          timing: "시간 확인",
          totalTiming: "30초~180분",
          perQuestionTiming: "5초~600초",
          deadline: "마감 확인",
          questionCount: "문항 수 확인",
          title: "이름 확인",
          fallback: "조건 확인",
        },
      },
    },

    // 모달 > 우측 배정 요약
    summary: {
      title: "배정 요약",
      wordbook: "단어장",
      range: "범위",
      questions: "문항",
      timing: "시간",
      passingScore: "통과 점수",
      deadline: "마감",
    },

    // 모달 > 미응시 배정 수정 비교
    edit: {
      comparisonTitle: "변경 전·후",
      unchanged: "아직 바뀐 조건이 없습니다.",
      rebuildQuestionsHelp:
        "범위·문항 구성 변경으로 문제와 선택지를 다시 구성합니다.",
      comparisonAria: "배정 변경 비교",
      rebuildHelpAria: "문항 재구성 도움말",
      changedCount: "{count}개 변경",
      before: "변경 전: ",
      after: "변경 후: ",
      lockedReview:
        "오답 시험은 대상 단어를 그대로 유지합니다. 단어장·범위·문항 수·오답 단계는 잠겨 있고, 나머지 시험 조건만 바꿀 수 있습니다.",
      questionCount: "{count}문항",
      perQuestionTiming: "문제당 {seconds}초",
      totalTiming: "전체 {minutes}분",
      score: "{score}점",
      noDeadline: "마감 없음",
      noWrongWords: "추가 안 함",
    },

    // 모달 > 문항 수 오류. 정상일 때는 표시하지 않습니다.
    errors: {
      capacityLoading: "배정 가능한 문항 수를 확인하는 중입니다.",
      rangeUnavailable:
        "선택 범위에서 새 시험에 넣을 수 있는 단어가 {count}개뿐입니다. 미응시·진행 중 시험에 있는 단어는 중복 배정하지 않으므로 다른 범위를 선택해 주세요.",
      tooMany: "문항 수를 현재 배정 가능한 최대값 이하로 줄여주세요.",
      tooFew: "문항 수를 현재 필요한 최소값 이상으로 늘려주세요.",
      countRange: "총 문항 수는 4개 이상 500개 이하여야 합니다.",
      generic: "단어 시험을 배정하지 못했습니다.",
      maximumDetail:
        "현재 최대 {count}문항입니다. 문항 수를 {count}개 이하로 줄여주세요.",
      minimumDetail:
        "현재 조건에는 최소 {count}문항이 필요합니다. 문항 수를 늘려주세요.",
      countDetail: "총 문항 수는 {min}개 이상 500개 이하여야 합니다.",
      totalTimeDetail: "전체 시험 시간은 30초 이상 180분 이하여야 합니다.",
      perQuestionDetail: "문제당 시간은 5초 이상 600초 이하여야 합니다.",
      editLoad: "수정할 배정 정보를 불러오지 못했습니다.",
      editMismatch: "수정할 배정 정보가 일치하지 않습니다.",
      capacity: "문항 수를 계산하지 못했습니다.",
    },
    overview: {
      studentInfoMissing: "학생 정보 미입력",
      recentWordbook: "최근 단어장",
      unselected: "미선택",
      openAssignmentAria: "단어 학습 배정 열기",
      nextRecommendation: "다음 {range}",
      unresolvedWrong: "미해결 {count}개",
      pendingWrong: "다음 시험 대기 {count}개",
      pendingWrongShort: "오답 대기 {count}개",
      recommendationHelpAria: "다음 범위 추천 이유",
      noReadyDataset:
        "승인된 단어장이 없어 새 시험 배정은 잠겨 있습니다. 기존 배정과 내역은 계속 관리할 수 있습니다.",
      recentActivity: "배정 및 최근 내역",
      activityCount: "{count}개",
      loadingEdit: "기존 배정 조건을 불러오는 중입니다.",
      formAria: "단어 시험 배정 조건",
      beforeStart: "{student} · 응시 시작 전",
      includedWrong: "틀렸던 단어 {count}개 포함",
    },
    success: {
      edited: "{student}의 미응시 배정을 수정했습니다.",
      assignedWithWrong: "{student}에게 틀렸던 단어를 포함해 배정했습니다.",
      assigned: "{student}에게 배정했습니다.",
      studentFallback: "학생",
    },
  },

  // 학습 관리 > 구 오답 시험 초안 복구 모달
  reviewAssignmentModal: {
    title: "이전 재시험 준비 복구",
    recoveryHelp:
      "별도 오답 시험 방식은 종료되었습니다. 예약된 단어를 다음 시험 대기로 되돌린 뒤, 현재 단어 시험 배정에서 틀렸던 단어를 함께 추가할 수 있습니다.",
    selectedWrongCount: "선택한 오답 {count}개",
    student: "학생",
    dataset: "단어장",
    expiresLabel: "초안 만료",
    cancelDraft: "준비만 취소",
    continueAssignment: "대기 오답으로 돌리고 단어 시험 배정 열기",
    recovering: "복구하는 중…",
    cancelError: "재시험 준비를 취소하지 못했습니다.",
    cancelSuccess: "예약된 단어를 다음 시험 대기로 되돌렸습니다.",
    continueSuccess: "대기 오답을 복구하고 단어 시험 배정을 열었습니다.",
  },

  // 학습 관리 > 학생 일괄 배정 모달 도움말
  bulkAssignmentModal: {
    nextTitle: "날짜별 다회차 일괄 배정",
    withWrongTitle: "틀린 단어 포함 다회차 일괄 배정",
    close: "닫기",
    previewTitle: "배정 미리보기",
    cancel: "취소",
    autoRangeHelp:
      "학생별 다음 범위부터 회차마다 정한 범위 수만큼 독립된 시험을 만듭니다. 이전 배정 범위를 선택하면 학생별 직전 범위 수와 방향을 유지합니다.",
    deadlineHelp:
      "첫 시험의 마감을 정하면 나머지 시험도 배정 날짜와 같은 간격으로 마감이 이동합니다.",
    atomicHelp:
      "한 학생의 한 회차라도 저장 조건이 맞지 않으면 어떤 시험도 배정하지 않습니다.",
    previewError: "학생별 다음 범위를 계산하지 못했습니다.",
    saveError: "일괄 배정을 저장하지 못했습니다.",
    autoRangeHelpAria: "자동 범위 계산 도움말",
    studentCount: "{count}명",
    rangeMode: {
      label: "배정 범위",
      helpAria: "일괄 배정 범위 도움말",
      help:
        "이전 배정과 같은 범위 수는 학생별 최근 시험 범위와 정방향·역방향을 유지합니다. 직접 지정은 회차당 범위 수를 모든 학생에게 같게 적용합니다.",
      previousSpan: "이전 배정과 같은 범위 수",
      fixedSpan: "회차당 범위 수 직접 지정",
      remainingOnly: "단어장 끝까지",
    },
    unitsPerSession: "회차당 범위 수",
    sessionCount: "시험 횟수",
    firstAvailableDate: "첫 배정 날짜",
    firstDateRequired: "첫 배정 날짜를 정해 주세요.",
    dayInterval: "배정 간격(일)",
    firstDeadline: "첫 시험 마감 · 선택",
    firstDeadlineInvalid:
      "첫 시험 마감은 첫 배정 날짜보다 뒤로 정해 주세요.",
    sessionLabel: "{count}회차",
    assignmentDateTag: "공개 {datetime}",
    deadlineTag: "마감 {datetime}",
    wrongWordsLegend: "포함할 오답",
    wrongOnce: "한 번 틀림",
    wrongRepeated: "두 번 이상 틀림",
    atomicHelpAria: "일괄 배정 저장 방식 도움말",
    calculating: "계산 중",
    previewSummary:
      "{assignable}명 배정 · {assignments}개 시험 · {blocked}명 확인 필요",
    queuePreviewSummary:
      "{assignable}명 · 첫 시험 {assignable}개 · 배정된 시험 {queued}개 · {blocked}명 확인 필요",
    datasetPending: "단어장 확인 중",
    rangePending: "범위 확인 중",
    questionCount: "{count}문항",
    needsReview: "확인 필요",
    wrongCount: "오답 {count}개",
    submitting: "전체 저장 중…",
    submit: "{studentCount}명에게 {assignmentCount}개 시험 배정",
  },

  // 학습 관리 > 검토 전용 단어장 패널
  reviewDatasetPanel: {
    title: "단어장 검토",
    help:
      "사전 연결 전 원문 내용을 확인하는 자료이며 시험에는 배정되지 않습니다.",
    helpAria: "단어장 검토 도움말",
    reviewOnly: "검토 전용",
    count: "{count}개",
    status: "원문 내용 검토 완료 · 단어 사전 연결 및 발음 승인 전",
    hidden: "외 {count}개는 다음 검토 묶음",
  },
} as const;
