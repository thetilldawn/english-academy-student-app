import { koreanDateTimeLocalToIso } from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

import type { AssignmentAvailability, AssignmentDeadline, ExamTiming, ReviewLevel } from "../domain/model";

type ReadStatus = "idle" | "loading" | "ready" | "error";
type ReadMessage = { status: ReadStatus; message: string };

export function directReviewRangeView(input: {
  summary: ReadMessage;
  capacity: ReadMessage;
  hasDatasetOptions: boolean;
  totalAvailableCount: number;
  questionCount: number;
  knownLevelCounts: { level1: number | null; level2: number | null };
  selectedLevels: readonly ReviewLevel[];
}) {
  const { summary, capacity } = input;
  const error = summary.status === "error" ? summary.message
    : capacity.status === "error" ? capacity.message : "";
  const countText = summary.status === "loading" || summary.status === "idle"
    ? "현재 오답 단어 계산 중…"
    : summary.status === "error" ? summary.message
    : input.totalAvailableCount === 0 ? "현재 배정할 오답이 없습니다."
    : capacity.status === "loading" ? "오답 단어 계산 중…"
    : capacity.status === "error" ? capacity.message
    : capacity.status === "ready" ? input.questionCount > 0
      ? `단어 ${input.questionCount}개` : "현재 배정할 오답이 없습니다."
    : "단어장과 오답 단계를 선택해 주세요.";

  return {
    datasetDisabled: summary.status !== "ready" || !input.hasDatasetOptions,
    totalLabel: summary.status === "ready" ? `미배정 오답 전체 ${input.totalAvailableCount}개`
      : summary.status === "error" ? "미배정 오답 수를 확인하지 못했습니다." : "미배정 오답 확인 중…",
    levels: ([1, 2] as const).map((level) => {
      const count = level === 1 ? input.knownLevelCounts.level1 : input.knownLevelCounts.level2;
      return {
        value: level,
        label: `${level === 1 ? "1회" : "2회 이상"} ${count === null ? "계산 전" : `${count}개`}`,
        selected: input.selectedLevels.includes(level),
        disabled: summary.status !== "ready" || count === 0,
      };
    }),
    calculation: { countText, error, status: summary.status === "ready" ? capacity.status : summary.status,
      retryLabel: summary.status === "error" ? "다시 불러오기" : "다시 계산하기" },
  };
}

export type DirectReviewRangeView = ReturnType<typeof directReviewRangeView>;
export type DirectReviewPreviewRow = { label: string; value: string };

export function directReviewPreviewRows(input: {
  studentLabel: string;
  datasetLabel: string;
  selectedLevels: readonly ReviewLevel[];
  questionCount: number;
  availability: AssignmentAvailability;
  deadline: AssignmentDeadline;
  timeLimitEnabled: boolean | undefined;
  timing: ExamTiming;
}): DirectReviewPreviewRow[] {
  const availabilityIso = input.availability.mode === "at"
    ? koreanDateTimeLocalToIso(input.availability.koreanLocalDateTime) : null;
  const deadlineIso = input.deadline.mode === "at"
    ? koreanDateTimeLocalToIso(input.deadline.koreanLocalDateTime) : null;
  const levels = input.selectedLevels.length === 0 ? "선택 안 함"
    : input.selectedLevels.map((level) => level === 1 ? "1회" : "2회 이상").join(" · ");
  const time = input.timeLimitEnabled === false ? "시간 제한 없음"
    : input.timing.mode === "total" ? `전체 ${input.timing.totalSeconds / 60}분`
    : `문제당 ${input.timing.perQuestionSeconds}초`;
  return [
    { label: "학생", value: input.studentLabel },
    { label: "단어장", value: input.datasetLabel },
    { label: "범위", value: `오답 · ${levels}` },
    { label: "단어 수", value: `${input.questionCount}개` },
    { label: "공개", value: availabilityIso ? formatKoreanDateTime(availabilityIso) : "즉시" },
    { label: "시간", value: time },
    { label: "마감", value: deadlineIso ? formatKoreanDateTime(deadlineIso) : "마감 없음" },
  ];
}
