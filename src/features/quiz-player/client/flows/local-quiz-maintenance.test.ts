import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const prune = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./local-quiz-store", () => ({ pruneLocalQuizContents: prune }));
import { cancelLocalQuizMaintenance, scheduleLocalQuizMaintenance } from "./local-quiz-maintenance";

beforeEach(() => { vi.useFakeTimers(); prune.mockClear(); });
afterEach(() => { cancelLocalQuizMaintenance(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("시험과 겹치지 않는 기기 자료 정리", () => {
  it("다른 탭의 시험이 잠금을 갖고 있으면 정리를 건너뛴다", async () => {
    const request = vi.fn(async (_name, _options, callback) => callback(null));
    vi.stubGlobal("navigator", { locks: { request } });
    scheduleLocalQuizMaintenance(); await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledWith("quiz-offline-assets-v1", expect.objectContaining({ mode: "exclusive", ifAvailable: true }), expect.any(Function));
    expect(prune).not.toHaveBeenCalled();
  });
  it("시험 진입은 예약과 이미 진행 중인 정리를 취소한다", async () => {
    const request = vi.fn(async (_name, _options, callback) => callback({ name: "quiz-offline-assets-v1" }));
    vi.stubGlobal("navigator", { locks: { request } });
    scheduleLocalQuizMaintenance(); cancelLocalQuizMaintenance();
    await vi.advanceTimersByTimeAsync(5000); expect(prune).not.toHaveBeenCalled();
    let release!: () => void;
    prune.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    scheduleLocalQuizMaintenance(); await vi.advanceTimersByTimeAsync(5000);
    const signal = prune.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false); cancelLocalQuizMaintenance(); expect(signal.aborted).toBe(true);
    release();
  });
  it("탭 간 잠금이 없는 브라우저에서는 정리로 시험을 방해하지 않는다", async () => {
    vi.stubGlobal("navigator", {});
    scheduleLocalQuizMaintenance(); await vi.advanceTimersByTimeAsync(5000);
    expect(prune).not.toHaveBeenCalled();
  });
});
