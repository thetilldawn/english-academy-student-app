export function isVocabAssignmentQueueUnavailable(error: {
  code?: string;
  message: string;
}, functionName: string) {
  return ["42883", "PGRST202"].includes(error.code ?? "") &&
    error.message.toLowerCase().split(/[^a-z0-9_]+/).includes(functionName.toLowerCase());
}
