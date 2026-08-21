// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssignmentTransport } from "./assignment-transport";
import { useVocabTimeTemplates } from "./use-vocab-time-templates";

const templateId = "00000000-0000-4000-8000-000000000111";

describe("영구 시간 템플릿", () => {
  it("배정일 자정부터 공개하는 기본 버튼을 제공한다", () => {
    const { result } = renderHook(() => useVocabTimeTemplates({
      initialTemplates: [],
      schedule: {
        startDate: "2026-08-17",
        weekdays: [1],
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
      },
      timing: { mode: "total", totalSeconds: 300 },
      transport: vi.fn(),
    }));

    expect(result.current.timeTemplates).toContainEqual(expect.objectContaining({
      id: "day-start",
      label: "하루 시작",
      availableTime: "00:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    }));
  });

  it("서버 저장에 성공한 템플릿만 현재 버튼 목록에 추가한다", async () => {
    const transport: AssignmentTransport = vi.fn(async () => ({
      ok: true,
      status: 201,
      data: {
        template: {
          id: templateId,
          name: "저녁 수업",
          availableTime: "18:00",
          deadlineDayOffset: 1,
          deadlineTime: "22:00",
          timingMode: "total",
          totalSeconds: 300,
          perQuestionSeconds: null,
        },
      },
    }));
    const { result } = renderHook(() => useVocabTimeTemplates({
      initialTemplates: [],
      schedule: {
        startDate: "2026-08-17",
        weekdays: [1, 3, 5],
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
      },
      timing: { mode: "total", totalSeconds: 300 },
      transport,
    }));

    await act(async () => {
      expect(await result.current.saveCurrentTemplate("저녁 수업"))
        .toMatchObject({ ok: true });
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url: "/api/admin/vocab-time-templates",
    }));
    expect(result.current.customTemplates).toHaveLength(1);
    expect(result.current.customTemplates[0]?.label).toBe("저녁 수업");
  });

  it("서버 실패 시 임시 버튼을 만들지 않고 오류를 돌려준다", async () => {
    const transport: AssignmentTransport = vi.fn(async () => ({
      ok: false,
      status: 409,
      data: { error: "같은 이름의 시간 템플릿이 이미 있습니다." },
    }));
    const { result } = renderHook(() => useVocabTimeTemplates({
      initialTemplates: [],
      schedule: {
        startDate: "2026-08-17",
        weekdays: [1],
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
      },
      timing: { mode: "total", totalSeconds: 300 },
      transport,
    }));

    let outcome: Awaited<ReturnType<typeof result.current.saveCurrentTemplate>>;
    await act(async () => {
      outcome = await result.current.saveCurrentTemplate("중복");
    });
    expect(outcome!).toEqual({
      ok: false,
      message: "같은 이름의 시간 템플릿이 이미 있습니다.",
    });
    expect(result.current.customTemplates).toHaveLength(0);
  });

  it("기본 버튼과 같은 이름은 서버에 보내지 않는다", async () => {
    const transport: AssignmentTransport = vi.fn();
    const { result } = renderHook(() => useVocabTimeTemplates({
      initialTemplates: [],
      schedule: {
        startDate: "2026-08-17",
        weekdays: [1],
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
      },
      timing: { mode: "total", totalSeconds: 300 },
      transport,
    }));
    await act(async () => {
      expect(await result.current.saveCurrentTemplate("저녁")).toEqual({
        ok: false,
        message: "같은 이름의 시간 버튼이 이미 있습니다.",
      });
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
