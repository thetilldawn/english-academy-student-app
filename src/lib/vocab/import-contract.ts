import { createHash } from "node:crypto";

import { z } from "zod";

const sha256Schema = z
  .string()
  .regex(/^[A-F0-9]{64}$/)
  .transform((value) => value.toUpperCase());

const importRowV1Schema = z.object({
  sourceRow: z.number().int().positive(),
  unit: z.string().trim().min(1).max(160),
  entryType: z.string().trim().min(1).max(80),
  headword: z.string().trim().min(1).max(160),
  meaningText: z.string().trim().min(1).max(2000),
});

const importRowV2Schema = z.object({
  sourceRow: z.number().int().positive(),
  unitKey: z.string().trim().min(1).max(120),
  entryType: z.string().trim().min(1).max(80),
  headword: z.string().trim().min(1).max(160),
  meaningText: z.string().trim().min(1).max(2000),
});

const catalogGroupSchema = z.enum([
  "middle",
  "high",
  "high_mock",
  "csat",
]);

const materialKindSchema = z.enum([
  "textbook",
  "wordbook",
  "exam_collection",
  "exam_prep",
  "supplement",
]);

const unitTypeSchema = z.enum([
  "day",
  "lesson",
  "chapter",
  "exam_scope",
  "passage_type",
  "supplement",
]);

const datasetCatalogSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  catalogGroup: catalogGroupSchema,
  materialKind: materialKindSchema,
  gradeCode: z.string().trim().min(1).max(24).nullable().default(null),
  publisher: z.string().trim().min(1).max(120).nullable().default(null),
  seriesTitle: z.string().trim().min(1).max(160).nullable().default(null),
  academicYear: z.number().int().min(2000).max(2100).nullable().default(null),
  curriculumRevision: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .nullable()
    .default(null),
  editionLabel: z.string().trim().min(1).max(80).nullable().default(null),
  isAssignable: z.boolean().default(false),
  sortIndex: z.number().int().nonnegative().default(0),
});

const unitCatalogSchema = z.object({
  unitKey: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  catalogGroup: catalogGroupSchema,
  unitType: unitTypeSchema,
  displayName: z.string().trim().min(1).max(200),
  academicYear: z.number().int().min(2000).max(2100).nullable().default(null),
  examMonth: z.number().int().min(1).max(12).nullable().default(null),
  agency: z.string().trim().min(1).max(120).nullable().default(null),
  itemRange: z.string().trim().min(1).max(80).nullable().default(null),
  sortIndex: z.number().int().positive(),
});

const vocabularyImportPolicySchema = z
  .object({
    status: z.enum(["candidate", "approved"]),
    applyAllowed: z.boolean(),
    reason: z.string().trim().min(1).max(300),
  })
  .refine(
    (policy) => policy.status !== "candidate" || !policy.applyAllowed,
    "후보 데이터는 앱 적용을 허용할 수 없습니다.",
  );

const datasetBaseSchema = z.object({
  datasetKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  title: z.string().trim().min(1).max(160),
  edition: z.string().trim().min(1).max(80),
  sourceLabel: z.string().trim().min(1).max(200),
  sourceSha256: sha256Schema,
  sourceSheet: z.string().trim().min(1).max(160),
  sourceMetadata: z
    .object({
      sourceType: z.string().trim().min(1).max(80).default("wordbook"),
      publisher: z.string().trim().min(1).max(160).nullable().default(null),
      curriculumRevision: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .nullable()
        .default(null),
      gradeCode: z.string().trim().min(1).max(40).nullable().default(null),
      academicYear: z.number().int().min(1900).max(2200).nullable().default(null),
      semester: z.number().int().min(1).max(2).nullable().default(null),
    })
    .optional(),
  expectedRows: z.number().int().positive(),
});

const vocabularyImportV1Schema = z.object({
  schemaVersion: z.literal(1),
  importPolicy: vocabularyImportPolicySchema.optional(),
  dataset: datasetBaseSchema,
  rows: z.array(importRowV1Schema).min(4),
});

const vocabularyImportV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    importPolicy: vocabularyImportPolicySchema.optional(),
    dataset: datasetBaseSchema.extend({ catalog: datasetCatalogSchema }),
    units: z.array(unitCatalogSchema).min(1),
    rows: z.array(importRowV2Schema).min(4),
  })
  .superRefine((file, context) => {
    const unitKeys = new Set<string>();
    const unitLabels = new Set<string>();
    const unitSortIndexes = new Set<number>();
    for (const unit of file.units) {
      if (unitKeys.has(unit.unitKey)) {
        context.addIssue({
          code: "custom",
          message: `unitKey가 중복되었습니다: ${unit.unitKey}`,
        });
      }
      unitKeys.add(unit.unitKey);
      const normalizedLabel = unit.label
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en-US");
      if (unitLabels.has(normalizedLabel)) {
        context.addIssue({
          code: "custom",
          message: `단원 label이 중복되었습니다: ${unit.label}`,
        });
      }
      unitLabels.add(normalizedLabel);
      if (unitSortIndexes.has(unit.sortIndex)) {
        context.addIssue({
          code: "custom",
          message: `단원 sortIndex가 중복되었습니다: ${unit.sortIndex}`,
        });
      }
      unitSortIndexes.add(unit.sortIndex);
    }
    for (const row of file.rows) {
      if (!unitKeys.has(row.unitKey)) {
        context.addIssue({
          code: "custom",
          message: `정의되지 않은 unitKey입니다: ${row.unitKey}`,
        });
      }
    }
  });

