import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
import { AdminHistoryCursorError } from "../admin-history-cursor";
import {
  listAdminHistoryInitial,
  listAdminHistoryNextPage,
} from "./admin-history-list-query";

const snapshotAt = "2026-08-29T00:00:00.000Z";

function rawItem(index: number) {
  const suffix = String(index).padStart(12, "0");
  return {
    _dataset: {
      catalog: null,
      edition: null,
      title: "테스트 단어장",
    },
    activityAt: snapshotAt,
    assignedAt: snapshotAt,
    assignmentId: `10000000-0000-4000-8000-${suffix}`,
    assignmentPurpose: "regular",
    assignmentTitle: `시험 ${index}`,
    attemptId: null,
    availableUntil: null,
    cancelledAt: null,
    completedAt: null,
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    finalScore: null,
    id: `assignment:10000000-0000-4000-8000-${suffix}:11111111-1111-4111-8111-111111111111`,
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
    studentId: "11111111-1111-4111-8111-111111111111",
    studentName: "테스트 학생",
    unitLabels: ["DAY 01"],
  };
}

function node(index: number) {
  return {
    effectiveAt: snapshotAt,
    entryKey: `assignment.10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    item: rawItem(index),
  };
}

function emptyInitialRow(groupKey: string) {
  return {
    group_key: groupKey,
    items: [],
    snapshot_at: snapshotAt,
    total_count: 0,
  };
}

describe("admin history list query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(undefined);
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("초기 11건 중 10건만 전달하고 같은 스냅샷 커서를 이어 쓴다", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            group_key: "open",
            items: Array.from({ length: 11 }, (_, index) => node(index + 1)),
            snapshot_at: snapshotAt,
            total_count: 21,
          },
          emptyInitialRow("needs_attention"),
          emptyInitialRow("completed"),
          emptyInitialRow("archived"),
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 11 }, (_, index) => ({
          cursor_effective_at: snapshotAt,
          cursor_entry_key: node(index + 11).entryKey,
          item: rawItem(index + 11),
        })),
        error: null,
      });

    const initial = await listAdminHistoryInitial({
      currentOnly: false,
      query: "  테스트   학생  ",
      statusFilter: "all",
    });
    const open = initial.sections[0]!;

    expect(open.items).toHaveLength(10);
    expect(open.totalCount).toBe(21);
    expect(open.nextCursor).toEqual(expect.any(String));
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "get_admin_history_initial_v1",
      {
        p_current_only: false,
        p_limit: 11,
        p_query: "테스트 학생",
        p_snapshot_at: null,
        p_status_filter: "all",
      },
    );

    const next = await listAdminHistoryNextPage({
      currentOnly: false,
      cursor: open.nextCursor!,
      groupKey: "open",
      query: "테스트 학생",
      statusFilter: "all",
    });

    expect(next.items).toHaveLength(10);
    expect(next.nextCursor).toEqual(expect.any(String));
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "list_admin_history_page_v1",
      expect.objectContaining({
        p_cursor_entry_key: node(10).entryKey,
        p_group_key: "open",
        p_limit: 11,
        p_query: "테스트 학생",
        p_snapshot_at: snapshotAt,
      }),
    );
  });

  it("응답 구역이 빠지거나 커서 조건이 바뀌면 DB 결과를 사용하지 않는다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [emptyInitialRow("open")],
      error: null,
    });
    await expect(listAdminHistoryInitial({ currentOnly: false }))
      .rejects.toMatchObject({ reason: "contract" });

    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          group_key: "open",
          items: Array.from({ length: 11 }, (_, index) => node(index + 1)),
          snapshot_at: snapshotAt,
          total_count: 11,
        },
        emptyInitialRow("needs_attention"),
        emptyInitialRow("completed"),
        emptyInitialRow("archived"),
      ],
      error: null,
    });
    const initial = await listAdminHistoryInitial({ currentOnly: false });
    const callsBeforeMismatch = mocks.rpc.mock.calls.length;

    await expect(listAdminHistoryNextPage({
      currentOnly: false,
      cursor: initial.sections[0]!.nextCursor!,
      groupKey: "open",
      query: "바뀐 검색",
      statusFilter: "all",
    })).rejects.toBeInstanceOf(AdminHistoryCursorError);
    expect(mocks.rpc).toHaveBeenCalledTimes(callsBeforeMismatch);
  });

  it("시간 제한 없는 DB 마감 값을 화면용 null로 바꾼다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          group_key: "open",
          items: [{
            ...node(1),
            item: { ...rawItem(1), deadlineAt: "infinity" },
          }],
          snapshot_at: snapshotAt,
          total_count: 1,
        },
        emptyInitialRow("needs_attention"),
        emptyInitialRow("completed"),
      ],
      error: null,
    });

    const snapshot = await listAdminHistoryInitial({ currentOnly: true });

    expect(snapshot.sections[0]?.items[0]?.deadlineAt).toBeNull();
  });
});
