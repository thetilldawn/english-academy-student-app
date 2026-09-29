import { describe, expect, it, vi } from "vitest";
import { createAssignmentSubmissionFlow, createAssignmentSubmissionSession } from "./submission-flow";
import type { AssignmentTransport, AssignmentTransportRequest } from "../transport/assignment-transport";

function setup(transport: AssignmentTransport) {
  let sequence = 0;
  let now = 1;
  const session = createAssignmentSubmissionSession();
  const createKey = vi.fn(() => `key-${++sequence}`);
  const makeFlow = () => createAssignmentSubmissionFlow({
    busyMessage: "저장 중", clock: () => now,
    createIdempotencyKey: createKey, createRequestId: () => `request-${++sequence}`,
    fallback: "저장 실패", retainUncertainSubmission: true, session, transport,
  });
  const source = { studentIds: ["fake-a"], score: 80, signature: "signed-original" };
  const prepare = vi.fn((at: number) => ({
    ok: true as const, value: {
      fallback: "실패", fingerprint: JSON.stringify(source),
      parse: (data: unknown) => {
        if (!data || typeof data !== "object" || !("count" in data) || data.count !== 1) throw new Error("invalid response");
        return data;
      },
      request: (idempotencyKey: string): AssignmentTransportRequest => ({
        url: "/save", method: "POST", body: { ...source, at, idempotencyKey },
      }),
    },
  }));
  return { makeFlow, prepare, createKey, source, setClock: (at: number) => { now = at; } };
}

describe("미확정 저장 복구", () => {
  it.each(["network", "503", "protocol", "abort"] as const)("%s 뒤 최초 완성 요청과 파서를 유지하며 모의 영수증은 하나다", async cause => {
    const requests: AssignmentTransportRequest[] = [];
    const receipts = new Map<string, unknown>();
    const transport: AssignmentTransport = async request => {
      requests.push(structuredClone(request));
      const body = request.body as { idempotencyKey: string };
      if (!receipts.has(body.idempotencyKey)) receipts.set(body.idempotencyKey, { count: 1 });
      if (requests.length === 1) {
        if (cause === "network") throw new Error("response lost after commit");
        if (cause === "abort") throw new DOMException("aborted", "AbortError");
        return { ok: cause === "protocol", status: cause === "protocol" ? 201 : 503, data: null };
      }
      return { ok: true, status: 201, data: receipts.get(body.idempotencyKey) };
    };
    const state = setup(transport);
    expect(await state.makeFlow().run(state.prepare)).toMatchObject({ ok: false, uncertain: true });
    state.source.studentIds.push("fake-b"); state.source.score = 90; state.setClock(999999999);
    expect(await state.makeFlow().run(state.prepare)).toMatchObject({ ok: false, uncertain: true });
    expect(requests).toHaveLength(1);
    expect(await state.makeFlow().recover()).toMatchObject({ ok: true, replayed: true, value: { count: 1 } });
    expect(requests[1]).toEqual(requests[0]);
    expect(state.prepare).toHaveBeenCalledOnce(); expect(state.createKey).toHaveBeenCalledOnce();
    expect(receipts.size).toBe(1);
  });

  it.each([400, 401, 403, 404, 409, 422])("미확정 후 %i도 최초 미저장 증거로 삼지 않는다", async status => {
    const transport = vi.fn()
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce({ ok: false, status, data: { error: "rejected retry" } })
      .mockResolvedValue({ ok: true, status: 201, data: { count: 1 } });
    const state = setup(transport); const flow = state.makeFlow();
    await flow.run(state.prepare);
    expect(await flow.recover()).toMatchObject({ ok: false, uncertain: true });
    expect(await flow.run(state.prepare)).toMatchObject({ ok: false, uncertain: true });
    expect(await flow.recover()).toMatchObject({ ok: true });
    expect(transport.mock.calls.map(([r]) => r.body)).toEqual(Array(3).fill(transport.mock.calls[0][0].body));
    expect(state.createKey).toHaveBeenCalledOnce();
  });

  it("최초 확정 거절이면 변경된 입력에 새 키를 허용한다", async () => {
    const transport = vi.fn().mockResolvedValueOnce({ ok: false, status: 422, data: null })
      .mockResolvedValue({ ok: true, status: 201, data: { count: 1 } });
    const state = setup(transport); const flow = state.makeFlow();
    expect(await flow.run(state.prepare)).toMatchObject({ ok: false, uncertain: false });
    state.source.score = 90;
    expect(await flow.run(state.prepare)).toMatchObject({ ok: true });
    expect(state.createKey).toHaveBeenCalledTimes(2);
  });

  it("복구 이중 클릭을 막고 원래 응답 검증도 유지한다", async () => {
    let settle!: (value: { ok: boolean; status: number; data: unknown }) => void;
    const transport = vi.fn().mockRejectedValueOnce(new Error("lost"))
      .mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }))
      .mockResolvedValueOnce({ ok: true, status: 201, data: { count: 1 } });
    const state = setup(transport); const flow = state.makeFlow();
    await flow.run(state.prepare);
    const pending = flow.recover();
    expect(await state.makeFlow().recover()).toMatchObject({ ok: false, error: { kind: "busy" } });
    settle({ ok: true, status: 201, data: { count: 2 } });
    expect(await pending).toMatchObject({ ok: false, uncertain: true });
    expect(await flow.recover()).toMatchObject({ ok: true });
    expect(transport).toHaveBeenCalledTimes(3);
  });
});
