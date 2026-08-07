import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  buildEntryLexemeLinks,
  evaluateBookQuizEligibility,
  sha256,
  stableWordIndexId,
  summarizeHeadwordMeaningConflicts,
  type CanonicalLexemeForLinkage,
  type EntryLexemeLink,
  type NonWordCandidate,
} from "@/lib/vocab/canonical-linkage";
import { normalizeVocabularyImport } from "@/lib/vocab/import-contract";

type CliOptions = {
  wordIndex: string;
  dataset: string;
  outDir: string;
  previousDir: string | null;
};

type SqliteRow = Record<string, unknown>;

function parseOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !["--word-index", "--dataset", "--out-dir", "--previous-dir"].includes(
        key,
      ) ||
      !value
    ) {
      throw new Error(
        "사용법: npm run build:vocab-link -- --word-index <sqlite> --dataset <검수본.json> --out-dir <출력폴더> [--previous-dir <이전패키지>]",
      );
    }
    values.set(key, value);
  }

  const wordIndex = values.get("--word-index");
  const dataset = values.get("--dataset");
  const outDir = values.get("--out-dir");
  if (!wordIndex || !dataset || !outDir) {
    throw new Error(
      "--word-index, --dataset, --out-dir는 모두 필요합니다.",
    );
  }

  return {
    wordIndex: path.resolve(wordIndex),
    dataset: path.resolve(dataset),
    outDir: path.resolve(outDir),
    previousDir: values.has("--previous-dir")
      ? path.resolve(values.get("--previous-dir")!)
      : null,
  };
}

function asString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function asNullableString(value: unknown) {
  const text = asString(value);
  return text ? text : null;
}

