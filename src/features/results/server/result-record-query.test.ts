import { beforeEach, describe, expect, it, vi } from "vitest";
import { resultFixtureAttemptId, resultRecordWire } from "@/test-support/vocabulary-result-fixture";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc }) }));
import { getVocabularyResultRecord } from "./result-record-query";

describe("결과 요약의 권한 있는 조회", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["student", "admin"] as const)("%s 주체를 전달하고 성공 계약을 변환한다", async kind => {
    rpc.mockResolvedValue({ data: resultRecordWire(), error: null });
    expect((await getVocabularyResultRecord(resultFixtureAttemptId, { kind, id: "actor" }))?.phases[1].score).toBe(96);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_vocabulary_result_record_v1", { p_actor_kind: kind, p_actor_id: "actor", p_attempt_id: resultFixtureAttemptId });
  });
  it("실제 접근 가능한 행 없음만 null로 반환한다", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getVocabularyResultRecord(resultFixtureAttemptId, { kind: "student", id: "actor" })).toBeNull();
  });
  it.each(["database", "shape", "wrong-attempt"])("%s 실패를 결과 없음으로 바꾸지 않는다", async kind => {
    rpc.mockResolvedValue({ data: kind === "shape" ? {} : resultRecordWire(), error: kind === "database" ? { message: "private db data" } : null });
    await expect(getVocabularyResultRecord(kind === "wrong-attempt" ? "other" : resultFixtureAttemptId, { kind: "student", id: "actor" })).rejects.toThrow("시험 결과를 불러오지 못했습니다.");
  });
});
