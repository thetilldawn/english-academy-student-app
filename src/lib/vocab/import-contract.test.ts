import { describe, expect, it } from "vitest";

import { normalizeVocabularyImport } from "@/lib/vocab/import-contract";

const validInput = {
  schemaVersion: 1,
  dataset: {
    datasetKey: "sample-vocab-2025",
    title: "샘플 단어장",
    edition: "2025",
    sourceLabel: "검수본.xlsx",
    sourceSha256: "A".repeat(64),
    sourceSheet: "어휘리스트",
    expectedRows: 5,
  },
  rows: [
    {
      sourceRow: 1,
      unit: "DAY 01",
      entryType: "표",
      headword: "progress",
      meaningText: "진보, 발전; 진행",
    },
    {
      sourceRow: 2,
      unit: "DAY 01",
      entryType: "파",
      headword: "progressive",
      meaningText: "진보적인",
    },
    {
      sourceRow: 3,
      unit: "DAY 01",
      entryType: "표",
      headword: "propose",
      meaningText: "제안하다",
    },
    {
      sourceRow: 4,
      unit: "DAY 01",
      entryType: "파",
      headword: "proposal",
      meaningText: "제안",
    },
    {
      sourceRow: 5,
      unit: "DAY 02",
      entryType: "복",
      headword: "progress",
      meaningText: "진전",
    },
  ],
} as const;

describe("normalizeVocabularyImport", () => {
  it("행을 정규화하고 중복 표제어를 삭제하지 않고 감사한다", () => {
    const result = normalizeVocabularyImport(validInput);

    expect(result.entries).toHaveLength(5);
    expect(result.units).toEqual([
      {
        unitLabel: "DAY 01",
        normalizedLabel: "day 01",
        unitKind: "day",
        unitNumber: 1,
        sortIndex: 1,
        entryCount: 4,
      },
      {
        unitLabel: "DAY 02",
        normalizedLabel: "day 02",
        unitKind: "day",
        unitNumber: 2,
        sortIndex: 2,
        entryCount: 1,
      },
    ]);
    expect(result.entries[0]).toMatchObject({
      unitLabel: "DAY 01",
      positionInUnit: 1,
      entryType: "표",
    });
    expect(result.entries[4]).toMatchObject({
      unitLabel: "DAY 02",
      positionInUnit: 1,
      entryType: "복",
    });
    expect(result.entries[0].meanings).toEqual(["진보, 발전", "진행"]);
    expect(result.entries[0].rowSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(result.audit).toMatchObject({
      rowCount: 5,
      unitCount: 2,
      dayUnitCount: 2,
      uniqueHeadwordCount: 4,
      duplicateHeadwordGroups: 1,
      repeatedHeadwordRows: 1,
      firstSourceRow: 1,
      lastSourceRow: 5,
    });
  });

  it("예상 행 수가 다르면 가져오기를 중단한다", () => {
    expect(() =>
      normalizeVocabularyImport({
        ...validInput,
        dataset: { ...validInput.dataset, expectedRows: 6 },
      }),
    ).toThrow("행 수 불일치");
  });

  it("원본 행 번호가 연속이 아니면 가져오기를 중단한다", () => {
    expect(() =>
      normalizeVocabularyImport({
        ...validInput,
        rows: validInput.rows.map((row, index) =>
          index === 2 ? { ...row, sourceRow: 9 } : row,
        ),
      }),
    ).toThrow("원본 행 번호");
  });
});
