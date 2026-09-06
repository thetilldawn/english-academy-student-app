import type { AssignmentDirectionRatio, AssignmentQuestionMode } from "./model";

const flexiblePolicy = { fixedDirectionRatio: null, schedule: "flexible" } as const;
const singleImmediatePolicy = { fixedDirectionRatio: 0, schedule: "single-immediate" } as const;

/** Assignment restrictions, not a claim that a selected DAY has eligible questions. */
export function assignmentQuestionModePolicy(mode: AssignmentQuestionMode) {
  return mode === "book_meaning_choice" ? flexiblePolicy : singleImmediatePolicy;
}

export function assignmentQuestionModeAvailability(input: {
  datasetSelected: boolean;
  availableModes?: readonly AssignmentQuestionMode[];
}) {
  const status = !input.datasetSelected ? "unselected"
    : input.availableModes === undefined ? "unavailable" : "ready";
  return {
    status,
    availableModes: status === "ready" ? input.availableModes! : [],
  } as const;
}

export type QuestionModeSchedulePlan = {
  selectedDateCount: number;
  distribution: "split" | "repeat";
  splitBasis: "range_unit" | "question_count";
  sessions: readonly { availableFrom: string | null; availableUntil: string | null }[];
  recurrenceSessions: readonly { availableFrom: string | null; availableUntil: string | null }[];
};

export function assignmentQuestionModeIssues(
  mode: AssignmentQuestionMode,
  directionRatio: AssignmentDirectionRatio,
  plan?: QuestionModeSchedulePlan | null,
) {
  const policy = assignmentQuestionModePolicy(mode);
  const direction = policy.fixedDirectionRatio !== null &&
    directionRatio !== policy.fixedDirectionRatio;
  const hasTimes = (session: QuestionModeSchedulePlan["sessions"][number]) =>
    session.availableFrom !== null || session.availableUntil !== null;
  const schedule = policy.schedule === "single-immediate" && !!plan && (
    plan.selectedDateCount !== 0 || plan.distribution !== "repeat" ||
    plan.splitBasis !== "question_count" || plan.sessions.length !== 1 ||
    plan.recurrenceSessions.length !== 1 || plan.sessions.some(hasTimes) ||
    plan.recurrenceSessions.some(hasTimes)
  );
  return { direction, schedule };
}

// Validation messages are part of the existing request contract, not UI translations.
export const assignmentQuestionModeErrors = {
  direction: "영영풀이·예문 시험은 영어 단어 고르기로만 출제합니다.",
  schedule: "영영풀이·예문 시험은 현재 시험일 없이 1회만 바로 배정할 수 있습니다.",
  serverSchedule: "영영풀이·예문 시험은 시험일 없이 1회만 바로 배정할 수 있습니다.",
} as const;
