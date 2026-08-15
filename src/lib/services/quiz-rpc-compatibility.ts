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

function isMissingRpc(error: QuizRpcError, functionName: string) {
  if (!error || (error.code !== "PGRST202" && error.code !== "42883")) {
    return false;
  }
  const message = error.message?.toLowerCase() ?? "";
  return !message || message.includes(functionName.toLowerCase());
}

export async function answerQuizQuestionWithCompatibleRpc(
  rpc: QuizRpc,
  parameters: Record<string, unknown>,
) {
  const current = await rpc("answer_quiz_question_v3", parameters);
  if (!isMissingRpc(current.error, "answer_quiz_question_v3")) {
    return current;
  }
  return rpc("answer_quiz_question_v2", parameters);
}