function jsonLine(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("|") : asString(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function writeJsonLines(filePath: string, rows: readonly unknown[]) {
  await fs.writeFile(filePath, rows.map(jsonLine).join(""), "utf8");
}

async function fileSha256(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function readJsonLines(filePath: string) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EntryLexemeLink);
}

function makeDiff(
  current: readonly EntryLexemeLink[],
  previous: readonly EntryLexemeLink[] | null,
  previousPackage: string | null,
) {
  if (!previous) {
    return {
      baseline: true,
      previousPackage: null,
      addedRows: current.length,
      removedRows: 0,
      changedContentAtSameRow: 0,
      relocatedSameContent: 0,
      unchangedRows: 0,
    };
  }

  const previousByRow = new Map(previous.map((row) => [row.sourceRow, row]));
  const currentByRow = new Map(current.map((row) => [row.sourceRow, row]));
  const previousByContent = new Map<string, EntryLexemeLink[]>();
  for (const row of previous) {
    const values = previousByContent.get(row.contentSha256) ?? [];
    values.push(row);
    previousByContent.set(row.contentSha256, values);
  }

  let addedRows = 0;
  let changedContentAtSameRow = 0;
  let relocatedSameContent = 0;
  let unchangedRows = 0;
  for (const row of current) {
    const oldAtRow = previousByRow.get(row.sourceRow);
    if (
      oldAtRow?.contentSha256 === row.contentSha256 &&
      oldAtRow.locatorSha256 === row.locatorSha256
    ) {
      unchangedRows += 1;
      continue;
    }
    if (oldAtRow && oldAtRow.contentSha256 !== row.contentSha256) {
      changedContentAtSameRow += 1;
    } else if (
      previousByContent
        .get(row.contentSha256)
        ?.some((old) => old.locatorSha256 !== row.locatorSha256)
    ) {
      relocatedSameContent += 1;
    } else {
      addedRows += 1;
    }
  }

  const removedRows = previous.filter(
    (row) => !currentByRow.has(row.sourceRow),
  ).length;
  return {
    baseline: false,
    previousPackage,
    addedRows,
    removedRows,
    changedContentAtSameRow,
    relocatedSameContent,
    unchangedRows,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const datasetRaw = JSON.parse(await fs.readFile(options.dataset, "utf8"));
  const normalized = normalizeVocabularyImport(datasetRaw);
  const database = new DatabaseSync(options.wordIndex, { readOnly: true });

  const build = database
    .prepare(
      `select *
       from index_build
       where status = 'complete'
       order by completed_at_utc desc
       limit 1`,
    )
    .get() as SqliteRow | undefined;
  if (!build) {
    throw new Error("완료된 단어색인 build를 찾지 못했습니다.");
  }

  const lexemeRows = database
    .prepare(
      `select
         lexeme.lexeme_id,
         lexeme.headword,
         lexeme.normalized_headword,
         lexeme.lexeme_type,
         lexeme.type_status,
         lexeme.lifecycle_status,
         lexeme.content_hash,
         lexeme.pronunciation_ko,
         coalesce(readiness.is_ready, 0) as is_ready,
         coalesce(queue.legacy_ready_claim, 0) as legacy_ready_claim
       from lexeme
       left join v_readiness as readiness
         on readiness.lexeme_id = lexeme.lexeme_id
       left join work_queue as queue
         on queue.lexeme_id = lexeme.lexeme_id`,
    )
    .all() as SqliteRow[];

  const canonicalLexemes: CanonicalLexemeForLinkage[] = lexemeRows.map(
    (row) => ({
      lexemeId: asString(row.lexeme_id),
      headword: asString(row.headword),
      normalizedHeadword: asString(row.normalized_headword),
      lexemeType: asString(row.lexeme_type),
      typeStatus: asString(row.type_status),
      lifecycleStatus: asString(row.lifecycle_status),
      contentHash: asString(row.content_hash),
      pronunciationKo: asNullableString(row.pronunciation_ko),
      isReady: Number(row.is_ready) === 1,
      legacyReadyClaim: Number(row.legacy_ready_claim) === 1,
    }),
  );
  const nonWordCandidates: NonWordCandidate[] = canonicalLexemes
    .filter((lexeme) => lexeme.lexemeType !== "word")
    .map((lexeme) => ({
      lexemeId: lexeme.lexemeId,
      headword: lexeme.headword,
      lexemeType: lexeme.lexemeType,
    }));

  const links = buildEntryLexemeLinks(
    normalized.file.dataset.datasetKey,
    normalized.entries,
    canonicalLexemes,
    nonWordCandidates,
  );
  const eligibility = evaluateBookQuizEligibility(normalized.entries);

  const sourceKey = [
    "wordbook",
    normalized.file.dataset.datasetKey,
    normalized.file.dataset.sourceSha256.toLowerCase(),
  ].join("|");
  const sourceId = stableWordIndexId("source", sourceKey);
  const sourceMetadata = normalized.file.dataset.sourceMetadata;
  const source = {
    source_id: sourceId,
    source_key: sourceKey,
    source_type: sourceMetadata?.sourceType ?? "wordbook",
    title: normalized.file.dataset.title,
    publisher: sourceMetadata?.publisher ?? null,
    edition: normalized.file.dataset.edition,
    curriculum_revision: sourceMetadata?.curriculumRevision ?? null,
    volume: null,
    school_name: null,
    grade_code: sourceMetadata?.gradeCode ?? null,
    academic_year: sourceMetadata?.academicYear ?? null,
    semester: sourceMetadata?.semester ?? null,
    source_relative_path: normalized.file.dataset.sourceLabel,
    source_sha256:
      normalized.file.dataset.sourceSha256.toLowerCase(),
    status: "verified_source_file",
  };

  const exactLinks = links.filter(
    (link) => link.mappingStatus === "exact_headword_unreviewed",
  );
  const exactOccurrences = exactLinks.map((link) => {
    const occurrenceKey = [
      sourceId,
      link.sourceRow,
      link.entryRowSha256.toLowerCase(),
      link.lexemeId,
    ].join("|");
    return {
      occurrence_id: stableWordIndexId("occurrence", occurrenceKey),
      lexeme_id: link.lexemeId,
      source_id: sourceId,
      sense_id: null,
      surface_form: link.headword,
      source_meaning_ko: link.bookMeaningKo,
      day_no: link.unitNumber,
      unit_label: link.unitLabel,
      passage_label: null,
      page_label: null,
      item_label: `source_row:${link.sourceRow}`,
      sequence_no: link.sourceRow,
      occurrence_count: 1,
      locator_status: "verified",
      priority_tier: "P0",
      priority_reason: "wordbook_edition_day_row",
      mapping_status: "exact_headword_unreviewed",
      source_label_raw: `${link.unitLabel} · ${link.entryType}`,
      context_hash: sha256([
        sourceId,
        link.sourceRow,
        link.entryRowSha256,
        link.lexemeId,
      ]).toLowerCase(),
    };
  });

  const unresolvedByHeadword = new Map<
    string,
    {
      normalizedHeadword: string;
      headwords: Set<string>;
      sourceRows: number[];
      units: Set<string>;
      nonWordCandidates: NonWordCandidate[];
      reasonCode: string;
    }
  >();
  for (const link of links.filter(
    (entry) => entry.mappingStatus !== "exact_headword_unreviewed",
  )) {
    const existing = unresolvedByHeadword.get(link.normalizedHeadword) ?? {
      normalizedHeadword: link.normalizedHeadword,
      headwords: new Set<string>(),
      sourceRows: [],
      units: new Set<string>(),
      nonWordCandidates: link.nonWordCandidates,
      reasonCode:
        link.mappingStatus === "ambiguous"
          ? "MULTIPLE_ACTIVE_WORD_LEXEMES"
          : link.nonWordCandidates.length > 0
            ? "EXACT_MATCH_ONLY_NON_WORD_TYPE"
            : "NO_EXACT_ACTIVE_WORD_LEXEME",
    };
    existing.headwords.add(link.headword);
    existing.sourceRows.push(link.sourceRow);
    existing.units.add(link.unitLabel);
    unresolvedByHeadword.set(link.normalizedHeadword, existing);
  }
  const unresolvedRows = [...unresolvedByHeadword.values()]
    .sort((left, right) =>
      left.normalizedHeadword.localeCompare(
        right.normalizedHeadword,
        "en-US",
      ),
    )
    .map((row) => ({
      normalizedHeadword: row.normalizedHeadword,
      headwords: [...row.headwords],
      sourceRows: row.sourceRows.sort((left, right) => left - right),
      units: [...row.units],
      reasonCode: row.reasonCode,
      nonWordCandidates: row.nonWordCandidates.map(
        (candidate) =>
          `${candidate.lexemeType}:${candidate.headword}:${candidate.lexemeId}`,
      ),
    }));

  const exactLexemeIds = new Set(
    exactLinks.flatMap((link) => (link.lexemeId ? [link.lexemeId] : [])),
  );
  const countExact = (query: string) =>
    (database.prepare(query).all() as SqliteRow[]).filter((row) =>
      exactLexemeIds.has(asString(row.lexeme_id)),
    ).length;

  const distinctByQuery = (query: string) =>
    new Set(
      (database.prepare(query).all() as SqliteRow[])
        .map((row) => asString(row.lexeme_id))
        .filter((lexemeId) => exactLexemeIds.has(lexemeId)),
    ).size;

  const enrichment = {
    withSense: distinctByQuery("select distinct lexeme_id from sense"),
    withAnyTag: distinctByQuery(
      "select distinct lexeme_id from lexeme_tag",
    ),
    withPositiveTag: distinctByQuery(
      `select distinct lexeme_id
       from lexeme_tag
       where lower(trim(tag_value)) not in ('', '0', 'false', 'none', 'null')`,
    ),
    withExample: distinctByQuery(
      "select distinct lexeme_id from example",
    ),
    withSchoolOrMockOccurrence: distinctByQuery(
      `select distinct occurrence.lexeme_id
       from occurrence
       join source on source.source_id = occurrence.source_id
       where source.source_type in ('school_exam', 'mock_exam')`,
    ),
    withLegacyCefrEvidence: distinctByQuery(
      `select distinct lexeme_id
       from level_mapping
       where scale_code = 'CEFR'`,
    ),
    withKoreanPronunciation: canonicalLexemes.filter(
      (lexeme) =>
        exactLexemeIds.has(lexeme.lexemeId) &&
        Boolean(lexeme.pronunciationKo),
    ).length,
    positiveMetrics: {
      수능_빈도: countExact(
        "select lexeme_id from lexeme_metric where metric_key = '수능_빈도' and metric_value > 0",
      ),
      내신_빈도: countExact(
        "select lexeme_id from lexeme_metric where metric_key = '내신_빈도' and metric_value > 0",
      ),
      학교교과서_빈도: countExact(
        "select lexeme_id from lexeme_metric where metric_key = '학교교과서_빈도' and metric_value > 0",
      ),
    },
  };

  const uniqueExactHeadwords = new Set(
    exactLinks.map((link) => link.normalizedHeadword),
  ).size;
  const uniqueUnresolvedHeadwords = unresolvedRows.length;
  const mappingAudit = {
    schemaVersion: 1,
    ruleVersion: "normalized-headword-exact-v1",
    datasetKey: normalized.file.dataset.datasetKey,
    datasetRows: links.length,
    uniqueDatasetHeadwords: normalized.audit.uniqueHeadwordCount,
    exactLinkedRows: exactLinks.length,
    unresolvedRows:
      links.filter((link) => link.mappingStatus === "unresolved").length,
    ambiguousRows:
      links.filter((link) => link.mappingStatus === "ambiguous").length,
    exactLinkedUniqueHeadwords: uniqueExactHeadwords,
    unresolvedUniqueHeadwords: uniqueUnresolvedHeadwords,
    exactUniquePercent: Number(
      (
        (uniqueExactHeadwords / normalized.audit.uniqueHeadwordCount) *
        100
      ).toFixed(2),
    ),
    exactCanonicalReady: new Set(
      exactLinks
        .filter((link) => link.canonicalIsReady)
        .map((link) => link.lexemeId),
    ).size,
    exactLegacyReadyClaim: new Set(
      exactLinks
        .filter((link) => link.legacyReadyClaim)
        .map((link) => link.lexemeId),
    ).size,
    enrichment,
  };

  const eligibilityByStatus = {
    englishToKoreanEligible: eligibility.filter(
      (row) => row.englishToKoreanStatus === "eligible",
    ).length,
    englishToKoreanReviewRequired: eligibility.filter(
      (row) => row.englishToKoreanStatus === "review_required",
    ).length,
    koreanToEnglishEligible: eligibility.filter(
      (row) => row.koreanToEnglishStatus === "eligible",
    ).length,
    koreanToEnglishReviewRequired: eligibility.filter(
      (row) => row.koreanToEnglishStatus === "review_required",
    ).length,
    combinedEligible: eligibility.filter(
      (row) => row.combinedStatus === "eligible",
    ).length,
    combinedReviewRequired: eligibility.filter(
      (row) => row.combinedStatus === "review_required",
    ).length,
  };
  const headwordMeaningConflicts = {
    canonicalNfkc: summarizeHeadwordMeaningConflicts(
      normalized.entries,
      "canonical",
    ),
    legacyAppNfc: summarizeHeadwordMeaningConflicts(
      normalized.entries,
      "legacy_nfc",
    ),
    normalizationOnlyFalsePositiveHeadwords: [
      "affect",
      "found",
      "attribute",
    ],
  };

  await fs.mkdir(options.outDir, { recursive: true });
  const outputFiles = {
    source: "source.json",
    links: "entry_lexeme_link.jsonl",
    occurrences: "occurrence_exact.jsonl",
    eligibility: "entry_quiz_eligibility.jsonl",
    unresolved: "unresolved_headword_queue.csv",
    mappingAudit: "mapping_audit.json",
    diff: "diff.json",
  };

  await fs.writeFile(
    path.join(options.outDir, outputFiles.source),
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8",
  );
  await writeJsonLines(
    path.join(options.outDir, outputFiles.links),
    links,
  );
  await writeJsonLines(
    path.join(options.outDir, outputFiles.occurrences),
    exactOccurrences,
  );
  await writeJsonLines(
    path.join(options.outDir, outputFiles.eligibility),
    eligibility,
  );

  const unresolvedHeader = [
    "정규화표제어",
    "표제어표기",
    "교재행",
    "단원",
    "사유코드",
    "비단어유형후보",
  ];
  const unresolvedCsv = [
    unresolvedHeader.map(csvCell).join(","),
    ...unresolvedRows.map((row) =>
      [
        row.normalizedHeadword,
        row.headwords,
        row.sourceRows,
        row.units,
        row.reasonCode,
        row.nonWordCandidates,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
  await fs.writeFile(
    path.join(options.outDir, outputFiles.unresolved),
    `\uFEFF${unresolvedCsv}\r\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(options.outDir, outputFiles.mappingAudit),
    `${JSON.stringify(
      {
        ...mappingAudit,
        quizEligibility: eligibilityByStatus,
        headwordMeaningConflicts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const previousLinks = options.previousDir
    ? await readJsonLines(
        path.join(options.previousDir, outputFiles.links),
      )
    : null;
  const diff = makeDiff(
    links,
    previousLinks,
    options.previousDir ? path.basename(options.previousDir) : null,
  );
  await fs.writeFile(
    path.join(options.outDir, outputFiles.diff),
    `${JSON.stringify(diff, null, 2)}\n`,
    "utf8",
  );

  const fileRows: Record<string, number> = {
    [outputFiles.source]: 1,
    [outputFiles.links]: links.length,
    [outputFiles.occurrences]: exactOccurrences.length,
    [outputFiles.eligibility]: eligibility.length,
    [outputFiles.unresolved]: unresolvedRows.length,
    [outputFiles.mappingAudit]: 1,
    [outputFiles.diff]: 1,
  };
  const files = [];
  for (const fileName of Object.values(outputFiles)) {
    files.push({
      file: fileName,
      rows: fileRows[fileName],
      sha256: await fileSha256(path.join(options.outDir, fileName)),
    });
  }
  const packageSnapshotSha256 = sha256(
    files.map((file) => [file.file, file.rows, file.sha256]),
  );
  const manifest = {
    schemaVersion: 1,
    packageType: "canonical-vocab-app-link",
    generatedAtUtc: new Date().toISOString(),
    dataset: {
      ...normalized.file.dataset,
      sourceSha256:
        normalized.file.dataset.sourceSha256.toUpperCase(),
    },
    wordIndex: {
      buildId: asString(build.build_id),
      schemaVersion: asString(build.schema_version),
      builderVersion: asString(build.builder_version),
      inputFileCount: Number(build.input_file_count),
      inputSnapshotSha256: asString(
        build.input_snapshot_sha256,
      ).toUpperCase(),
    },
    rules: {
      mapping: "normalized-headword-exact-v1",
      eligibility: "book-meaning-eligibility-v1",
      canonicalMeaningOverwriteAllowed: false,
    },
    counts: {
      ...mappingAudit,
      quizEligibility: eligibilityByStatus,
      headwordMeaningConflicts,
    },
    files,
    packageSnapshotSha256,
  };
  await fs.writeFile(
    path.join(options.outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const report = `# 능률 VOCA 2025 ↔ 공통 단어원장 연결 검증

- 원본: ${normalized.file.dataset.title} ${normalized.file.dataset.edition}
- 원본 SHA-256: ${normalized.file.dataset.sourceSha256}
- 교재 행: ${links.length}
- 고유 표제어: ${normalized.audit.uniqueHeadwordCount}
- 정확 연결: ${exactLinks.length}행 / ${uniqueExactHeadwords}개 표제어
- 미연결: ${mappingAudit.unresolvedRows}행 / ${uniqueUnresolvedHeadwords}개 표제어
- 다중 word 후보 충돌: ${mappingAudit.ambiguousRows}행
- 현재 공통원장 준비완료: ${mappingAudit.exactCanonicalReady}개
- 과거 검수표시(재인증 필요): ${mappingAudit.exactLegacyReadyClaim}개
- 한영·영한 모두 자동 사용 가능: ${eligibilityByStatus.combinedEligible}행
- 추가 검토 필요: ${eligibilityByStatus.combinedReviewRequired}행

정확 표제어 연결은 공통 뜻 승인과 동일하지 않다. 교재 뜻은 별도 occurrence로 보존하며 canonical sense를 덮어쓰지 않는다. 영영·예문형 문제는 현재 준비완료가 0개이므로 차단 상태를 유지한다.
`;
  await fs.writeFile(
    path.join(options.outDir, "README.md"),
    report,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        outDir: options.outDir,
        packageSnapshotSha256,
        mappingAudit,
        quizEligibility: eligibilityByStatus,
        headwordMeaningConflicts,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
