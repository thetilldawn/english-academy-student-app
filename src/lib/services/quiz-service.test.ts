import { describe, expect, it } from "vitest";

import {
  completeChoiceVocabEntryIds,
  mapResultQuestions,
} from "@/lib/services/quiz-service";

type ResultRow = Parameters<typeof mapResultQuestions>[0][number];

function resultRow(
  overrides: Partial<ResultRow> = {},
): ResultRow {
  return {
    id: "question-1",
    vocab_entry_id: null,
    order_index: 1,
    direction: "english_to_korean",
    prompt: "current",
    choices: ["현재 뜻", "보기 2", "보기 3", "보기 4"],
    correct_choice_index: 0,
    initial_choice_index: 1,
    initial_is_correct: false,
    retry_choice_index: 0,
    retry_is_correct: true,
    prior_wrong_count: 0,
    assignment_question: null,
    vocab_entries: {
      headword: "current",
      primary_meaning: "현재 뜻",
      pronunciation_ko: null,
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
    expect(result.correctChoiceIndex).toBe(0);
  });

  it("Preview 검토본도 배정 당시 문맥 뜻 스냅샷을 표시한다", () => {
    const [result] = mapResultQuestions([
      resultRow({
        assignment_question: {
          headword_snapshot: "untrusted base",
          primary_meaning_snapshot: "검증 전 뜻",
          provenance_status: "legacy_backfill",
          exam_use_snapshot: {
            dictionary_id: "word:observe",
            pronunciation_variant_id: "mw:observe",
            headword_snapshot: "observe",
            primary_meaning_snapshot: "준수하다",
            display_pronunciation_ko_snapshot: "업저브",
            pronunciation_snapshot: {
              displayPronunciationKo: "업저브",
              koSegments: [
                { text: "업", stress: "none" },
                { text: "저브", stress: "primary" },
              ],
            },
            choice_dictionary_snapshots: [],
            provenance_status: "reviewed_for_preview_v1",
          },
        },
      }),
    ]);

    expect(result.headword).toBe("observe");
    expect(result.primaryMeaning).toBe("준수하다");
    expect(result.pronunciation.displayKo).toBe("업저브");
    expect(result.pronunciation.segments).toEqual([
      { text: "업", stress: "none" },
      { text: "저브", stress: "primary" },
    ]);
    expect(result.provenanceStatus).toBe("reviewed_for_preview_v1");
  });

  it("결과 화면에도 Google 합성 표현 음원과 한글 발음을 합쳐 전달한다", () => {
    const dictionaryId = "expression:apply-for-4f26363d";
    const assetId =
      "synthetic:5906e950416fd2752329ef5ecc1761c62fd47d154a80f30fd171682596724458";
    const audioUrl =
      "https://wojxpruvbjzbhrpmsbuy.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/pronunciation/google_cloud_text_to_speech/profile-5b6efb0ecc8f4702/5906e950416fd2752329ef5ecc1761c62fd47d154a80f30fd171682596724458.mp3";
    const segments = [
      { text: "어플", stress: "none" as const },
      { text: "라이", stress: "primary" as const },
      { text: " 포어", stress: "none" as const },
    ];
    const [result] = mapResultQuestions(
      [
        resultRow({
          assignment_question: {
            headword_snapshot: "apply for",
            primary_meaning_snapshot: "지원하다",
            provenance_status: "legacy_backfill",
            exam_use_snapshot: {
              dictionary_id: dictionaryId,
              pronunciation_variant_id: null,
              headword_snapshot: "apply for",
              primary_meaning_snapshot: "지원하다",
              display_pronunciation_ko_snapshot: "어플라이 포어",
              pronunciation_snapshot: {},
              choice_dictionary_snapshots: [],
              provenance_status: "reviewed_for_preview_v1",
            },
          },
        }),
      ],
      new Map(),
      new Map([
        [
          dictionaryId,
          {
            audioUrl,
            available: true,
            displayKo: null,
            variantId: assetId,
          },
        ],
      ]),
      new Map(),
      new Map([
        [
          `${dictionaryId}\u0000${assetId}`,
          {
            audioUrl: null,
            available: false,
            displayKo: "어플라이 포어",
            segments,
            variantId: assetId,
          },
        ],
      ]),
    );

    expect(result.pronunciation).toEqual({
      audioUrl,
      available: true,
      displayKo: "어플라이 포어",
      segments,
      variantId: assetId,
    });
  });

  it("결과 화면에 동일 변이로 승인된 강세 구간을 전달한다", () => {
    const approved = {
      audioUrl: null,
      available: false,
      displayKo: "이네버터블",
      segments: [
        { text: "이", stress: "none" as const },
        { text: "네", stress: "primary" as const },
        { text: "버터블", stress: "none" as const },
      ],
      variantId: "mw:inevitable",
    };
    const [result] = mapResultQuestions(
      [
        resultRow({
          assignment_question: {
            headword_snapshot: "inevitable",
            primary_meaning_snapshot: "불가피한",
            provenance_status: "legacy_backfill",
            exam_use_snapshot: {
              dictionary_id: "word:inevitable",
              pronunciation_variant_id: "mw:inevitable",
              headword_snapshot: "inevitable",
              primary_meaning_snapshot: "불가피한",
              display_pronunciation_ko_snapshot: "이네버터블",
              pronunciation_snapshot: {
                displayPronunciationKo: "이네버터블",
                pronunciationVariantId: "mw:inevitable",
                audioStatus: "raw_attached",
                audioUrl:
                  "https://media.merriam-webster.com/audio/prons/en/us/mp3/i/inevitable.mp3",
                listeningEnabled: true,
              },
              choice_dictionary_snapshots: [],
              provenance_status: "reviewed_for_preview_v1",
            },
          },
        }),
      ],
      new Map(),
      new Map(),
      new Map(),
      new Map([["word:inevitable\u0000mw:inevitable", approved]]),
    );

    expect(result.pronunciation.segments?.[1]).toEqual({
      text: "네",
      stress: "primary",
    });
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

  it("counts prior initial-test misses plus the current miss", () => {
    const [result] = mapResultQuestions([
      resultRow({ prior_wrong_count: 1, initial_is_correct: false }),
    ]);

    expect(result.wrongCount).toBe(2);
  });

  it("shows one wrong for the first initial miss", () => {
    const [result] = mapResultQuestions([
      resultRow({ prior_wrong_count: 0, initial_is_correct: false }),
    ]);

    expect(result.wrongCount).toBe(1);
  });

  it("does not add another wrong for a failed retry in the same test", () => {
    const [result] = mapResultQuestions([
      resultRow({
        prior_wrong_count: 0,
        initial_is_correct: false,
        retry_is_correct: false,
      }),
    ]);

    expect(result.wrongCount).toBe(1);
  });
});

describe("completeChoiceVocabEntryIds", () => {
  it("역방향 보기 네 개의 ID가 모두 있을 때만 사용한다", () => {
    expect(completeChoiceVocabEntryIds([11, 12, 13, 14], 4)).toEqual([
      11, 12, 13, 14,
    ]);
    expect(completeChoiceVocabEntryIds([11, 12, 13], 4)).toEqual([
      null, null, null, null,
    ]);
    expect(completeChoiceVocabEntryIds(null, 4)).toEqual([
      null, null, null, null,
    ]);
  });
});
