// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelStudentReviewDraft,
  createStudentWorksheetRequest,
  queueStudentWrongWords,
} from "../api/wrong-word-transport";
import { useStudentWrongWordActions } from "./use-student-wrong-word-actions";

vi.mock("../api/wrong-word-transport", () => ({
  cancelStudentReviewDraft: vi.fn(),
  createStudentWorksheetRequest: vi.fn(),
  queueStudentWrongWords: vi.fn(),
}));

const studentId = "00000000-0000-4000-8000-000000000001";

function renderActions({
  historyRequesting = false,
  loading = false,
}: {
  historyRequesting?: boolean;
  loading?: boolean;
} = {}) {
  return renderHook(() =>
    useStudentWrongWordActions({
      cancelErrorMessage: "취소 실패",
      isHistoryRequesting: () => historyRequesting,
      loading,
      queueErrorMessage: "추가 실패",
      studentId,
      worksheetErrorMessage: "단어장 생성 실패",
    }),
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("student wrong word actions", () => {
  it("ignores invalid or unavailable requests before transport", async () => {
    const loadingActions = renderActions({ loading: true });

    await act(async () => {
      expect(await loadingActions.result.current.queueWords(["q-1"])).toBeNull();
      expect(await loadingActions.result.current.cancelDraft("draft-1")).toBeNull();
    });
    loadingActions.unmount();

    const actions = renderActions();
    await act(async () => {
      expect(await actions.result.current.queueWords([])).toBeNull();
      expect(await actions.result.current.cancelDraft("")).toBeNull();
      expect(await actions.result.current.requestWorksheet({
        curriculumStage: "undecided",
        questionIds: Array.from({ length: 51 }, (_, index) => `q-${index}`),
      })).toBeNull();
    });

    expect(queueStudentWrongWords).not.toHaveBeenCalled();
    expect(createStudentWorksheetRequest).not.toHaveBeenCalled();
    expect(cancelStudentReviewDraft).not.toHaveBeenCalled();
  });

  it("allows only one action while the first request is pending", async () => {
    let resolveQueue: ((value: { queueIds: string[] }) => void) | undefined;
    vi.mocked(queueStudentWrongWords).mockReturnValue(
      new Promise((resolve) => {
        resolveQueue = resolve;
      }),
    );
    const actions = renderActions();
    let firstRequest: Promise<string[] | null> | undefined;

    await act(async () => {
      firstRequest = actions.result.current.queueWords(["q-1"]);
      expect(await actions.result.current.requestWorksheet({
        curriculumStage: "undecided",
        questionIds: ["q-2"],
      })).toBeNull();
    });

    expect(queueStudentWrongWords).toHaveBeenCalledTimes(1);
    expect(createStudentWorksheetRequest).not.toHaveBeenCalled();
    expect(actions.result.current.queueing).toBe(true);

    await act(async () => {
      resolveQueue?.({ queueIds: ["queue-1"] });
      expect(await firstRequest).toEqual(["queue-1"]);
    });
    expect(actions.result.current.busy).toBe(false);
  });

  it("releases the action lock after an error", async () => {
    vi.mocked(queueStudentWrongWords)
      .mockResolvedValueOnce({ error: "서버 오류" })
      .mockResolvedValueOnce({ queueIds: ["queue-2"] });
    const actions = renderActions();

    await act(async () => {
      await expect(
        actions.result.current.queueWords(["q-1"]),
      ).rejects.toThrow("서버 오류");
    });
    expect(actions.result.current.busy).toBe(false);

    await act(async () => {
      expect(await actions.result.current.queueWords(["q-2"])).toEqual([
        "queue-2",
      ]);
    });
    expect(queueStudentWrongWords).toHaveBeenCalledTimes(2);
  });

  it("validates worksheet and draft responses before returning them", async () => {
    vi.mocked(createStudentWorksheetRequest).mockResolvedValue({
      request: { itemCount: 1, reused: false },
      sync: { status: "synced" },
    });
    vi.mocked(cancelStudentReviewDraft).mockResolvedValue({
      queueDisposition: "pending",
      status: "cancelled",
    });
    const actions = renderActions();

    await act(async () => {
      expect(await actions.result.current.requestWorksheet({
        curriculumStage: "yeongminjeongeum_basic",
        questionIds: ["q-1"],
      })).toEqual({
        request: { itemCount: 1, reused: false },
        sync: { status: "synced" },
      });
    });
    await act(async () => {
      expect(await actions.result.current.cancelDraft("draft-1")).toMatchObject({
        queueDisposition: "pending",
        status: "cancelled",
      });
    });
  });
});
