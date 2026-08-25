/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StudentSummary } from "@/lib/admin/student-summary";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
import { StudentInfoPanel } from "./student-info-panel";

const selectedStudent: StudentSummary = {
  codeGeneration: 1,
  codeStatus: "active",
  createdAt: "2026-08-25T00:00:00.000Z",
  currentVocabBook: null,
  currentVocabDatasetId: null,
  displayName: "선택 학생",
  gradeLabel: "고2",
  id: "student-a",
  readingContextSyncStatus: "not_configured",
  readingCurriculumStage: "undecided",
  schoolName: "미리보기고",
  status: "active",
};

describe("StudentInfoPanel", () => {
  it("shows only the selected student's mapped point balance", () => {
    const controller = {
      actions: {
        saveProfile: vi.fn(),
        setProfileField: vi.fn(),
      },
      busyKey: "",
      interactionBusy: false,
      profile: {
        datasetId: "",
        displayName: selectedStudent.displayName,
        gradeLabel: selectedStudent.gradeLabel,
        schoolName: selectedStudent.schoolName,
      },
      selectedStudent,
    } as unknown as StudentDetailController;
    const data = {
      datasets: [],
      pointBalances: { "student-a": 7, "student-b": 29 },
      vocabBookHistory: [],
    } as unknown as StudentManagementData;

    render(<StudentInfoPanel controller={controller} data={data} />);

    expect(screen.getByLabelText("현재 포인트")).toHaveTextContent("7");
    expect(screen.getByLabelText("현재 포인트")).not.toHaveTextContent("29");
  });
});
