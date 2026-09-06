// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVocabScheduleTemplateInput } from "./use-vocab-schedule-template-input";

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("시간 양식 이름 입력", () => {
  it("성공하면 이름을 비우고 기존 알림을 한 번 보낸다", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useVocabScheduleTemplateInput({ saving: false, onSave }));
    act(() => result.current.setName(" 저녁반 "));
    await act(async () => result.current.save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith(" 저녁반 ");
    expect(result.current.name).toBe("");
    expect(notifications.success).toHaveBeenCalledExactlyOnceWith("시간 템플릿을 저장했습니다.");
  });

  it("실패하면 이름을 유지하고 같은 입력으로 다시 시도한다", async () => {
    const onSave = vi.fn().mockResolvedValueOnce({ ok: false, message: "시간 템플릿을 저장하지 못했습니다." }).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useVocabScheduleTemplateInput({ saving: false, onSave }));
    act(() => result.current.setName("저녁반"));
    await act(async () => result.current.save());
    expect(result.current.name).toBe("저녁반");
    expect(notifications.error).toHaveBeenCalledOnce();
    await act(async () => result.current.save());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(result.current.name).toBe("");
  });

  it("예외도 안전한 안내로 바꾸고 입력을 보존한다", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("private transport detail"));
    const { result } = renderHook(() => useVocabScheduleTemplateInput({ saving: false, onSave }));
    act(() => result.current.setName("저녁반"));
    await act(async () => result.current.save());
    expect(result.current.name).toBe("저녁반");
    expect(notifications.error).toHaveBeenCalledExactlyOnceWith("시간 템플릿을 저장하지 못했습니다.");
  });

  it("빈 이름·저장 중·같은 갱신의 두 클릭은 추가 저장하지 않는다", async () => {
    let finish!: (value: { ok: true }) => void;
    const onSave = vi.fn(() => new Promise<{ ok: true }>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ saving }) => useVocabScheduleTemplateInput({ saving, onSave }), { initialProps: { saving: false } });
    await act(async () => result.current.save());
    expect(onSave).not.toHaveBeenCalled();
    act(() => result.current.setName("저녁반"));
    rerender({ saving: true });
    await act(async () => result.current.save());
    expect(onSave).not.toHaveBeenCalled();
    rerender({ saving: false });
    let pending!: Promise<void>;
    act(() => { pending = result.current.save(); void result.current.save(); });
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => { finish({ ok: true }); await pending; });
    expect(notifications.success).toHaveBeenCalledOnce();
  });
});
