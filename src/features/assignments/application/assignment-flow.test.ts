import { describe, expect, it, vi } from "vitest";

import type { AssignmentTransport } from "../transport/assignment-transport";
import { executeAssignmentRequest } from "./execute-assignment-request";
import {
  createAssignmentSubmissionFlow,
  createAssignmentSubmissionSession,
} from "./submission-flow";

describe("assignment application flow", () => {
  it.each([
    [401, "unauthorized", "reauthenticate"],
    [403, "forbidden", "none"],
    [404, "not_found", "reload_source"],
    [409, "conflict", "refresh_preview"],
    [422, "invalid_request", "none"],
    [503, "temporary", "none"],
  ] as const)("HTTP %s를 %s 오류로 바꾼다", async (
    status,
    kind,
    recovery,
  ) => {
    const result = await executeAssignmentRequest({
      fallback: "요청 실패",
      parse: (data) => data,
      request: { url: "/test" },
      transport: vi.fn().mockResolvedValue({
        data: { error: "서버 문구" },
        ok: false,
        status,
      }),
    });

    expect(result).toEqual({
      error: expect.objectContaining({
        kind,
        message: "서버 문구",
        recovery,
        status,
      }),
      ok: false,
    });
  });

  it("깨진 성공 응답과 네트워크 상세를 일반 문구로 숨긴다", async () => {
    const malformed = await executeAssignmentRequest({
      fallback: "다시 시도해 주세요.",
      parse: () => {
        throw new Error("Zod internals");
      },
      request: { url: "/test" },
      transport: vi.fn().mockResolvedValue({ data: {}, ok: true, status: 200 }),
    });
    const network = await executeAssignmentRequest({
      fallback: "다시 시도해 주세요.",
      parse: (data) => data,
      request: { url: "/test" },
      transport: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    });

    expect(malformed).toEqual({
      error: expect.objectContaining({
        kind: "protocol",
        message: "다시 시도해 주세요.",
      }),
      ok: false,
    });
    expect(network).toEqual({
      error: expect.objectContaining({
        kind: "network",
        message: "다시 시도해 주세요.",
      }),
      ok: false,
    });
  });

  it("422 응답의 입력 위치를 공통 오류에 보존한다", async () => {
    const result = await executeAssignmentRequest({
      fallback: "다시 시도해 주세요.",
      parse: (data) => data,
      request: { url: "/test" },
      transport: vi.fn().mockResolvedValue({
        data: {
          error: "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
          fieldPath: "deadline",
        },
        ok: false,
        status: 422,
      }),
    });

    expect(result).toEqual({
      error: expect.objectContaining({
        fieldPath: "deadline",
        kind: "invalid_request",
      }),
      ok: false,
    });
  });

  it("동시 저장은 한 번만 보내고 실패 재시도에는 같은 멱등키를 쓴다", async () => {
    let releaseFirst!: (value: {
      data: unknown;
      ok: boolean;
      status: number;
    }) => void;
    const requests: string[] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push((request.body as { idempotencyKey: string }).idempotencyKey);
      if (requests.length === 1) {
        return await new Promise<{
          data: unknown;
          ok: boolean;
          status: number;
        }>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { data: { assignmentId: "created" }, ok: true, status: 201 };
    });
    const clock = vi.fn(() => 1000);
    const flow = createAssignmentSubmissionFlow({
      busyMessage: "저장 중",
      clock,
      createIdempotencyKey: () => "same-key",
      createRequestId: (() => {
        let index = 0;
        return () => `request-${++index}`;
      })(),
      fallback: "저장 실패",
      transport,
    });
    const prepare = () => ({
      ok: true as const,
      value: {
        fallback: "저장 실패",
        fingerprint: "same-payload",
        parse: (data: unknown) => data as { assignmentId: string },
        request: (idempotencyKey: string) => ({
          body: { idempotencyKey },
          method: "POST" as const,
          url: "/test",
        }),
      },
    });

    const first = flow.run(prepare);
    const duplicate = await flow.run(prepare);
    expect(duplicate).toEqual({
      error: expect.objectContaining({ kind: "busy" }),
      ok: false,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(1);

    releaseFirst({ data: { error: "일시 오류" }, ok: false, status: 503 });
    await expect(first).resolves.toEqual({
      error: expect.objectContaining({ kind: "temporary" }),
      ok: false,
    });
    await expect(flow.run(prepare)).resolves.toMatchObject({ ok: true });
    expect(requests).toEqual(["same-key", "same-key"]);
  });

  it("순차 재호출도 같은 의미면 같은 멱등키를 유지한다", async () => {
    const keys: string[] = [];
    const transport: AssignmentTransport = vi.fn().mockResolvedValue({
      data: { assignmentId: "created" },
      ok: true,
      status: 201,
    });
    const flow = createAssignmentSubmissionFlow({
      busyMessage: "저장 중",
      clock: () => 1000,
      createIdempotencyKey: () => "idempotency",
      createRequestId: () => crypto.randomUUID(),
      fallback: "저장 실패",
      transport,
    });
    const prepare = () => ({
      ok: true as const,
      value: {
        fallback: "저장 실패",
        fingerprint: "same-payload",
        parse: (data: unknown) => data as { assignmentId: string },
        request: (idempotencyKey: string) => {
          keys.push(idempotencyKey);
          return {
            body: { idempotencyKey },
            method: "POST" as const,
            url: "/test",
          };
        },
      },
    });

    await expect(flow.run(prepare)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    await expect(flow.run(prepare)).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(keys).toEqual(["idempotency", "idempotency"]);
  });

  it("실패 뒤 시험 조건이 바뀌면 새 멱등키로 저장한다", async () => {
    const keys: string[] = [];
    const generatedKeys = ["first-key", "changed-key"];
    const transport: AssignmentTransport = vi
      .fn()
      .mockResolvedValueOnce({
        data: { error: "일시 오류" },
        ok: false,
        status: 503,
      })
      .mockResolvedValueOnce({
        data: { assignmentId: "created" },
        ok: true,
        status: 201,
      });
    const flow = createAssignmentSubmissionFlow({
      busyMessage: "저장 중",
      clock: () => 1000,
      createIdempotencyKey: () => generatedKeys.shift() ?? "unexpected-key",
      createRequestId: (() => {
        let index = 0;
        return () => `request-${++index}`;
      })(),
      fallback: "저장 실패",
      transport,
    });
    const prepare = (fingerprint: string) => () => ({
      ok: true as const,
      value: {
        fallback: "저장 실패",
        fingerprint,
        parse: (data: unknown) => data as { assignmentId: string },
        request: (idempotencyKey: string) => {
          keys.push(idempotencyKey);
          return {
            body: { idempotencyKey },
            method: "POST" as const,
            url: "/test",
          };
        },
      },
    });

    await expect(flow.run(prepare("condition-a"))).resolves.toMatchObject({
      error: { kind: "temporary" },
      ok: false,
    });
    await expect(flow.run(prepare("condition-b"))).resolves.toMatchObject({
      ok: true,
    });
    expect(keys).toEqual(["first-key", "changed-key"]);
  });

  it("실행 객체가 바뀌어도 같은 제출 세션은 멱등키와 동시 저장 잠금을 유지한다", async () => {
    let releaseFirst!: (value: {
      data: unknown;
      ok: boolean;
      status: number;
    }) => void;
    const keys: string[] = [];
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce("stable-key")
      .mockReturnValue("unexpected-key");
    const session = createAssignmentSubmissionSession();
    const firstTransport: AssignmentTransport = vi.fn(async (request) => {
      keys.push((request.body as { idempotencyKey: string }).idempotencyKey);
      return await new Promise<{
        data: unknown;
        ok: boolean;
        status: number;
      }>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const secondTransport: AssignmentTransport = vi.fn(async (request) => {
      keys.push((request.body as { idempotencyKey: string }).idempotencyKey);
      return { data: { assignmentId: "created" }, ok: true, status: 201 };
    });
    const createFlow = (transport: AssignmentTransport, requestId: string) =>
      createAssignmentSubmissionFlow({
        busyMessage: "저장 중",
        clock: () => 1000,
        createIdempotencyKey,
        createRequestId: () => requestId,
        fallback: "저장 실패",
        session,
        transport,
      });
    const prepare = () => ({
      ok: true as const,
      value: {
        fallback: "저장 실패",
        fingerprint: "same-payload",
        parse: (data: unknown) => data as { assignmentId: string },
        request: (idempotencyKey: string) => ({
          body: { idempotencyKey },
          method: "POST" as const,
          url: "/test",
        }),
      },
    });
    const firstFlow = createFlow(firstTransport, "first-request");
    const recreatedFlow = createFlow(secondTransport, "second-request");

    const first = firstFlow.run(prepare);
    await expect(recreatedFlow.run(prepare)).resolves.toMatchObject({
      error: { kind: "busy" },
      ok: false,
    });
    releaseFirst({ data: { error: "일시 오류" }, ok: false, status: 503 });
    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(recreatedFlow.run(prepare)).resolves.toMatchObject({ ok: true });
    expect(keys).toEqual(["stable-key", "stable-key"]);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});
