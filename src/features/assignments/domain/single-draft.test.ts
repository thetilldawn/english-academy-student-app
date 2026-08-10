import { describe, expect, it } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import type { SingleAssignmentDraft } from "./model";
import {
  reduceSingleAssignmentDraft,
  resolveSingleAssignmentDraft,
} from "./single-draft";

const automaticDraft: SingleAssignmentDraft = {
  kind: "single",
  operation: { mode: "create" },
  studentId: assignmentContractIds.studentA,
  title: { mode: "automatic" },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [assignmentContractIds.day60],
  },
  questionCount: { mode: "automatic", value: 20 },
  exam: {
    directionRatio: 50,
    questionOrderMode: "random",
    passingScore: 80,
    timing: { mode: "total", totalSeconds: 300 },
  },
  deadline: { mode: "none" },
  review: { mode: "none", scope: "dataset", levels: [1, 2] },
};

const exactReviewDraft: SingleAssignmentDraft = {
  ...automaticDraft,
  operation: {
    mode: "replace",
    assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    targetStudentId: assignmentContractIds.studentA,
    sourcePurpose: "review",
    lockedShape: {
      datasetId: assignmentContractIds.dataset,
      orderedUnitIds: [assignmentContractIds.day60],
      questionCount: 1,
      reviewLevels: [2],
    },
  },
  title: { mode: "source", value: "기존 오답 재시험" },
  questionCount: { mode: "manual", value: 1 },
  review: { mode: "pending", scope: "dataset", levels: [2] },
};

describe("single assignment draft reducer", () => {
  it("uses a server title sentinel for automatic creation while keeping a display title", () => {
    expect(
      resolveSingleAssignmentDraft(automaticDraft, {
        title: "DAY 60 시험",
      }),
    ).toStrictEqual({
      displayTitle: "DAY 60 시험",
      submissionTitle: "",
      questionCount: 20,
    });
  });

  it("reconciles automatic counts from capacity without changing the choice mode", () => {
    const reconciled = reduceSingleAssignmentDraft(automaticDraft, {
      type: "capacity/reconciled",
      minimumQuestionCount: 4,
      maximumQuestionCount: 40,
      recommendedQuestionCount: 35,
      minimumAllowedQuestionCount: 4,
    });

    expect(reconciled.questionCount).toStrictEqual({
      mode: "automatic",
      value: 35,
    });
    expect(
      resolveSingleAssignmentDraft(reconciled, { title: "DAY 60 시험" }),
    ).toMatchObject({ questionCount: 35 });
  });

  it("preserves a custom title and clamps a manual count to a smaller capacity", () => {
    let draft = reduceSingleAssignmentDraft(automaticDraft, {
      type: "title/changed",
      value: "직접 정한 제목",
    });
    draft = reduceSingleAssignmentDraft(draft, {
      type: "questionCount/manuallyChanged",
      value: 30,
    });
    draft = reduceSingleAssignmentDraft(draft, {
      type: "capacity/reconciled",
      minimumQuestionCount: 4,
      maximumQuestionCount: 12,
      recommendedQuestionCount: 12,
      minimumAllowedQuestionCount: 4,
    });

    expect(
      resolveSingleAssignmentDraft(draft, { title: "새 자동 제목" }),
    ).toStrictEqual({
      displayTitle: "직접 정한 제목",
      submissionTitle: "직접 정한 제목",
      questionCount: 12,
    });
    expect(draft.questionCount).toStrictEqual({ mode: "manual", value: 12 });
  });

  it("can deliberately restore automatic title and count", () => {
    let draft: SingleAssignmentDraft = {
      ...automaticDraft,
      title: { mode: "custom", value: "직접 제목" },
      questionCount: { mode: "manual", value: 8 },
    };
    draft = reduceSingleAssignmentDraft(draft, {
      type: "title/restoreAutomatic",
    });
    draft = reduceSingleAssignmentDraft(draft, {
      type: "questionCount/restoreAutomatic",
      recommendedQuestionCount: 24,
    });

    expect(draft.title).toStrictEqual({ mode: "automatic" });
    expect(draft.questionCount).toStrictEqual({
      mode: "automatic",
      value: 24,
    });
  });

  it("turns an untouched source title into automatic on range changes but preserves custom titles", () => {
    const sourceDraft: SingleAssignmentDraft = {
      ...automaticDraft,
      operation: {
        mode: "replace",
        assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "regular",
      },
      title: { mode: "source", value: "기존 제목" },
      questionCount: { mode: "manual", value: 20 },
    };
    const range = {
      datasetId: assignmentContractIds.dataset,
      orderedUnitIds: [assignmentContractIds.day59],
    };

    expect(
      reduceSingleAssignmentDraft(sourceDraft, {
        type: "range/changed",
        range,
      }).title,
    ).toStrictEqual({ mode: "automatic" });
    expect(
      reduceSingleAssignmentDraft(
        { ...sourceDraft, title: { mode: "custom", value: "직접 제목" } },
        { type: "range/changed", range },
      ).title,
    ).toStrictEqual({ mode: "custom", value: "직접 제목" });
  });

  it("clears the selected range when the dataset changes", () => {
    const nextDataset = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const changed = reduceSingleAssignmentDraft(automaticDraft, {
      type: "dataset/changed",
      datasetId: nextDataset,
    });

    expect(changed.range).toStrictEqual({
      datasetId: nextDataset,
      orderedUnitIds: [],
    });
  });

  it("keeps the target student immutable for every replacement", () => {
    const regularReplacement: SingleAssignmentDraft = {
      ...automaticDraft,
      operation: {
        mode: "replace",
        assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "regular",
      },
    };

    for (const draft of [regularReplacement, exactReviewDraft]) {
      expect(
        reduceSingleAssignmentDraft(draft, {
          type: "student/changed",
          studentId: assignmentContractIds.studentB,
        }),
      ).toBe(draft);
    }
  });

  it("keeps exact-review range, review levels, and count immutable", () => {
    const actions = [
      {
        type: "dataset/changed" as const,
        datasetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      {
        type: "range/changed" as const,
        range: {
          datasetId: assignmentContractIds.dataset,
          orderedUnitIds: [assignmentContractIds.day59],
        },
      },
      { type: "questionCount/manuallyChanged" as const, value: 2 },
      {
        type: "questionCount/restoreAutomatic" as const,
        recommendedQuestionCount: 20,
      },
      {
        type: "capacity/reconciled" as const,
        minimumQuestionCount: 1,
        maximumQuestionCount: 20,
        recommendedQuestionCount: 20,
        minimumAllowedQuestionCount: 1,
      },
      {
        type: "review/changed" as const,
        review: {
          mode: "pending" as const,
          scope: "dataset" as const,
          levels: [1] as const,
        },
      },
    ];

    for (const action of actions) {
      expect(reduceSingleAssignmentDraft(exactReviewDraft, action)).toBe(
        exactReviewDraft,
      );
    }

    expect(
      reduceSingleAssignmentDraft(exactReviewDraft, {
        type: "title/changed",
        value: "제목은 수정 가능",
      }).title,
    ).toStrictEqual({ mode: "custom", value: "제목은 수정 가능" });
  });
});
