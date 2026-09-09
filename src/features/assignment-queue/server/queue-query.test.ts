import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
import { listVocabAssignmentQueueSummaries } from "@/lib/services/vocab-assignment-queue-query";
const admin = { userId: "fake", displayName: "가짜" };
const name = "list_vocab_assignment_queue_summaries_v2";
beforeEach(() => mocks.rpc.mockReset());
it("정상 빈 내역만 빈 목록으로 반환한다", async () => {
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  expect(await listVocabAssignmentQueueSummaries({}, admin)).toEqual([]);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("내용 없는 성공 응답도 빈 목록으로 단정하지 않는다", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await expect(listVocabAssignmentQueueSummaries({}, admin)).rejects.toThrow("상태 응답을 확인하지 못했습니다");
});
it.each(["42883", "PGRST202"])("요청한 v2가 없으면 v1으로 한 번만 조회한다: %s", async code => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: `function ${name} does not exist` } })
    .mockResolvedValueOnce({ data: [], error: null });
  expect(await listVocabAssignmentQueueSummaries({}, admin)).toEqual([]);
  expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual([name, "list_vocab_assignment_queue_summaries_v1"]);
});
it.each(["42501", "08006", "42883"])("권한/연결/다른 함수 오류에서 조회 실패를 표시한다: %s", async code => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code, message: code === "42883" ? "other function missing" : `permission or connection ${name}` } });
  await expect(listVocabAssignmentQueueSummaries({}, admin)).rejects.toThrow("다시 불러와 주세요");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("v1까지 없거나 권한 오류면 빈 목록으로 숨기지 않는다", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42883", message: `function ${name} missing` } })
    .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for list_vocab_assignment_queue_summaries_v1" } });
  await expect(listVocabAssignmentQueueSummaries({}, admin)).rejects.toThrow("다시 불러와 주세요");
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
