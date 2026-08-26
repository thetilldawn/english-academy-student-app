export function isVocabAssignmentQueueUnavailable(error: {
  code?: string;
  message: string;
}) {
  return error.code === "42883" ||
    error.code === "PGRST202" ||
    error.message.includes("list_vocab_assignment_queue_summaries_v1");
}
