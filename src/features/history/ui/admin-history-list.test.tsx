// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AdminHistoryListItem,
  AdminHistorySnapshot,
} from "@/features/history/contracts/admin-history-read-model";

import { AdminHistoryList } from "./admin-history-list";

const loadAdminHistorySnapshot = vi.fn();

vi.mock("@/features/history/transport/history-pages", () => ({
  loadAdminHistoryNextPage: vi.fn(),
  loadAdminHistorySnapshot: (...args: unknown[]) =>
    loadAdminHistorySnapshot(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function historyItem(id: string): AdminHistoryListItem {
  return {
    activityAt: "2026-08-08T00:00:00.000Z",
    assignedAt: "2026-08-08T00:00:00.000Z",
    assignmentId: "00000000-0000-4000-8000-000000000001",
    assignmentPurpose: "regular",
    assignmentTitle: id,
    attemptId: null,
    availableUntil: null,
    cancelledAt: null,
    completedAt: null,
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    finalScore: null,
    id,
    initialCompletedAt: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: null,
    primaryUnitLabels: ["DAY 01"],
    questionCount: 20,
    retryStartedAt: null,
    startedAt: null,
    status: "not_started",
    studentId: "00000000-0000-4000-8000-000000000002",
    studentName: id,
    unitLabels: ["DAY 01"],
  };
}

function snapshot(
  groups: Array<{ groupKey: string; items?: AdminHistoryListItem[] }>,
  options: Partial<Pick<
    AdminHistorySnapshot,
    "query" | "snapshotAt" | "statusFilter"
  >> = {},
): AdminHistorySnapshot {
  return {
    currentOnly: false,
    query: options.query ?? "",
    sections: groups.map((group) => ({
      groupKey: group.groupKey,
      items: group.items ?? [],
      nextCursor: null,
      totalCount: group.items?.length ?? 0,
    })),
    snapshotAt: options.snapshotAt ?? "2026-08-29T00:00:00.000Z",
    statusFilter: options.statusFilter ?? "all",
  };
}

describe("AdminHistoryList", () => {
  it("서버가 정한 상태 구역과 개수를 그대로 표시한다", () => {
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([
          { groupKey: "open", items: [historyItem("응시 전")] },
          { groupKey: "needs_attention", items: [historyItem("미통과")] },
          { groupKey: "completed", items: [historyItem("완료")] },
          { groupKey: "archived", items: [historyItem("취소")] },
        ])}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent),
    ).toEqual(["응시 전", "미응시 · 미통과", "완료", "취소 · 삭제"]);
    expect(screen.getAllByText("1건")).toHaveLength(4);
  });

  it("상태를 바꾸면 전체 배열을 거르지 않고 새 서버 묶음을 요청한다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot.mockResolvedValue(
      snapshot(
        [{ groupKey: "filter-retried", items: [historyItem("재시험 완료")] }],
        { statusFilter: "retried" },
      ),
    );
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([
          { groupKey: "open", items: [historyItem("응시 전")] },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ])}
        showFilters
      />,
    );

    await user.selectOptions(screen.getByLabelText("상태"), "retried");
    await waitFor(() => expect(loadAdminHistorySnapshot).toHaveBeenCalledWith(
      {
        currentOnly: false,
        mode: "initial",
        query: "",
        statusFilter: "retried",
      },
      expect.any(AbortSignal),
    ));
    expect(
      await screen.findByRole("heading", { level: 2, name: "재시험" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /재시험 완료.*상세/ }),
    ).toBeVisible();
  });

  it("검색 결과가 없으면 고정 높이 상태문 뒤에 빈 결과를 표시한다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot.mockResolvedValue(
      snapshot(
        [
          { groupKey: "open" },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ],
        { query: "없는 학생" },
      ),
    );
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([
          { groupKey: "open", items: [historyItem("응시 전")] },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ])}
        showFilters
      />,
    );

    await user.type(screen.getByLabelText("학생·시험 검색"), "없는 학생");
    expect(
      await screen.findByText("조건에 맞는 내역이 없습니다."),
    ).toBeVisible();
  });

  it("서버 새로고침으로 새 스냅샷이 오면 기존 구역 상태를 교체한다", async () => {
    const initial = snapshot(
      [
        { groupKey: "open", items: [historyItem("이전 시험")] },
        { groupKey: "needs_attention" },
        { groupKey: "completed" },
        { groupKey: "archived" },
      ],
      { snapshotAt: "2026-08-29T00:00:00.000Z" },
    );
    const refreshed = snapshot(
      [
        { groupKey: "open", items: [historyItem("새 시험")] },
        { groupKey: "needs_attention" },
        { groupKey: "completed" },
        { groupKey: "archived" },
      ],
      { snapshotAt: "2026-08-29T00:00:01.000Z" },
    );
    const { rerender } = render(
      <AdminHistoryList initialSnapshot={initial} />,
    );

    expect(screen.getByRole("link", { name: /이전 시험.*상세/ })).toBeVisible();
    rerender(<AdminHistoryList initialSnapshot={refreshed} />);

    expect(
      await screen.findByRole("link", { name: /새 시험.*상세/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /이전 시험.*상세/ }),
    ).not.toBeInTheDocument();
  });

  it("진행 중 검색을 취소하고 원래 조건으로 돌아오면 로딩을 끝낸다", async () => {
    const user = userEvent.setup();
    let requestSignal: AbortSignal | undefined;
    loadAdminHistorySnapshot.mockImplementation(
      (_request: unknown, signal: AbortSignal) => {
        requestSignal = signal;
        return new Promise(() => undefined);
      },
    );
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([
          { groupKey: "open", items: [historyItem("응시 전")] },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ])}
        showFilters
      />,
    );
    const search = screen.getByLabelText("학생·시험 검색");

    await user.type(search, "학생");
    expect(await screen.findByText("계산 중...")).toBeVisible();
    await user.clear(search);

    await waitFor(() => {
      expect(screen.queryByText("계산 중...")).not.toBeInTheDocument();
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("여러 공백을 정규화한 검색 결과는 한 번만 다시 요청한다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot.mockResolvedValue(
      snapshot(
        [
          { groupKey: "open", items: [historyItem("검색 결과")] },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ],
        {
          query: "테스트 학생",
          snapshotAt: "2026-08-29T00:00:02.000Z",
        },
      ),
    );
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([
          { groupKey: "open", items: [historyItem("응시 전")] },
          { groupKey: "needs_attention" },
          { groupKey: "completed" },
          { groupKey: "archived" },
        ])}
        showFilters
      />,
    );

    await user.type(
      screen.getByLabelText("학생·시험 검색"),
      "테스트   학생",
    );

    expect(
      await screen.findByRole("link", { name: /검색 결과.*상세/ }),
    ).toBeVisible();
    await waitFor(() => expect(loadAdminHistorySnapshot).toHaveBeenCalledTimes(1));
  });

  it("서버 새로고침 뒤에도 사용자가 선택한 상태 필터를 유지한다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot
      .mockResolvedValueOnce(
        snapshot(
          [{ groupKey: "filter-retried", items: [historyItem("filtered-old")] }],
          {
            snapshotAt: "2026-08-29T00:00:01.000Z",
            statusFilter: "retried",
          },
        ),
      )
      .mockResolvedValueOnce(
        snapshot(
          [{ groupKey: "filter-retried", items: [historyItem("filtered-new")] }],
          {
            snapshotAt: "2026-08-29T00:00:03.000Z",
            statusFilter: "retried",
          },
        ),
      );
    const initial = snapshot(
      [{ groupKey: "open", items: [historyItem("initial-item")] }],
      { snapshotAt: "2026-08-29T00:00:00.000Z" },
    );
    const refreshed = snapshot(
      [{ groupKey: "open", items: [historyItem("refreshed-item")] }],
      { snapshotAt: "2026-08-29T00:00:02.000Z" },
    );
    const { rerender } = render(
      <AdminHistoryList initialSnapshot={initial} showFilters />,
    );

    await user.selectOptions(screen.getByRole("combobox"), "retried");
    expect(
      await screen.findByRole("link", { name: /filtered-old.*상세/ }),
    ).toBeVisible();

    rerender(
      <AdminHistoryList initialSnapshot={refreshed} showFilters />,
    );

    expect(screen.getByRole("combobox")).toHaveValue("retried");
    expect(
      await screen.findByRole("link", { name: /filtered-new.*상세/ }),
    ).toBeVisible();
    await waitFor(() => expect(loadAdminHistorySnapshot).toHaveBeenCalledTimes(2));
  });

  it("조회 실패 뒤 같은 조건으로 다시 시도할 수 있다", async () => {
    const user = userEvent.setup();
    loadAdminHistorySnapshot
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(
        snapshot(
          [{ groupKey: "filter-retried", items: [historyItem("retry-result")] }],
          {
            snapshotAt: "2026-08-29T00:00:01.000Z",
            statusFilter: "retried",
          },
        ),
      );
    render(
      <AdminHistoryList
        initialSnapshot={snapshot([{ groupKey: "open" }])}
        showFilters
      />,
    );

    await user.selectOptions(screen.getByRole("combobox"), "retried");
    expect(await screen.findByText("temporary failure")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByRole("link", { name: /retry-result.*상세/ }),
    ).toBeVisible();
    await waitFor(() => expect(loadAdminHistorySnapshot).toHaveBeenCalledTimes(2));
  });
});
