/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminStudentsText } from "@/content/ko/admin-students";
import type { StudentSummary } from "@/lib/services/admin-service";

import type { StudentDetailController } from "../controller/use-student-detail-controller";
import type { StudentManagementData } from "../model";
import { StudentDirectory } from "./student-directory";

afterEach(cleanup);

function student(id: string, displayName: string): StudentSummary {
  return {
    codeGeneration: 1,
    codeStatus: "active",
    createdAt: "2026-08-11T00:00:00.000Z",
    currentVocabBook: "[2025] 고3 모의고사 · 장문독해",
    currentVocabDatasetId: "dataset-1",
    displayName,
    gradeLabel: "고3",
    id,
    readingContextSyncStatus: "not_configured",
    readingCurriculumStage: "undecided",
    schoolName: "미리보기고",
    status: "active",
  };
}

function data(students: StudentSummary[]): StudentManagementData {
  return {
    appOrigin: "http://localhost:3000",
  assignmentDatasets: [],
    assignmentUnits: [],
    currentHistory: [],
    currentVocabWrongSummaries: [],
    datasets: [],
    history: [],
    learningSources: [],
    pendingReviewSummaries: [],
    progress: [],
    students,
    vocabBookHistory: [],
  };
}

function controller(openStudent = vi.fn()) {
  return {
    actions: {
      createFromForm: vi.fn(),
      openStudent,
    },
    busyKey: "",
    createError: "",
    interactionBusy: false,
  } as unknown as StudentDetailController;
}

describe("StudentDirectory", () => {
  it("renders the explicit empty result instead of a placeholder card", () => {
    render(<StudentDirectory controller={controller()} data={data([])} />);
    expect(screen.getByText(adminStudentsText.page.noMatches)).toBeVisible();
  });

  it("renders one long student name and opens that exact student", async () => {
    const user = userEvent.setup();
    const openStudent = vi.fn();
    const longName = "아주 긴 이름을 가진 학생 ".repeat(10).trim();
    const item = student("student-1", longName);

    render(
      <StudentDirectory
        controller={controller(openStudent)}
        data={data([item])}
      />,
    );
    await user.click(screen.getByRole("button", { name: new RegExp(longName) }));
    expect(openStudent).toHaveBeenCalledWith(item);
  });

  it("renders every student once for an N-item directory", () => {
    const students = [
      student("student-3", "하늘"),
      student("student-1", "가람"),
      student("student-2", "나래"),
    ];
    render(
      <StudentDirectory controller={controller()} data={data(students)} />,
    );

    for (const item of students) {
      expect(screen.getByText(item.displayName)).toBeVisible();
    }
    expect(screen.getAllByText(adminStudentsText.card.noHistory)).toHaveLength(3);
  });

  it("shows the current wordbook, recent exam, and three counts on the card", () => {
    render(
      <StudentDirectory
        controller={controller()}
        data={data([student("student-summary", "요약 학생")])}
      />,
    );

    const card = screen.getByRole("button", { name: /요약 학생/ });
    expect(within(card).getByText("현재 단어장")).toBeVisible();
    expect(within(card).getByText("최근 시험")).toBeVisible();
    expect(within(card).getByText("완료 0개")).toBeVisible();
    expect(within(card).getByText("미응시 0개")).toBeVisible();
    expect(within(card).getByText("응시 전 0개")).toBeVisible();
  });

  it("clears a search independently from detailed filters", async () => {
    const user = userEvent.setup();
    const students = [
      student("student-1", "가람"),
      student("student-2", "나래"),
    ];
    render(
      <StudentDirectory controller={controller()} data={data(students)} />,
    );

    await user.type(
      screen.getByRole("searchbox", {
        name: adminStudentsText.page.searchAriaLabel,
      }),
      "가람",
    );
    expect(screen.getByText("가람")).toBeVisible();
    expect(screen.queryByText("나래")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "검색 지우기" }));
    expect(screen.getByText("가람")).toBeVisible();
    expect(screen.getByText("나래")).toBeVisible();
  });
});
