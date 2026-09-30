/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeHistory } from "./practice-history";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/components/document-navigation", () => ({ navigateDocument: navigation.replace }));
const item = { id: "00000000-0000-4000-8000-000000000001", startedAt: "2026-09-30T00:00:00Z", finishedAt: null,
  questionCount: 7, correctCount: 0, status: "in_progress" as const };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("연습 내역 계정 경계", () => {
  it.each([401, 403, 409])("%s면 옛 내역과 커서를 즉시 폐기하고 문서 이동한다", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status })); vi.stubGlobal("fetch", fetcher);
    render(<PracticeHistory initial={{ items: [item], nextCursor: "previous-account" }} />);
    expect(screen.getByText("7문항 · 진행 중")).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "10개 더보기" })); });
    expect(screen.queryByText("7문항 · 진행 중")).toBeNull();
    expect(screen.queryByRole("button", { name: "10개 더보기" })).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith(status === 409 ? "/student/practice" : "/", true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("일시 장애는 기존 내역을 보존하고 같은 커서로 재시도한다", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [item], nextCursor: null })); vi.stubGlobal("fetch", fetcher);
    render(<PracticeHistory initial={{ items: [item], nextCursor: "same-page" }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "10개 더보기" })); });
    expect(screen.getByText("7문항 · 진행 중")).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 시도" })); });
    expect(fetcher.mock.calls[0][0]).toEqual(fetcher.mock.calls[1][0]);
    expect(screen.getAllByText("7문항 · 진행 중")).toHaveLength(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
