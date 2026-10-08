// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DirectoryCacheResponse } from "@/features/students/public-contracts";
import { StudentDirectoryCacheProvider } from "@/features/students/controller/student-directory-cache-provider";
import { emptyStudentDirectoryFilters } from "@/features/students/contracts/student-directory-read-model";
import { useAssignmentWorkspace } from "../controller/use-assignment-workspace";
import { CachedAssignmentWorkspace } from "./cached-assignment-workspace";

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn() }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: () => ["assignments"], usePathname: () => "/admin/assignments" }));
vi.mock("@/features/students/transport/student-directory-cache-read", () => ({ readStudentDirectoryCache: mocks.read }));
vi.mock("../transport/assignment-workspace-reads", () => ({
  loadAssignmentPlannerPreparation: mocks.prepare, loadAssignmentDirectorySelection: vi.fn(),
  loadAssignmentDatasetDirectory: vi.fn(), loadAssignmentDatasetUnits: vi.fn(),
}));
vi.mock("./assignment-workspace", () => ({
  pendingAssignmentDirectory: { filters: emptyStudentDirectoryFilters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] },
    snapshotAt: "pending", totalCount: 0, page: { items: [], nextCursor: null } },
  AssignmentWorkspace: (props: Parameters<typeof useAssignmentWorkspace>[0]) => {
    const workspace = useAssignmentWorkspace(props);
    return <p role="status">{workspace.planner.status}</p>;
  },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("직접 주소의 서버 화면을 인계한 뒤 같은 계정의 배정 준비를 한 번 완료한다", async () => {
  const userId = "00000000-0000-4000-8000-000000000999";
  const studentId = "00000000-0000-4000-8000-000000000001";
  const seed: Extract<DirectoryCacheResponse, { kind: "snapshot" }> = {
    kind: "snapshot", userId, identity: "a".repeat(64), snapshot: {
      filters: emptyStudentDirectoryFilters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] },
      snapshotAt: "2026-10-08T00:00:00Z", totalCount: 0, page: { items: [], nextCursor: null },
    },
  };
  mocks.prepare.mockResolvedValue({ datasets: [], initialUnits: [], initialDatasetId: "", timeTemplates: [], students: [] });
  const view = <StrictMode><StudentDirectoryCacheProvider userId={userId}>
    <CachedAssignmentWorkspace initialResponse={seed} initialDatasetId="" initialDialogView="assign" initialStudentId={studentId} />
  </StudentDirectoryCacheProvider></StrictMode>;
  const container = document.createElement("div");
  container.innerHTML = renderToString(view); document.body.append(container);
  const root = hydrateRoot(container, view);
  try {
    expect(await screen.findByText("ready")).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); container.remove(); }
});
