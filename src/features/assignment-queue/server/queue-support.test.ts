import { expect, it } from "vitest";
import { isVocabAssignmentQueueUnavailable } from "@/lib/services/vocab-assignment-queue-support";
const name = "list_vocab_assignment_queue_summaries_v2";
it.each(["42883", "PGRST202"])("요청한 함수 없음만 대체한다: %s", code => {
  expect(isVocabAssignmentQueueUnavailable({ code, message: `function public.${name}() does not exist` }, name)).toBe(true);
});
it.each([
  { code: "42501", message: `permission denied for function ${name}` },
  { code: "08006", message: `${name} connection failed` },
  { message: name },
  { code: "42883", message: "function other_function does not exist" },
  { code: "PGRST202", message: `function ${name}_extra does not exist` },
])("권한/연결/다른 함수를 미설치로 숨기지 않는다: %j", error => {
  expect(isVocabAssignmentQueueUnavailable(error, name)).toBe(false);
});
