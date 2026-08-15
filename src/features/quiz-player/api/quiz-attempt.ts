import { z } from "zod";

import { QUIZ_REQUEST_TIMEOUT_MS } from "../domain/quiz-session";
import type {
  QuizAnswerResponse,
  QuizAttemptResponse,
  QuizFeedbackResumeResponse,
  QuizTransportResult,
} from "../model";

const pronunciationSegmentSchema = z.object({
  text: z.string().min(1),
  stress: z.enum(["none", "secondary", "primary"]),
});

const pronunciationSchema = z.object({
  displayKo: z.string().nullable(),
  segments: z.array(pronunciationSegmentSchema).optional(),
  variantId: z.string().nullable(),
  audioUrl: z.string().nullable(),
  available: z.boolean(),
});

const questionSchema = z.object({
  id: z.string().min(1),
  orderIndex: z.number().int().positive(),
  direction: z.enum(["english_to_korean", "korean_to_english"]),
  prompt: z.string(),
  choices: z.array(z.string()).length(4),
  pronunciation: pronunciationSchema,
  choicePronunciations: z.array(pronunciationSchema).length(4),
  initialChoiceIndex: z.number().int().min(0).max(3).nullable(),
  initialIsCorrect: z.boolean().nullable(),
  retryChoiceIndex: z.number().int().min(0).max(3).nullable(),
  retryIsCorrect: z.boolean().nullable(),
  priorWrongLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  initialTimedOut: z.boolean(),
  retryTimedOut: z.boolean(),
  revealedCorrectChoiceIndex: z.number().int().min(0).max(3).nullable(),
});

const attemptSchema = z.object({
  id: z.string().min(1),
  assignmentTitle: z.string(),
  status: z.enum(["in_progress", "completed", "expired"]),
  phase: z.enum(["initial", "review", "retry", "completed"]),
  startedAt: z.string().min(1),
  deadlineAt: z.string().min(1),
  timerDeadlineAt: z.string().min(1),
  timingMode: z.enum(["total", "per_question"]),
  questionTimeLimitSeconds: z.number().int().positive().nullable(),
  questions: z.array(questionSchema),
  currentQuestionId: z.string().nullable(),
});

const answerResponseSchema = z
  .object({
    correct: z.boolean().optional(),
    correctChoiceIndex: z.number().int().min(0).max(3).optional(),
    completed: z.boolean().optional(),
    needsRetry: z.boolean().optional(),
    expired: z.boolean().optional(),
    nextQuestionId: z.string().nullable().optional(),
    nextPhase: z.enum(["initial", "retry"]).nullable().optional(),
    initialAnsweredCount: z.number().int().nonnegative().optional(),
    initialQuestionCount: z.number().int().nonnegative().optional(),
    retryAnsweredCount: z.number().int().nonnegative().optional(),
    retryQuestionCount: z.number().int().nonnegative().optional(),
    timedOut: z.boolean().optional(),
    questionDeadlineAt: z.string().nullable().optional(),
    timerRemainingMilliseconds: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
  })
  .superRefine((payload, context) => {
    if (
      payload.expired !== true &&
      (typeof payload.correct !== "boolean" ||
        typeof payload.correctChoiceIndex !== "number")
    ) {
      context.addIssue({
        code: "custom",
        message: "quiz answer response is missing the result",
      });
    }

    const isTerminal =
      payload.expired === true ||
      payload.completed === true ||
      payload.needsRetry === true;
    if (isTerminal) return;

    if (
      !payload.nextQuestionId ||
      !payload.nextPhase ||
      !payload.questionDeadlineAt ||
      typeof payload.timerRemainingMilliseconds !== "number"
    ) {
      context.addIssue({
        code: "custom",
        message: "quiz answer response is missing the next timer state",
      });
    }
  });

const attemptResponseSchema = z.object({
  attempt: attemptSchema,
  timerRemainingMilliseconds: z.number().int().nonnegative(),
});

const feedbackResumeResponseSchema = z.object({
  questionDeadlineAt: z.string().min(1),
  questionStartsAt: z.string().min(1),
  timerRemainingMilliseconds: z.number().int().nonnegative(),
  transitionRemainingMilliseconds: z.number().int().nonnegative(),
});

const errorResponseSchema = z.object({
  error: z.string().optional(),
});

async function boundedFetch(
  resource: RequestInfo | URL,
  options?: RequestInit,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    QUIZ_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function responsePayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<unknown>;
}

function errorPayload(value: unknown) {
  const result = errorResponseSchema.safeParse(value);
  return result.success ? result.data : {};
}

export async function submitQuizAnswer(input: {
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
  choiceIndex: number | null;
}): Promise<QuizTransportResult<QuizAnswerResponse>> {
  const requestStartedAt = performance.now();
  const response = await boundedFetch(
    `/api/student/attempts/${input.attemptId}/${
      input.choiceIndex === null ? "timeouts" : "answers"
    }`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: input.questionId,
        phase: input.phase,
        ...(input.choiceIndex === null
          ? {}
          : { choiceIndex: input.choiceIndex }),
      }),
    },
  );
  const payload = await responsePayload(response);
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, payload: errorPayload(payload), ...timing };
  }
  return {
    ok: true,
    payload: answerResponseSchema.parse(payload) as QuizAnswerResponse,
    ...timing,
  };
}

export async function recoverQuizAttempt(
  attemptId: string,
): Promise<QuizTransportResult<QuizAttemptResponse>> {
  const requestStartedAt = performance.now();
  const response = await boundedFetch(`/api/student/attempts/${attemptId}`, {
    cache: "no-store",
  });
  const payload = await responsePayload(response);
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, payload: errorPayload(payload), ...timing };
  }
  return {
    ok: true,
    payload: attemptResponseSchema.parse(payload) as QuizAttemptResponse,
    ...timing,
  };
}

export async function resumeQuizAfterFeedback(input: {
  attemptId: string;
  nextPhase: "initial" | "retry";
  nextQuestionId: string;
  transitionRemainingMilliseconds: number;
}): Promise<QuizTransportResult<QuizFeedbackResumeResponse>> {
  const requestStartedAt = performance.now();
  const response = await boundedFetch(
    `/api/student/attempts/${input.attemptId}/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nextPhase: input.nextPhase,
        nextQuestionId: input.nextQuestionId,
        transitionRemainingMilliseconds:
          input.transitionRemainingMilliseconds,
      }),
    },
  );
  const payload = await responsePayload(response);
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, payload: errorPayload(payload), ...timing };
  }
  return {
    ok: true,
    payload: feedbackResumeResponseSchema.parse(
      payload,
    ) as QuizFeedbackResumeResponse,
    ...timing,
  };
}

export async function expireQuizAttempt(attemptId: string) {
  return fetch(`/api/student/attempts/${attemptId}/expire`, {
    method: "POST",
  });
}
