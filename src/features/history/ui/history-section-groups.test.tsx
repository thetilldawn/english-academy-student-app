// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";

import { HistorySectionGroups } from "./history-section-groups";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";

const loadAdminHistoryNextPage = vi.fn();
const loadAdminHistoryFreshSection = vi.fn();
const loadAdminHistorySnapshot = vi.fn();

vi.mock("@/features/history/transport/history-pages", () => ({
  loadAdminHistorySnapshot: (...args: unknown[]) => loadAdminHistorySnapshot(...args),
  loadAdminHistoryNextPage: (...args: unknown[]) =>
    loadAdminHistoryNextPage(...args),
  loadAdminHistoryFreshSection: (...args: unknown[]) =>
    loadAdminHistoryFreshSection(...args),
}));

vi.mock("./history-rows", () => ({
  HistoryRows: ({ items }: { items: AdminHistoryListItem[] }) => (
    <ul>
      {items.map((item) => <li key={item.id}>{item.id}</li>)}
    </ul>
  ),
}));

function historyItems(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
  })) as AdminHistoryListItem[];
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("HistorySectionGroups", () => {
  it.each(["unauthenticated", "forbidden"] as const)("공유 첫 조회 %s는 모든 구역과 개수를 숨긴다", async kind => {
    loadAdminHistorySnapshot.mockRejectedValueOnce(new AdminHistoryRequestError(kind));
    const keys = ["open", "needs_attention", "completed"];
    render(<HistorySectionGroups countSuffix="건" loadMoreContext={{ currentOnly: true, query: "", statusFilter: "all" }}
      sections={keys.map(groupKey => ({ defaultOpen: true, groupKey, items: historyItems(groupKey, 1), nextCursor: "old-cursor", title: groupKey, totalCount: 11 }))} />);
    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", { detail: {
      before: {}, after: null, receipt: { kind: "hidden", assignmentId: "fake", version: "2026-09-06T00:00:02.000Z" },
    } })));
    await screen.findByRole("link", { name: "관리자 로그인" });
    expect(loadAdminHistorySnapshot).toHaveBeenCalledTimes(1);
    for(const key of keys) expect(screen.queryByText(key+"-1")).not.toBeInTheDocument();
    expect(screen.queryByText("11건")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10개 더보기" })).not.toBeInTheDocument();
  });
  it("현재 개요 세 구역의 같은 숨김 영수증은 처음 목록을 한 번만 읽는다", async () => {
    const keys = ["open", "needs_attention", "completed"];
    loadAdminHistorySnapshot.mockResolvedValue({ currentOnly: true, query: "", statusFilter: "all",
      snapshotAt: "2026-09-06T00:00:03.000Z", sections: keys.map(groupKey => ({ groupKey, items: [], nextCursor: null, totalCount: 0 })) });
    render(<HistorySectionGroups countSuffix="건" loadMoreContext={{ currentOnly: true, query: "", statusFilter: "all" }}
      sections={keys.map(groupKey => ({ defaultOpen: true, groupKey, items: historyItems(groupKey, 1), nextCursor: "old-cursor", title: groupKey, totalCount: 11 }))} />);
    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", { detail: {
      before: {}, after: null, receipt: { kind: "hidden", assignmentId: "fake", version: "2026-09-06T00:00:02.000Z" },
    } })));
    await waitFor(() => expect(screen.getAllByText("0건")).toHaveLength(3));
    expect(loadAdminHistorySnapshot).toHaveBeenCalledTimes(1);
    expect(loadAdminHistoryFreshSection).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "10개 더보기" })).not.toBeInTheDocument();
    for(const key of keys) expect(screen.queryByText(key+"-1")).not.toBeInTheDocument();
  });

  it("개요 인증 실패는 같은 서버 자료에서 유지하고 인증된 새 자료에서만 해제한다", async () => {
    const user = userEvent.setup();
    loadAdminHistoryNextPage.mockRejectedValueOnce(new AdminHistoryRequestError("unauthenticated"));
    const sections = [{ groupKey: "open", items: historyItems("private", 1), nextCursor: "cursor", title: "응시 전", totalCount: 2 }];
    const context = { currentOnly: true, query: "", statusFilter: "all" } as const;
    const { rerender } = render(<HistorySectionGroups countSuffix="건" revision="old-server-read" sections={sections} loadMoreContext={context} />);
    await user.click(screen.getByRole("button", { name: "10개 더보기" }));
    await screen.findByRole("link", { name: "관리자 로그인" });
    rerender(<HistorySectionGroups countSuffix="건" revision="old-server-read" sections={sections} loadMoreContext={context} />);
    expect(screen.queryByText("private-1")).not.toBeInTheDocument();
    rerender(<HistorySectionGroups countSuffix="건" revision="new-authenticated-read" sections={sections} loadMoreContext={context} />);
    expect(screen.queryByRole("link", { name: "관리자 로그인" })).not.toBeInTheDocument();
    expect(screen.getByText("private-1")).toBeVisible();
  });

  it("더보기 실패는 쉬운 안내와 재시도로 복구하고 오류 원문을 표시하지 않는다", async () => {
    const user = userEvent.setup();
    loadAdminHistoryNextPage.mockRejectedValueOnce(new TypeError("Failed to fetch private detail"))
      .mockResolvedValueOnce({ items: historyItems("more", 1), nextCursor: null });
    render(<HistorySectionGroups countSuffix="건" loadMoreContext={{ currentOnly: false, query: "", statusFilter: "all" }}
      sections={[{ groupKey: "open", items: historyItems("old", 1), nextCursor: "cursor", title: "응시 전", totalCount: 2 }]} />);
    await user.click(screen.getByRole("button", { name: "10개 더보기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("시험 내역을 불러오지 못했습니다. 다시 시도해 주세요.");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByText(/없습니다/)).not.toBeInTheDocument();
    expect(screen.getByText("old-1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("more-1")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["unauthenticated", "forbidden"] as const)("더보기 %s면 다른 구역까지 개인 내역과 개수를 숨긴다", async (kind) => {
    const user = userEvent.setup();
    loadAdminHistoryNextPage.mockRejectedValueOnce(new AdminHistoryRequestError(kind));
    render(<HistorySectionGroups countSuffix="건" loadMoreContext={{ currentOnly: false, query: "", statusFilter: "all" }}
      sections={[
        { groupKey: "open", items: historyItems("private-open", 1), nextCursor: "cursor", title: "응시 전", totalCount: 2 },
        { groupKey: "completed", items: historyItems("private-completed", 1), nextCursor: null, title: "완료", totalCount: 1 },
      ]} />);
    await user.click(screen.getByRole("button", { name: "10개 더보기" }));
    expect(await screen.findByRole("link", { name: "관리자 로그인" })).toHaveAttribute("href", "/admin/login");
    expect(screen.queryByText("private-open-1")).not.toBeInTheDocument();
    expect(screen.queryByText("private-completed-1")).not.toBeInTheDocument();
    expect(screen.queryByText("2건")).not.toBeInTheDocument();
  });

  it("빈 구역 변경 후 조회 실패와 실제 성공 0건을 구분한다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot.mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce({ snapshotAt: "2026-08-31T00:00:03.000Z", sections: [{ groupKey: "completed", items: [], nextCursor: null, totalCount: 0 }] });
    render(<HistorySectionGroups countSuffix="건" loadMoreContext={{ currentOnly: false, query: "", statusFilter: "all" }}
      sections={[{ defaultOpen: true, groupKey: "completed", items: [], nextCursor: null, title: "완료", totalCount: 0 }]} />);
    expect(screen.getByText("이 구역에 내역이 없습니다.")).toBeVisible();
    act(() => window.dispatchEvent(new CustomEvent("admin-history:mutated", { detail: {
      after: null,
      before: { activityAt: "2026-08-31T00:00:00.000Z", assignedAt: "2026-08-31T00:00:00.000Z",
        assignmentId: "00000000-0000-4000-8000-000000000010", completedAt: "2026-08-31T00:00:00.000Z",
        id: "hidden", passingScore: 80, passed: true, finalScore: 100, status: "completed",
        studentId: "00000000-0000-4000-8000-000000000020" },
      receipt: { assignmentId: "00000000-0000-4000-8000-000000000010",
        attemptId: "00000000-0000-4000-8000-000000000030", kind: "hidden",
        studentId: "00000000-0000-4000-8000-000000000020", version: "2026-08-31T00:00:02.000Z" },
    } })));
    await screen.findByRole("alert");
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    expect(screen.queryByText("이 구역에 내역이 없습니다.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("이 구역에 내역이 없습니다.")).toBeVisible();
    expect(screen.getByText("0건")).toBeVisible();
  });
  it("서버가 준 첫 10건과 전체 개수를 구역별로 표시한다", () => {
    render(
      <HistorySectionGroups
        countSuffix="건"
        sections={[
          {
            groupKey: "open",
            items: historyItems("open", 10),
            nextCursor: "next-open",
            title: "응시 전",
            totalCount: 11,
          },
          {
            groupKey: "completed",
            items: historyItems("done", 2),
            nextCursor: null,
            title: "완료",
            totalCount: 2,
          },
        ]}
      />,
    );

    expect(screen.getByText("11건")).toBeVisible();
    expect(screen.getByText("2건")).toBeVisible();
    expect(screen.getByText("open-10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10개 더보기" })).toBeVisible();
  });

  it("더보기는 해당 구역의 커서만 요청하고 중복 없이 붙인다", async () => {
    const user = userEvent.setup();
    loadAdminHistoryNextPage.mockResolvedValue({
      items: [
        ...historyItems("open", 1),
        ...historyItems("more", 2),
      ],
      nextCursor: null,
    });
    render(
      <HistorySectionGroups
        countSuffix="건"
        loadMoreContext={{
          currentOnly: false,
          query: "학생",
          statusFilter: "all",
        }}
        sections={[
          {
            groupKey: "open",
            items: historyItems("open", 1),
            nextCursor: "next-open",
            title: "응시 전",
            totalCount: 3,
          },
        ]}
      />,
    );

    const panel = screen.getByRole("region", { name: "응시 전" });
    await user.click(within(panel).getByRole("button", { name: "10개 더보기" }));
    expect(loadAdminHistoryNextPage).toHaveBeenCalledWith(
      {
        currentOnly: false,
        cursor: "next-open",
        groupKey: "open",
        mode: "page",
        query: "학생",
        statusFilter: "all",
      },
      expect.any(AbortSignal),
    );
    expect(screen.getAllByText("open-1")).toHaveLength(1);
    expect(screen.getByText("more-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10개 더보기" }))
      .not.toBeInTheDocument();
  });

  it("0건 구역도 개수와 접기 버튼을 유지한다", () => {
    render(
      <HistorySectionGroups
        countSuffix="건"
        sections={[
          {
            groupKey: "completed",
            items: [],
            nextCursor: null,
            title: "완료",
            totalCount: 0,
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "완료" })).toBeVisible();
    expect(screen.getByText("0건")).toBeVisible();
  });
});