export const vocabularyImportFileSchema = z.discriminatedUnion(
  "schemaVersion",
  [vocabularyImportV1Schema, vocabularyImportV2Schema],
);

export type VocabularyImportFile = z.infer<
  typeof vocabularyImportFileSchema
>;

export type NormalizedVocabularyEntry = {
  sourceRow: number;
  unitLabel: string;
  unitNormalizedLabel: string;
  unitKind: "day" | "supplement";
  unitNumber: number | null;
  positionInUnit: number;
  entryType: string;
  headword: string;
  headwordNormalized: string;
  meanings: string[];
  primaryMeaning: string;
  sourceRef: string;
  rowSha256: string;
};

export type NormalizedVocabularyUnit = {
  unitLabel: string;
  normalizedLabel: string;
  unitKind: "day" | "supplement";
  unitNumber: number | null;
  sortIndex: number;
  entryCount: number;
  catalog?: z.infer<typeof unitCatalogSchema>;
};

export type VocabularyImportAudit = {
  rowCount: number;
  unitCount: number;
  dayUnitCount: number;
  uniqueHeadwordCount: number;
  duplicateHeadwordGroups: number;
  repeatedHeadwordRows: number;
  ambiguousMeaningGroups: number;
  firstSourceRow: number;
  lastSourceRow: number;
};

export function assertVocabularyImportApplyAllowed(
  file: VocabularyImportFile,
  markReady = false,
) {
  const policy = file.importPolicy;
  if (policy?.applyAllowed === false) {
    throw new Error(`앱 적용이 차단된 데이터입니다: ${policy.reason}`);
  }
  if (markReady && policy && policy.status !== "approved") {
    throw new Error("승인되지 않은 데이터는 ready 상태로 적용할 수 없습니다.");
  }
}

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

function parseUnit(unit: string): {
  unitLabel: string;
  normalizedLabel: string;
  unitKind: "day" | "supplement";
  unitNumber: number | null;
} {
  const unitLabel = normalizeText(unit);
  const dayMatch = /^DAY\s*([0-9]+)$/i.exec(unitLabel);

  return {
    unitLabel,
    normalizedLabel: normalizeKey(unitLabel),
    unitKind: dayMatch ? "day" : "supplement",
    unitNumber: dayMatch ? Number(dayMatch[1]) : null,
  };
}

export function normalizeVocabularyImport(input: unknown): {
  file: VocabularyImportFile;
  units: NormalizedVocabularyUnit[];
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

  const unitCatalogByKey =
    file.schemaVersion === 2
      ? new Map(file.units.map((unit) => [unit.unitKey, unit]))
      : null;
  const unitPositions = new Map<string, number>();
  const unitsByLabel = new Map<string, NormalizedVocabularyUnit>();
  const entries = orderedRows.map((row) => {
    const unitCatalog =
      "unitKey" in row
        ? unitCatalogByKey?.get(row.unitKey)
        : undefined;
    if ("unitKey" in row && !unitCatalog) {
      throw new Error(`정의되지 않은 unitKey입니다: ${row.unitKey}`);
    }
    const rowUnitLabel =
      "unit" in row ? row.unit : unitCatalog!.label;
    const unit = parseUnit(rowUnitLabel);
    const positionInUnit =
      (unitPositions.get(unit.normalizedLabel) ?? 0) + 1;
    unitPositions.set(unit.normalizedLabel, positionInUnit);
    const existingUnit = unitsByLabel.get(unit.normalizedLabel);
    if (existingUnit) {
      existingUnit.entryCount += 1;
    } else {
      unitsByLabel.set(unit.normalizedLabel, {
        unitLabel: unit.unitLabel,
        normalizedLabel: unit.normalizedLabel,
        unitKind:
          unitCatalog?.unitType === "day" ? "day" : unit.unitKind,
        unitNumber: unit.unitNumber,
        sortIndex: unitCatalog?.sortIndex ?? unitsByLabel.size + 1,
        entryCount: 1,
        ...(unitCatalog ? { catalog: unitCatalog } : {}),
      });
    }

    const headword = normalizeText(row.headword);
    const meaningText = normalizeText(row.meaningText);
    return {
      sourceRow: row.sourceRow,
      unitLabel: unit.unitLabel,
      unitNormalizedLabel: unit.normalizedLabel,
      unitKind: unit.unitKind,
      unitNumber: unit.unitNumber,
      positionInUnit,
      entryType: normalizeText(row.entryType),
      headword,
      headwordNormalized: normalizeKey(headword),
      meanings: splitMeanings(meaningText),
      primaryMeaning: meaningText,
      sourceRef: `${unit.unitLabel} · ${normalizeText(row.entryType)}`,
      rowSha256: hashRow([
        file.dataset.datasetKey,
        row.sourceRow,
        normalizeText(rowUnitLabel),
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
    unitCount: unitsByLabel.size,
    dayUnitCount: [...unitsByLabel.values()].filter(
      (unit) => unit.unitKind === "day",
    ).length,
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

  return {
    file,
    units: [...unitsByLabel.values()].toSorted(
      (left, right) => left.sortIndex - right.sortIndex,
    ),
    entries,
    audit,
  };
}
