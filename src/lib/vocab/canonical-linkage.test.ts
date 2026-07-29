import { describe, expect, it } from "vitest";

import {
  buildEntryLexemeLinks,
  evaluateBookQuizEligibility,
  normalizeCanonicalHeadword,
  stableWordIndexId,
  summarizeHeadwordMeaningConflicts,
} from "@/lib/vocab/canonical-linkage";
import type { NormalizedVocabularyEntry } from "@/lib/vocab/import-contract";

function entry(
  sourceRow: number,
  headword: string,
  primaryMeaning: string,
): NormalizedVocabularyEntry {
  return {
    sourceRow,
    unitLabel: "DAY 01",
    unitNormalizedLabel: "day 01",
    unitKind: "day",
    unitNumber: 1,
    positionInUnit: sourceRow,
    entryType: "표",
    headword,
    headwordNormalized: headword.toLowerCase(),
    meanings: [primaryMeaning],
    primaryMeaning,
    sourceRef: "DAY 01 · 표",
    rowSha256: String(sourceRow).padStart(64, "A"),
  };
}

describe("canonical vocabulary linkage", () => {
  it("uses the same NFKC, case, star, and whitespace normalization as the index", () => {
    expect(normalizeCanonicalHeadword("  Ａb*C\tD  ")).toBe("abc d");
  });

  it("links only one active word candidate and keeps non-word matches unresolved", () => {
    const links = buildEntryLexemeLinks(
      "book-2025",
      [entry(1, "Progress", "발전"), entry(2, "fort", "요새")],
      [
        {
          lexemeId: "11111111-1111-5111-8111-111111111111",
          headword: "progress",
          normalizedHeadword: "progress",
          lexemeType: "word",
          typeStatus: "legacy_unverified",
          lifecycleStatus: "active",
          contentHash: "B".repeat(64),
          pronunciationKo: null,
          isReady: false,
          legacyReadyClaim: true,
        },
      ],
      [
        {
          lexemeId: "22222222-2222-5222-8222-222222222222",
          headword: "fort",
          lexemeType: "root",
        },
      ],
    );

    expect(links[0]).toMatchObject({
      mappingStatus: "exact_headword_unreviewed",
      lexemeId: "11111111-1111-5111-8111-111111111111",
      canonicalIsReady: false,
      legacyReadyClaim: true,
    });
    expect(links[1]).toMatchObject({
      mappingStatus: "unresolved",
      lexemeId: null,
      nonWordCandidates: [
        {
          lexemeType: "root",
          headword: "fort",
        },
      ],
    });
  });

  it("does not silently choose between multiple active word candidates", () => {
    const candidates = ["a", "b"].map((suffix) => ({
      lexemeId: `${suffix.repeat(8)}-${suffix.repeat(4)}-5${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
      headword: "bank",
      normalizedHeadword: "bank",
      lexemeType: "word",
      typeStatus: "approved",
      lifecycleStatus: "active",
      contentHash: "C".repeat(64),
      pronunciationKo: null,
      isReady: false,
      legacyReadyClaim: false,
    }));

    expect(
      buildEntryLexemeLinks(
        "book-2025",
        [entry(1, "bank", "은행")],
        candidates,
        [],
      )[0],
    ).toMatchObject({
      mappingStatus: "ambiguous",
      lexemeId: null,
    });
  });

  it("separates headword conflicts from reverse-direction meaning conflicts", () => {
    const rows = [
      entry(1, "bank", "은행"),
      entry(2, "bank", "둑"),
      entry(3, "shore", "둑"),
      entry(4, "progress", "발전"),
    ];
    const eligibility = evaluateBookQuizEligibility(rows);

    expect(eligibility[0]).toMatchObject({
      englishToKoreanStatus: "review_required",
      koreanToEnglishStatus: "review_required",
    });
    expect(eligibility[2]).toMatchObject({
      englishToKoreanStatus: "eligible",
      koreanToEnglishStatus: "review_required",
    });
    expect(eligibility[3]).toMatchObject({
      combinedStatus: "eligible",
      reasonCodes: [],
    });
  });

  it("does not treat ASCII and Unicode ellipses as different meanings", () => {
    const rows = [
      entry(1, "affect", "...인 체하다"),
      entry(2, "affect", "…인 체하다"),
    ];

    expect(summarizeHeadwordMeaningConflicts(rows, "legacy_nfc")).toEqual({
      groups: 1,
      rows: 2,
    });
    expect(summarizeHeadwordMeaningConflicts(rows, "canonical")).toEqual({
      groups: 0,
      rows: 0,
    });
  });

  it("creates deterministic UUIDv5 identifiers in the word-index namespace", () => {
    const first = stableWordIndexId("source", "wordbook|book-2025");
    const second = stableWordIndexId("source", "wordbook|book-2025");

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
