import { describe, expect, it } from "vitest";

import { mapResultQuestions } from "@/lib/services/quiz-service";

type ResultRow = Parameters<typeof mapResultQuestions>[0][number];

function resultRow(
  overrides: Partial<ResultRow> = {},
): ResultRow {
  return {
    id: "question-1",
    order_index: 1,
    direction: "english_to_korean",
    prompt: "current",
    choices: ["현재 뜻", "보기 2", "보기 3", "보기 4"],
    correct_choice_index: 0,
    initial_choice_index: 1,
    initial_is_correct: false,
    retry_choice_index: 0,
    retry_is_correct: true,
    assignment_question: null,
    vocab_entries: {
      headword: "current",
      primary_meaning: "현재 뜻",
    },
    ...overrides,
  };
}

describe("mapResultQuestions", () => {
  it("검증된 v2 문제는 당시 문제은행 단어 스냅샷을 표시한다", () => {
    const [result] = mapResultQuestions([
      resultRow({
        assignment_question: {
          headword_snapshot: "snapshot",
          primary_meaning_snapshot: "당시 뜻",
          provenance_status: "verified_v2",
        },
      }),
    ]);

    expect(result.headword).toBe("snapshot");
    expect(result.primaryMeaning).toBe("당시 뜻");
    expect(result.provenanceStatus).toBe("verified_v2");
    expect(result.correctAnswer).toBe("현재 뜻");
    expect(result.initialChoice).toBe("보기 2");
    expect(result.retryChoice).toBe("현재 뜻");
  });

  it("문제은행 연결이 없는 레거시는 현재 단어 행으로 표시한다", () => {
    const [result] = mapResultQuestions([resultRow()]);

    expect(result.headword).toBe("current");
    expect(result.primaryMeaning).toBe("현재 뜻");
    expect(result.provenanceStatus).toBe("legacy_backfill");
  });

  it("Preview 검토본도 배정 당시 문맥 뜻 스냅샷을 표시한다", () => {
    const [result] = mapResultQuestions([
      resultRow({
        assignment_question: {
          headword_snapshot: "untrusted base",
          primary_meaning_snapshot: "검증 전 뜻",
          provenance_status: "legacy_backfill",
          exam_use_snapshot: {
            headword_snapshot: "observe",
            primary_meaning_snapshot: "준수하다",
            display_pronunciation_ko_snapshot: "업저브",
            pronunciation_snapshot: {},
            choice_dictionary_snapshots: [],
            provenance_status: "reviewed_for_preview_v1",
          },
        },
      }),
    ]);

    expect(result.headword).toBe("observe");
    expect(result.primaryMeaning).toBe("준수하다");
    expect(result.provenanceStatus).toBe("reviewed_for_preview_v1");
  });

  it("검증되지 않은 레거시 backfill은 현재 단어 행을 우선한다", () => {
    const [result] = mapResultQuestions([
      resultRow({
        assignment_question: {
          headword_snapshot: "unverified",
          primary_meaning_snapshot: "검증되지 않은 뜻",
          provenance_status: "legacy_backfill",
        },
      }),
    ]);

    expect(result.headword).toBe("current");
    expect(result.primaryMeaning).toBe("현재 뜻");
    expect(result.provenanceStatus).toBe("legacy_backfill");
  });
});
