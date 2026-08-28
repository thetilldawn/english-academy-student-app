// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";

import { HistorySectionGroups } from "./history-section-groups";

const loadAdminHistoryNextPage = vi.fn();

vi.mock("@/features/history/transport/history-pages", () => ({
  loadAdminHistoryNextPage: (...args: unknown[]) =>
    loadAdminHistoryNextPage(...args),
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
  vi.clearAllMocks();
});

describe("HistorySectionGroups", () => {
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
