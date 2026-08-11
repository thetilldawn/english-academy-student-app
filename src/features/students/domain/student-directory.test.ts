import { describe, expect, it } from "vitest";

import { indexStudentCurrentVocabWrongSummaries } from "@/lib/admin/wrong-history-summary";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentSummary } from "@/lib/services/admin-service";

import {
  filterAndSortStudents,
  indexStudentLearningSources,
  studentDirectoryFilterOptions,
} from "./student-directory";

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

function source(
  studentId: string,
  displayLabel: string,
): StudentLearningSourceItem {
  return {
    displayLabel,
    id: `source-${studentId}`,
    rangeMetadata: {},
    sortOrder: 0,
    sourceType: "exam_vocab",
    studentId,
    vocabDatasetId: "dataset-1",
  };
}

describe("student directory domain", () => {
  const students = [
    student("3", "하늘"),
    student("1", "가람"),
    student("2", "나래"),
  ];
  const longWordbook = "[2025] 고3 모의고사 · 매우 긴 장문독해 단어장 ".repeat(8);
  const sources = [source("1", longWordbook)];
  const base = {
    activitiesByStudent: new Map(),
    currentWrongIndex: indexStudentCurrentVocabWrongSummaries([]),
    learningSourcesByStudent: indexStudentLearningSources(sources),
    students,
  };

  it("returns zero, one, and many students without inventing placeholder rows", () => {
    expect(
      filterAndSortStudents({
        ...base,
        filters: {
          grade: "",
          query: "없는 학생",
          school: "",
          wordbook: "",
          wrong: "all",
        },
      }),
    ).toEqual([]);
    expect(
      filterAndSortStudents({
        ...base,
        filters: {
          grade: "",
          query: "나래",
          school: "",
          wordbook: "",
          wrong: "all",
        },
      }).map((item) => item.displayName),
    ).toEqual(["나래"]);
    expect(
      filterAndSortStudents({
        ...base,
        filters: {
          grade: "",
          query: "",
          school: "",
          wordbook: "",
          wrong: "all",
        },
      }).map((item) => item.displayName),
    ).toEqual(["가람", "나래", "하늘"]);
  });

  it("searches and filters the full long learning-source label", () => {
    const options = studentDirectoryFilterOptions(students, sources);
    expect(options.wordbooks).toContain(longWordbook);
    expect(
      filterAndSortStudents({
        ...base,
        filters: {
          grade: "",
          query: "매우 긴 장문독해",
          school: "",
          wordbook: longWordbook,
          wrong: "all",
        },
      }).map((item) => item.id),
    ).toEqual(["1"]);
  });

  it("uses the current wrong summary for repeated-wrong filtering", () => {
    expect(
      filterAndSortStudents({
        ...base,
        currentWrongIndex: indexStudentCurrentVocabWrongSummaries([
          {
            datasetId: "dataset-1",
            repeatedWrongWordCount: 2,
            studentId: "2",
            wrongWordCount: 4,
          },
        ]),
        filters: {
          grade: "",
          query: "",
          school: "",
          wordbook: "",
          wrong: "repeated",
        },
      }).map((item) => item.id),
    ).toEqual(["2"]);
  });
});
