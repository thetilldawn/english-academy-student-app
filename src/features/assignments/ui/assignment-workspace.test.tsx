// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { StudentDirectorySnapshot } from "@/features/students/public-contracts";
import { assignmentQuestionModes } from "../domain/model";
import { AssignmentWorkspace } from "./assignment-workspace";

// Only the Next.js module loader and HTTP boundary are replaced. The student
// row, preparation controller, planner, range fields and picker are real.
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense } = await import("react");
  return { default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Loaded = lazy(async () => ({ default: await loader() }));
    return function DynamicComponent(props: Record<string, unknown>) {
      return <Suspense fallback={null}><Loaded {...props} /></Suspense>;
    };
  } };
});

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const datasets = ["로컬 형용사", "로컬 공통영어"].map((title, index) => ({
  ...cataloguedDatasetFromMetadata({ id: uid(index + 10), title }, undefined),
  availableQuestionModes: assignmentQuestionModes,
  rowCount: 20, status: "ready" as const, isActive: true,
}));
const students = [1, 2].map((n) => ({
  id: uid(n), displayName: `가짜 학생 ${n}`, schoolName: "검사 학교", gradeLabel: "고1",
  currentVocabBook: null, currentVocabDatasetId: null, status: "active" as const,
}));
const directory: StudentDirectorySnapshot = {
  filterOptions: { classGroups: [], grades: ["고1"], schools: ["검사 학교"], wordbooks: [] },
  filters: { classGroupId: "", grade: "", query: "", school: "", status: "active", wordbook: "", wrong: "all" },
  page: { items: students.map((item) => ({
    ...item, codeStatus: "active", completedCount: 0, missedCount: 0, notStartedCount: 0,
    rawPoints: 0, recentExamAt: null,
  })), nextCursor: null },
  snapshotAt: "2026-09-05T00:00:00.000Z", totalCount: 2,
};
const fetchMock = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value() { this.removeAttribute("open"); },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    let payload: unknown;
    if (input === "/api/admin/assignment-workspace/preparation") {
      const request = JSON.parse(String(init?.body)) as { studentIds: string[] };
      payload = { preparation: { datasets, initialDatasetId: "", initialUnits: [], timeTemplates: [],
        students: students.filter((student) => request.studentIds.includes(student.id)),
      } };
    } else if (input === "/api/admin/assignment-workspace/previous-exam") {
      payload = { previousExam: null };
    } else if (input.startsWith("/api/admin/assignment-workspace/datasets/") && input.endsWith("/units")) {
      const datasetId = input.split("/").at(-2)!;
      payload = { datasetId, units: [{
        id: uid(100), datasetId, label: "DAY 01", displayName: "DAY 01", entryCount: 20,
        kind: "day", number: 1, sortIndex: 1, catalogSortIndex: 1, catalogGroup: "high", unitType: "day",
        academicYear: null, agency: null, examMonth: null, itemRange: null,
      }] };
    } else {
      throw new Error(`Unexpected local-only request: ${input}`);
    }
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("실제 신규 배정 진입에서 단어장 검색까지", () => {
  it.each(["single", "bulk", "student-link"] as const)("%s 진입은 같은 검색과 준비된 유형으로 연결한다", async (entry) => {
    render(<AssignmentWorkspace
      initial={{ directory }}
      initialStudentId={entry === "student-link" ? students[0]!.id : ""}
      initialDialogView={entry === "student-link" ? "assign" : "overview"}
    />);
    if (entry === "single") {
      fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    } else if (entry === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "가짜 학생 1 일괄 배정 선택" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "가짜 학생 2 일괄 배정 선택" }));
      fireEvent.click(screen.getByRole("button", { name: "단어 배정" }));
    }
    // The real planner's first dynamic import includes Vite compilation. Allow
    // that test-only work under parallel build/test load, not an app delay.
    const trigger = await screen.findByRole("button", { name: /단어장 찾기/ }, { timeout: 5000 });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/단어장을 먼저 선택하면/)).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "영영풀이 → 영어" })).toBeDisabled();
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "단어장 검색" });
    fireEvent.change(search, { target: { value: "공통영어" } });
    expect(screen.getByText("검색 결과 1권")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /로컬 공통영어.*선택/ }));
    expect(screen.queryByRole("searchbox", { name: "단어장 검색" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /단어장 찾기/ })).toHaveTextContent("로컬 공통영어"));
    for (const name of ["영영풀이 → 영어", "예문 → 영어"]) {
      const tab = within(dialog).getByRole("tab", { name });
      expect(tab).toBeEnabled();
      fireEvent.click(tab);
      expect(tab).toHaveAttribute("aria-selected", "true");
    }
    expect(within(dialog).queryByText(/검토 중|Preview 전용/)).not.toBeInTheDocument();
    const preparations = fetchMock.mock.calls.filter(([url]) => url.endsWith("/preparation"));
    expect(preparations).toHaveLength(1);
    const request = JSON.parse(preparations[0]![1].body);
    expect(request.studentIds).toEqual(entry === "bulk" ? students.map((student) => student.id) : [students[0]!.id]);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith("/api/admin/assignment-workspace/"))).toBe(true);
  });
});
