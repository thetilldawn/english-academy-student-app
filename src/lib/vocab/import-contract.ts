import { createHash } from "node:crypto";

import { z } from "zod";

const sha256Schema = z
  .string()
  .regex(/^[A-F0-9]{64}$/)
  .transform((value) => value.toUpperCase());

const importRowSchema = z.object({
  sourceRow: z.number().int().positive(),
  unit: z.string().trim().min(1).max(160),
  entryType: z.string().trim().min(1).max(80),
  headword: z.string().trim().min(1).max(160),
  meaningText: z.string().trim().min(1).max(2000),
});

export const vocabularyImportFileSchema = z.object({
  schemaVersion: z.literal(1),
  dataset: z.object({
    datasetKey: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    title: z.string().trim().min(1).max(160),
    edition: z.string().trim().min(1).max(80),
    sourceLabel: z.string().trim().min(1).max(200),
    sourceSha256: sha256Schema,
    sourceSheet: z.string().trim().min(1).max(160),
    expectedRows: z.number().int().positive(),
  }),
  rows: z.array(importRowSchema).min(4),
});

export type VocabularyImportFile = z.infer<
  typeof vocabularyImportFileSchema
>;

export type NormalizedVocabularyEntry = {
  sourceRow: number;
  headword: string;
  headwordNormalized: string;
  meanings: string[];
  primaryMeaning: string;
  sourceRef: string;
  rowSha256: string;
};

export type VocabularyImportAudit = {
  rowCount: number;
  uniqueHeadwordCount: number;
  duplicateHeadwordGroups: number;
  repeatedHeadwordRows: number;
  ambiguousMeaningGroups: number;
  firstSourceRow: number;
  lastSourceRow: number;
};

function normalizeText(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: string) {
  return normalizeText(value).toLocaleLowerCase("en-US");
}

function hashRow(parts: readonly (string | number)[]) {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex")
    .toUpperCase();
}

function splitMeanings(meaningText: string): string[] {
  const values = meaningText
    .split(";")
    .map(normalizeText)
    .filter(Boolean);
  return values.length > 0 ? values : [normalizeText(meaningText)];
}

export function normalizeVocabularyImport(input: unknown): {
  file: VocabularyImportFile;
  entries: NormalizedVocabularyEntry[];
  audit: VocabularyImportAudit;
} {
  const file = vocabularyImportFileSchema.parse(input);

  if (file.rows.length !== file.dataset.expectedRows) {
    throw new Error(
      `행 수 불일치: 예상 ${file.dataset.expectedRows}, 실제 ${file.rows.length}`,
    );
  }

  const orderedRows = [...file.rows].sort(
    (left, right) => left.sourceRow - right.sourceRow,
  );
  for (let index = 0; index < orderedRows.length; index += 1) {
    if (orderedRows[index].sourceRow !== index + 1) {
      throw new Error(
        `원본 행 번호가 1부터 연속되지 않습니다: ${orderedRows[index].sourceRow}`,
      );
    }
  }

  const entries = orderedRows.map((row) => {
    const headword = normalizeText(row.headword);
    const meaningText = normalizeText(row.meaningText);
    return {
      sourceRow: row.sourceRow,
      headword,
      headwordNormalized: normalizeKey(headword),
      meanings: splitMeanings(meaningText),
      primaryMeaning: meaningText,
      sourceRef: `${normalizeText(row.unit)} · ${normalizeText(
        row.entryType,
      )}`,
      rowSha256: hashRow([
        file.dataset.datasetKey,
        row.sourceRow,
        normalizeText(row.unit),
        normalizeText(row.entryType),
        headword,
        meaningText,
      ]),
    };
  });

  const rowHashes = new Set(entries.map((entry) => entry.rowSha256));
  if (rowHashes.size !== entries.length) {
    throw new Error("완전히 같은 가져오기 행이 중복되어 있습니다.");
  }

  const headwordCounts = new Map<string, number>();
  const meaningHeadwords = new Map<string, Set<string>>();
  for (const entry of entries) {
    headwordCounts.set(
      entry.headwordNormalized,
      (headwordCounts.get(entry.headwordNormalized) ?? 0) + 1,
    );
    const meaningKey = normalizeKey(entry.primaryMeaning);
    const headwords = meaningHeadwords.get(meaningKey) ?? new Set<string>();
    headwords.add(entry.headwordNormalized);
    meaningHeadwords.set(meaningKey, headwords);
  }

  const duplicateGroups = [...headwordCounts.values()].filter(
    (count) => count > 1,
  );
  const audit: VocabularyImportAudit = {
    rowCount: entries.length,
    uniqueHeadwordCount: headwordCounts.size,
    duplicateHeadwordGroups: duplicateGroups.length,
    repeatedHeadwordRows: duplicateGroups.reduce(
      (total, count) => total + count - 1,
      0,
    ),
    ambiguousMeaningGroups: [...meaningHeadwords.values()].filter(
      (headwords) => headwords.size > 1,
    ).length,
    firstSourceRow: entries[0].sourceRow,
    lastSourceRow: entries.at(-1)?.sourceRow ?? 0,
  };

  if (
    audit.uniqueHeadwordCount < 4 ||
    meaningHeadwords.size < 4
  ) {
    throw new Error("4지선다를 만들 서로 다른 단어와 뜻이 부족합니다.");
  }

  return { file, entries, audit };
}
