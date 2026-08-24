// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { HistorySectionGroups } from "./history-section-groups";

vi.mock("./history-rows", () => ({
  HistoryRows: ({ items }: { items: AssignmentHistorySummary[] }) => (
    <ul>
      {items.map((item) => <li key={item.id}>{item.id}</li>)}
    </ul>
  ),
}));

function historyItems(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
  })) as AssignmentHistorySummary[];
}

afterEach(cleanup);

describe("HistorySectionGroups", () => {
  it("모든 상태 그룹을 렌더링하고 그룹마다 처음 10개씩 표시한다", () => {
    render(
      <HistorySectionGroups
        countSuffix="개"
        sections={[
          { id: "open", title: "응시 전", items: historyItems("open", 11) },
          { id: "completed", title: "완료", items: historyItems("done", 2) },
          { id: "missed", title: "미응시", items: historyItems("missed", 1) },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "응시 전" })).toBeVisible();
    expect(screen.getByRole("button", { name: "완료" })).toBeVisible();
    expect(screen.getByRole("button", { name: "미응시" })).toBeVisible();
    expect(screen.getByText("11개")).toBeVisible();
    expect(screen.getByText("2개")).toBeVisible();
    expect(screen.getByText("1개")).toBeVisible();
    expect(screen.getByText("open-10")).toBeInTheDocument();
    expect(screen.queryByText("open-11")).not.toBeInTheDocument();
    expect(screen.getByText("done-2")).toBeInTheDocument();
    expect(screen.getByText("missed-1")).toBeInTheDocument();
  });

  it("더보기는 해당 열린 그룹 안에서만 10개씩 늘어난다", () => {
    render(
      <HistorySectionGroups
        countSuffix="개"
        sections={[
          { id: "open", title: "응시 전", items: historyItems("open", 21) },
          { id: "completed", title: "완료", items: historyItems("done", 12) },
        ]}
      />,
    );

    const openPanel = screen.getByRole("region", { name: "응시 전" });
    const completedPanel = document.getElementById("history-completed-panel");
    expect(openPanel).toHaveAttribute("aria-hidden", "false");
    expect(completedPanel).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(within(openPanel).getByRole("button", { name: "10개 더보기" }));
    expect(screen.getByText("open-20")).toBeInTheDocument();
    expect(screen.queryByText("open-21")).not.toBeInTheDocument();
    expect(screen.queryByText("done-11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "응시 전" }));
    expect(openPanel).toHaveAttribute("aria-hidden", "true");
  });

  it("항목이 0개인 상태도 개수와 함께 유지한다", () => {
    render(
      <HistorySectionGroups
        countSuffix="개"
        sections={[
          { id: "open", title: "응시 전", items: historyItems("open", 1) },
          { id: "completed", title: "완료", items: [] },
          { id: "missed", title: "미응시", items: [] },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "완료" })).toBeVisible();
    expect(screen.getByRole("button", { name: "미응시" })).toBeVisible();
    expect(screen.getAllByText("0개")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "10개 더보기" }))
      .not.toBeInTheDocument();
  });
});
