type QuizRpcError = {
  code?: string;
  message?: string;
} | null;

export type QuizRpcResult = {
  data: unknown;
  error: QuizRpcError;
};

export type QuizRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => PromiseLike<QuizRpcResult>;

type Wait = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isMissingRpc(error: QuizRpcError, functionName: string) {
  if (!error || (error.code !== "PGRST202" && error.code !== "42883")) {
    return false;
  }
  const message = error.message?.toLowerCase() ?? "";
  return message.includes(functionName.toLowerCase());
}

export async function answerQuizQuestionWithCompatibleRpc(
  rpc: QuizRpc,
  parameters: Record<string, unknown>,
) {
  const current = await rpc("answer_quiz_question_v3", parameters);
  if (!isMissingRpc(current.error, "answer_quiz_question_v3")) {
    return { ...current, feedbackProtocol: "variable" as const };
  }
  const legacy = await rpc("answer_quiz_question_v2", parameters);
  return { ...legacy, feedbackProtocol: "legacy" as const };
}

export async function resumeQuizAfterFeedbackWithCompatibleRpc(
  rpc: QuizRpc,
  parameters: Record<string, unknown>,
  pause: Wait = wait,
) {
  const current = await rpc("resume_quiz_after_feedback_v2", parameters);
  if (!isMissingRpc(current.error, "resume_quiz_after_feedback_v2")) {
    return current;
  }
  const transitionRemaining =
    typeof parameters.p_transition_remaining_milliseconds === "number"
      ? parameters.p_transition_remaining_milliseconds
      : 0;
  const legacyDelay = Math.max(0, transitionRemaining - 150);
  if (legacyDelay > 0) {
    await pause(legacyDelay);
  }
  const legacyParameters = Object.fromEntries(
    Object.entries(parameters).filter(
      ([key]) => key !== "p_transition_remaining_milliseconds",
    ),
  );
  const legacy = await rpc("resume_quiz_after_feedback_v1", legacyParameters);
  if (!legacy.error?.message?.includes("feedback_window_invalid")) {
    return legacy;
  }

  for (let retry = 0; retry < 3; retry += 1) {
    await pause(250);
    const refreshed = await rpc("resume_quiz_after_feedback_v2", parameters);
    if (!isMissingRpc(refreshed.error, "resume_quiz_after_feedback_v2")) {
      return refreshed;
    }
  }
  return legacy;
}
