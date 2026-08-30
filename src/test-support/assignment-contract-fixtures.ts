const studentA = "11111111-1111-4111-8111-111111111111";
const studentB = "22222222-2222-4222-8222-222222222222";
const dataset = "33333333-3333-4333-8333-333333333333";
const day57 = "57575757-5757-4757-8757-575757575757";
const day58 = "58585858-5858-4858-8858-585858585858";
const day59 = "59595959-5959-4959-8959-595959595959";
const day60 = "60606060-6060-4060-8060-606060606060";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const previewPlanSignature = "a".repeat(64);
const planNonce = "88888888-8888-4888-8888-888888888888";

export const assignmentContractIds = {
  studentA,
  studentB,
  dataset,
  day57,
  day58,
  day59,
  day60,
  idempotencyKey,
  previewPlanSignature,
  planNonce,
} as const;

export const reverseUnitIds = [day60, day59, day58] as const;
export const forwardUnitIds = [day58, day59, day60] as const;

export const regularTotalContract = {
  input: {
    studentId: studentA,
    datasetId: dataset,
    primaryUnitIds: reverseUnitIds,
    title: "역순 일반 시험",
    questionCount: 12,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "descending",
    availableUntil: "2026-08-18T12:00:00.000Z",
    includePendingReview: false,
  },
  submission: {
    endpoint: "/api/admin/assignments",
    body: {
      title: "역순 일반 시험",
      datasetId: dataset,
      unitIds: reverseUnitIds,
      questionCount: 12,
      englishToKoreanRatio: 50,
      timeLimitSeconds: 300,
      timingMode: "total",
      questionTimeLimitSeconds: null,
      passingScore: 80,
      retryEnabled: true,
      retryPassingScore: 80,
      questionOrderMode: "descending",
      availableUntil: "2026-08-18T12:00:00.000Z",
      studentIds: [studentA],
    },
  },
} as const;

export const mixedPerQuestionContract = {
  input: {
    studentId: studentA,
    datasetId: dataset,
    primaryUnitIds: forwardUnitIds,
    title: "틀린 단어 포함 시험",
    questionCount: 15,
    englishToKoreanRatio: 100,
    timeLimitSeconds: 10800,
    timingMode: "per_question",
    questionTimeLimitSeconds: 12,
    passingScore: 90,
    retryEnabled: true,
    retryPassingScore: 90,
    questionOrderMode: "random",
    availableUntil: null,
    includePendingReview: true,
    reviewLevels: [1, 2],
    reviewScope: "selection",
  },
  submission: {
    endpoint: "/api/admin/mixed-assignments",
    body: {
      studentId: studentA,
      datasetId: dataset,
      primaryUnitIds: forwardUnitIds,
      reviewLevels: [1, 2],
      reviewScope: "selection",
      totalQuestionCount: 15,
      title: "틀린 단어 포함 시험",
      englishToKoreanRatio: 100,
      timeLimitSeconds: 10800,
      timingMode: "per_question",
      questionTimeLimitSeconds: 12,
      passingScore: 90,
      retryEnabled: true,
      retryPassingScore: 90,
      questionOrderMode: "random",
      availableUntil: null,
    },
  },
} as const;

export const replacementPreviewContract = {
  studentId: studentA,
  datasetId: dataset,
  primaryUnitIds: reverseUnitIds,
  includePendingReview: true,
  reviewLevels: [2],
  reviewScope: "dataset",
  englishToKoreanRatio: 0,
} as const;

export const replacementSubmitContract = {
  idempotencyKey,
  title: "기존 오답 재시험 수정",
  datasetId: dataset,
  primaryUnitIds: reverseUnitIds,
  includePendingReview: true,
  reviewLevels: [2],
  questionCount: 1,
  englishToKoreanRatio: 0,
  timeLimitSeconds: 10800,
  timingMode: "per_question",
  questionTimeLimitSeconds: 20,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "ascending",
  availableFrom: null,
  availableUntil: null,
  reviewScope: "dataset",
} as const;

export const bulkPreviewContract = {
  studentIds: [studentA, studentB],
  englishToKoreanRatio: 50,
  commonPlan: {
    datasetId: dataset,
    distribution: "split",
    splitBasis: "question_count",
    orderedUnitIds: reverseUnitIds,
    rangeUnitCounts: [],
    unitAllocationRule: null,
    questionCount: { mode: "manual", value: 12 },
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectedDateCount: 2,
    selectionMode: "source_order",
    planNonce,
    recurrenceSessions: [
      {
        availableFrom: "2026-08-16T15:00:00.000Z",
        availableUntil: "2026-08-17T12:00:00.000Z",
      },
      {
        availableFrom: "2026-08-18T15:00:00.000Z",
        availableUntil: "2026-08-19T12:00:00.000Z",
      },
    ],
    sessions: [
      {
        unitIds: reverseUnitIds,
        availableFrom: "2026-08-16T15:00:00.000Z",
        availableUntil: "2026-08-17T12:00:00.000Z",
      },
      {
        unitIds: reverseUnitIds,
        availableFrom: "2026-08-18T15:00:00.000Z",
        availableUntil: "2026-08-19T12:00:00.000Z",
      },
    ],
  },
} as const;

export const bulkImmediatePreviewContract = {
  studentIds: [studentA],
  englishToKoreanRatio: 50,
  commonPlan: {
    datasetId: dataset,
    distribution: "repeat",
    splitBasis: "question_count",
    orderedUnitIds: reverseUnitIds,
    rangeUnitCounts: [],
    unitAllocationRule: null,
    questionCount: { mode: "all" },
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectedDateCount: 0,
    selectionMode: "source_order",
    planNonce,
    recurrenceSessions: [{ availableFrom: null, availableUntil: null }],
    sessions: [
      {
        unitIds: reverseUnitIds,
        availableFrom: null,
        availableUntil: null,
      },
    ],
  },
} as const;

export const bulkSubmitContract = {
  ...bulkPreviewContract,
  idempotencyKey,
  previewPlanSignature,
  timeLimitSeconds: 10800,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random",
  timingMode: "per_question",
  questionTimeLimitSeconds: 15,
} as const;

export const bulkImmediateSubmitContract = {
  ...bulkImmediatePreviewContract,
  idempotencyKey,
  previewPlanSignature,
  timeLimitSeconds: 300,
  passingScore: 80,
  retryEnabled: false,
  retryPassingScore: null,
  questionOrderMode: "ascending",
  timingMode: "total",
  questionTimeLimitSeconds: null,
} as const;

export const orderedBulkUnits = [
  { id: day57, label: "DAY 57", sortIndex: 57 },
  { id: day58, label: "DAY 58", sortIndex: 58 },
  { id: day59, label: "DAY 59", sortIndex: 59 },
  { id: day60, label: "DAY 60", sortIndex: 60 },
] as const;
