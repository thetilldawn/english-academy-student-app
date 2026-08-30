/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { learningPointsText } from "@/content/ko/learning-points";

import type { StudentDetailProfile } from "../../contracts/student-detail-read-model";
import type { StudentProfileController } from "../../controller/use-student-profile-controller";
import { StudentInfoPanel } from "./student-info-panel";

const student: StudentDetailProfile = {
  codeStatus: "active",
  createdAt: "2026-08-25T00:00:00.000Z",
  currentVocabBook: null,
  currentVocabDatasetId: null,
  displayName: "선택 학생",
  gradeLabel: "고3",
  id: "00000000-0000-4000-8000-000000000001",
  rawPoints: 7,
  readingContextSyncStatus: "not_configured",
  readingCurriculumStage: "undecided",
  schoolName: "미리보기고",
  status: "active",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("StudentInfoPanel", () => {
  it("shows the selected student's raw balance through the visible point formatter", () => {
    const controller = {
      actions: { save: vi.fn(), setField: vi.fn() },
      busy: false,
      draft: {
        displayName: student.displayName,
        gradeLabel: student.gradeLabel ?? "",
        schoolName: student.schoolName ?? "",
      },
      unchanged: true,
    } as StudentProfileController;

    render(
      <StudentInfoPanel
        controller={controller}
        learningSources={[]}
        student={student}
        vocabBookHistory={[]}
      />,
    );

    expect(screen.getByLabelText(learningPointsText.current)).toHaveTextContent("7");
  });
});
