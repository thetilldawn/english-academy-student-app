import { describe, expect, it } from "vitest";

import {
  assertVocabularyImportApplyAllowed,
  normalizeVocabularyImport,
} from "@/lib/vocab/import-contract";

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

  it("candidate import 정책은 dry-run 파싱은 허용하고 apply는 차단한다", () => {
    const result = normalizeVocabularyImport({
      ...validInput,
      importPolicy: {
        status: "candidate",
        applyAllowed: false,
        reason: "검수 전 후보",
      },
    });

    expect(result.file.importPolicy).toEqual({
      status: "candidate",
      applyAllowed: false,
      reason: "검수 전 후보",
    });
    expect(() => assertVocabularyImportApplyAllowed(result.file)).toThrow(
      "앱 적용이 차단된 데이터",
    );
  });

  it("approved 정책만 ready 적용을 허용한다", () => {
    const result = normalizeVocabularyImport({
      ...validInput,
      importPolicy: {
        status: "approved",
        applyAllowed: true,
        reason: "독립 검수 완료",
      },
    });

    expect(() =>
      assertVocabularyImportApplyAllowed(result.file, true),
    ).not.toThrow();
  });

  it("v2는 단어장과 단원을 구조화된 catalog로 연결한다", () => {
    const rows = validInput.rows.map((row, index) => ({
      sourceRow: row.sourceRow,
      entryType: row.entryType,
      headword: row.headword,
      meaningText: row.meaningText,
      unitKey: index < 4 ? "mock-03-41-42" : "csat-41-42",
    }));
    const result = normalizeVocabularyImport({
      schemaVersion: 2,
      importPolicy: {
        status: "approved",
        applyAllowed: true,
        reason: "검수 완료",
      },
      dataset: {
        ...validInput.dataset,
        catalog: {
          displayName: "고3 모의고사 · 장문독해",
          catalogGroup: "high_mock",
          materialKind: "exam_collection",
          gradeCode: "g12",
          publisher: "exam4you",
          seriesTitle: "장문독해",
          academicYear: 2025,
          curriculumRevision: null,
          editionLabel: null,
          isAssignable: true,
          sortIndex: 10,
        },
      },
      units: [
        {
          unitKey: "mock-03-41-42",
          label: "2025-03 서울교육청 41-42",
          catalogGroup: "high_mock",
          unitType: "exam_scope",
          displayName: "3월 서울교육청 41-42",
          academicYear: 2025,
          examMonth: 3,
          agency: "서울교육청",
          itemRange: "41-42",
          sortIndex: 1,
        },
        {
          unitKey: "csat-41-42",
          label: "2025-11 대수능 41-42",
          catalogGroup: "csat",
          unitType: "exam_scope",
          displayName: "대수능 41-42",
          academicYear: 2025,
          examMonth: 11,
          agency: "한국교육과정평가원",
          itemRange: "41-42",
          sortIndex: 2,
        },
      ],
      rows,
    });

    expect(result.file.schemaVersion).toBe(2);
    expect(result.units.map((unit) => unit.catalog?.catalogGroup)).toEqual([
      "high_mock",
      "csat",
    ]);
    expect(result.entries.at(-1)?.unitLabel).toBe(
      "2025-11 대수능 41-42",
    );
  });

  it("v2 row가 정의되지 않은 unitKey를 참조하면 중단한다", () => {
    expect(() =>
      normalizeVocabularyImport({
        schemaVersion: 2,
        dataset: {
          ...validInput.dataset,
          catalog: {
            displayName: "샘플",
            catalogGroup: "high",
            materialKind: "wordbook",
          },
        },
        units: [
          {
            unitKey: "day-01",
            label: "DAY 01",
            catalogGroup: "high",
            unitType: "day",
            displayName: "DAY 01",
            sortIndex: 1,
          },
        ],
        rows: validInput.rows.map((row) => ({
          sourceRow: row.sourceRow,
          entryType: row.entryType,
          headword: row.headword,
          meaningText: row.meaningText,
          unitKey: "missing",
        })),
      }),
    ).toThrow("정의되지 않은 unitKey");
  });
});
