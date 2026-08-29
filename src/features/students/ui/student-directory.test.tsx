/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { adminStudentsText } from "@/content/ko/admin-students";

import {
  emptyStudentDirectoryFilters,
  type StudentDirectoryListItem,
  type StudentDirectorySnapshot,
} from "../contracts/student-directory-read-model";
import { StudentDirectory } from "./student-directory";

afterEach(cleanup);

function item(index: number, displayName: string): StudentDirectoryListItem {
  return {
    codeStatus: "active",
    completedCount: index,
    currentVocabBook: "[2025] 고3 모의고사 · 장문독해",
    displayName,
    gradeLabel: "고3",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    missedCount: index + 1,
    notStartedCount: index + 2,
    rawPoints: index === 1 ? -3 : index + 7,
    recentExamAt: null,
    schoolName: "미리보기고",
    status: "active",
  };
}

function snapshot(
  items: StudentDirectoryListItem[],
): StudentDirectorySnapshot {
  return {
    filterOptions: {
      classGroups: [],
      grades: ["고3"],
      schools: ["미리보기고"],
      wordbooks: ["[2025] 고3 모의고사 · 장문독해"],
    },
    filters: emptyStudentDirectoryFilters,
    page: { items, nextCursor: null },
    snapshotAt: "2026-08-29T00:00:00.000Z",
    totalCount: items.length,
  };
}

describe("StudentDirectory", () => {
  it("빈 결과를 명시한다", () => {
    render(<StudentDirectory initialSnapshot={snapshot([])} />);
    expect(screen.getByText(adminStudentsText.page.noMatches)).toBeVisible();
  });

  it("학생 카드를 ID 상세 경로 링크로 렌더한다", () => {
    const student = item(1, "아주 긴 이름을 가진 가짜 학생");
    render(<StudentDirectory initialSnapshot={snapshot([student])} />);
    const link = screen.getByRole("link", { name: /아주 긴 이름/ });
    expect(link).toHaveAttribute("href", `/admin/students/${student.id}`);
  });

  it("현재 단어장·최근 시험·세 개수와 화면 포인트를 표시한다", () => {
    render(<StudentDirectory initialSnapshot={snapshot([item(1, "요약 학생")])} />);
    const card = screen.getByRole("link", { name: /요약 학생/ });
    expect(within(card).getByText("현재 단어장")).toBeVisible();
    expect(within(card).getByText("최근 시험")).toBeVisible();
    expect(within(card).getByText("완료 1개")).toBeVisible();
    expect(within(card).getByText("미응시 2개")).toBeVisible();
    expect(within(card).getByText("응시 전 3개")).toBeVisible();
    expect(within(card).getByText("현재 포인트 0")).toBeVisible();
  });

  it("첫 응답에 있는 학생만 한 번씩 표시한다", () => {
    const students = [item(1, "가람"), item(2, "나래"), item(3, "하늘")];
    render(<StudentDirectory initialSnapshot={snapshot(students)} />);
    for (const student of students) {
      expect(screen.getByText(student.displayName)).toBeVisible();
    }
    expect(screen.getAllByText(adminStudentsText.card.noHistory)).toHaveLength(3);
  });
});
