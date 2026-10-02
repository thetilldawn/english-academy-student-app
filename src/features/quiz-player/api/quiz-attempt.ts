import { z } from "zod";

import { awaitWithAbortSignal, createRequestDeadline } from "@/lib/network/request-policy";
import { quizContentModes } from "@/lib/quiz/question-content-mode";

import { QUIZ_COMMAND_TIMEOUT_MS, QUIZ_REQUEST_TIMEOUT_MS } from "../domain/quiz-session";
import type {
  QuizAnswerResponse,
  QuizAttemptResponse,
  QuizFeedbackResumeResponse,
  QuizTransportResult,
  QuizExpirationResponse,
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
  quizContentMode: z.enum(quizContentModes).optional(),
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

export const attemptSchema = z.object({
  id: z.string().min(1),
  assignmentTitle: z.string(),
  quizContentMode: z.enum(quizContentModes),
  status: z.enum(["in_progress", "completed", "expired"]),
  phase: z.enum(["initial", "review", "retry", "completed"]),
  startedAt: z.string().min(1),
  deadlineAt: z.string().min(1),
  timerDeadlineAt: z.string().min(1),
  timingMode: z.enum(["none", "total", "per_question"]),
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
    feedbackProtocol: z.enum(["legacy", "variable"]).optional(),
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

export const attemptResponseSchema = z.object({
  completionConfirmed: z.boolean().optional(),
  attempt: attemptSchema,
  timerRemainingMilliseconds: z.number().int().nonnegative(),
  transitionRemainingMilliseconds: z.number().int().min(0).max(7_250).optional(),
});

const feedbackResumeResponseSchema = z.object({
  questionDeadlineAt: z.string().min(1),
  questionStartsAt: z.string().min(1),
  timerRemainingMilliseconds: z.number().int().nonnegative(),
  transitionRemainingMilliseconds: z.number().int().nonnegative(),
});

const errorResponseSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
  outcome: z.enum(["not_applied", "unknown"]).optional(),
});

async function boundedRequest<T>(
  resource: RequestInfo | URL,
  options: RequestInit,
  read: (response: Response) => Promise<T>,
  timeoutMilliseconds = QUIZ_REQUEST_TIMEOUT_MS,
) {
  const deadline = createRequestDeadline(timeoutMilliseconds, options.signal);
  try {
    const response = await awaitWithAbortSignal(fetch(resource, {
      ...options,
      signal: deadline.signal,
    }), deadline.signal);
    return await awaitWithAbortSignal(read(response), deadline.signal);
  } finally {
    deadline.dispose();
  }
}

async function readPayload(response: Response) {
  const payload: unknown = await response.json().catch(() => ({}));
  return { response, payload };
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
}, basePath = "/api/student/attempts"): Promise<QuizTransportResult<QuizAnswerResponse>> {
  const requestStartedAt = performance.now();
  const { response, payload } = await boundedRequest(
    `${basePath}/${input.attemptId}/${
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
    readPayload,
    QUIZ_COMMAND_TIMEOUT_MS,
  );
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, status: response.status, payload: errorPayload(payload), ...timing };
  }
  return {
    ok: true,
    payload: answerResponseSchema.parse(payload) as QuizAnswerResponse,
    ...timing,
  };
}

export async function recoverQuizAttempt(
  attemptId: string,
  basePath = "/api/student/attempts",
): Promise<QuizTransportResult<QuizAttemptResponse>> {
  const requestStartedAt = performance.now();
  const { response, payload } = await boundedRequest(`${basePath}/${attemptId}`, {
    cache: "no-store",
  }, readPayload);
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, status: response.status, payload: errorPayload(payload), ...timing };
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
}, basePath = "/api/student/attempts"): Promise<QuizTransportResult<QuizFeedbackResumeResponse>> {
  const requestStartedAt = performance.now();
  const { response, payload } = await boundedRequest(
    `${basePath}/${input.attemptId}/feedback`,
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
    readPayload,
  );
  const receivedAt = performance.now();
  const timing = {
    receivedAt,
    roundTripMilliseconds: Math.max(0, receivedAt - requestStartedAt),
  };
  if (!response.ok) {
    return { ok: false, status: response.status, payload: errorPayload(payload), ...timing };
  }
  return {
    ok: true,
    payload: feedbackResumeResponseSchema.parse(
      payload,
    ) as QuizFeedbackResumeResponse,
    ...timing,
  };
}

export async function expireQuizAttempt(attemptId: string, basePath = "/api/student/attempts"): Promise<QuizExpirationResponse> {
  const { response, payload } = await boundedRequest(`${basePath}/${attemptId}/expire`, {
    method: "POST",
  }, readPayload, QUIZ_COMMAND_TIMEOUT_MS);
  // Regular expiry returns {ok:true}; practice expiry returns its saved attempt.
  const attempt = attemptResponseSchema.safeParse(payload);
  if (response.ok && (basePath === "/api/student/attempts" && z.object({ ok: z.literal(true) }).safeParse(payload).success ||
      attempt.success && attempt.data.attempt.id === attemptId && attempt.data.attempt.status !== "in_progress" &&
      attempt.data.attempt.phase === "completed" && attempt.data.completionConfirmed !== false)) return { ok: true };
  return { ok: false, payload: response.ok ? { outcome: "unknown" } : errorPayload(payload) };
}
