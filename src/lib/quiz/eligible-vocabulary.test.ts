import { describe, expect, it } from "vitest";

import {
  mergeEligibleVocabularyRows,
  type VocabularyEligibilitySourceRow,
  type VocabularyEntrySourceRow,
} from "@/lib/quiz/eligible-vocabulary";

const entries: VocabularyEntrySourceRow[] = [
  {
    id: 1,
    unit_id: "unit-1",
    source_row: 1,
    headword: "alpha",
    headword_normalized: "alpha",
    primary_meaning: "알파",
  },
  {
    id: 2,
    unit_id: "unit-2",
    source_row: 2,
    headword: "beta",
    headword_normalized: "beta",
    primary_meaning: "베타",
  },
];

describe("mergeEligibleVocabularyRows", () => {
  it("검수된 방향과 canonical을 원래 어휘 순서에 합친다", () => {
    const eligibility: VocabularyEligibilitySourceRow[] = [
      {
        vocab_entry_id: 2,
        quiz_mode: "book_meaning_ko_to_en",
        canonical_lexeme_id: "canonical-2",
      },
      {
        vocab_entry_id: 1,
        quiz_mode: "book_meaning_en_to_ko",
        canonical_lexeme_id: "canonical-1",
      },
      {
        vocab_entry_id: 1,
        quiz_mode: "book_meaning_ko_to_en",
        canonical_lexeme_id: "canonical-1",
      },
    ];

    expect(mergeEligibleVocabularyRows(entries, eligibility)).toEqual([
      {
        id: 1,
        unitId: "unit-1",
        sourceRow: 1,
        headword: "alpha",
        headwordNormalized: "alpha",
        primaryMeaning: "알파",
        recordType: null,
        canonicalDictionaryId: null,
        canonicalLexemeId: "canonical-1",
        canonicalKey: "canonical-1",
        eligibleDirections: [
          "english_to_korean",
          "korean_to_english",
        ],
      },
      {
        id: 2,
        unitId: "unit-2",
        sourceRow: 2,
        headword: "beta",
        headwordNormalized: "beta",
        primaryMeaning: "베타",
        recordType: null,
        canonicalDictionaryId: null,
        canonicalLexemeId: "canonical-2",
        canonicalKey: "canonical-2",
        eligibleDirections: ["korean_to_english"],
      },
    ]);
  });

  it("검수 통과 방향이 없는 어휘는 후보에서 제외한다", () => {
    expect(
      mergeEligibleVocabularyRows(entries, [
        {
          vocab_entry_id: 1,
          quiz_mode: "book_meaning_en_to_ko",
          canonical_lexeme_id: null,
        },
      ]),
    ).toHaveLength(1);
  });

  it("범위 안에서 다시 판정할 중복 경고만 런타임 후보로 유지한다", () => {
    const candidates = mergeEligibleVocabularyRows(entries, [
      {
        vocab_entry_id: 1,
        quiz_mode: "book_meaning_en_to_ko",
        canonical_lexeme_id: "canonical-1",
        status: "review_required",
        reason_codes: ["DUPLICATE_HEADWORD_DIFFERENT_MEANING"],
      },
      {
        vocab_entry_id: 2,
        quiz_mode: "book_meaning_en_to_ko",
        canonical_lexeme_id: "canonical-2",
        status: "review_required",
        reason_codes: ["UNRESOLVED_CANONICAL_LINK"],
      },
    ]);

    expect(candidates.map((entry) => entry.id)).toEqual([1]);
  });

  it("한 어휘의 방향별 canonical이 다르면 중단한다", () => {
    expect(() =>
      mergeEligibleVocabularyRows(entries, [
        {
          vocab_entry_id: 1,
          quiz_mode: "book_meaning_en_to_ko",
          canonical_lexeme_id: "canonical-a",
        },
        {
          vocab_entry_id: 1,
          quiz_mode: "book_meaning_ko_to_en",
          canonical_lexeme_id: "canonical-b",
        },
      ]),
    ).toThrow("표준 표제어 연결이 서로 다릅니다.");
  });

  it("text 단어사전 ID를 legacy UUID보다 canonical key로 우선한다", () => {
    const [candidate] = mergeEligibleVocabularyRows(entries, [
      {
        vocab_entry_id: 1,
        quiz_mode: "book_meaning_en_to_ko",
        canonical_lexeme_id: "00000000-0000-4000-8000-000000000001",
        canonical_dictionary_id: "word:observe",
      },
    ]);

    expect(candidate.canonicalKey).toBe("word:observe");
  });

  it("중복 entry ID와 중복 quiz mode를 거절한다", () => {
    expect(() =>
      mergeEligibleVocabularyRows([entries[0], entries[0]], []),
    ).toThrow("어휘 ID가 중복되었습니다.");
    expect(() =>
      mergeEligibleVocabularyRows(entries, [
        {
          vocab_entry_id: 1,
          quiz_mode: "book_meaning_en_to_ko",
          canonical_lexeme_id: null,
        },
        {
          vocab_entry_id: 1,
          quiz_mode: "book_meaning_en_to_ko",
          canonical_lexeme_id: null,
        },
      ]),
    ).toThrow("출제 가능 모드가 중복되었습니다.");
  });
});
