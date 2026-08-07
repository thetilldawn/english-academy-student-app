import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { sha256 } from "@/lib/vocab/canonical-linkage";
import { resolveBookMeaningCapability } from "@/lib/vocab/vocab-link-import-policy";

type ImportMode = "sample" | "table" | "status" | "finalize";
type ImportTable =
  | "occurrence"
  | "vocab_entry_link"
  | "vocab_entry_mapping_candidate"
  | "vocab_entry_quiz_eligibility";

type CliOptions = {
  packageDir: string;
  mode: ImportMode;
  table: ImportTable | null;
  apply: boolean;
};

type ManifestFile = {
  file: string;
  rows: number;
  sha256: string;
};

type Manifest = {
  schemaVersion: number;
  packageType: string;
  generatedAtUtc: string;
  dataset: {
    datasetKey: string;
    sourceSha256: string;
    expectedRows: number;
  };
  wordIndex: {
    buildId: string;
    inputSnapshotSha256: string;
  };
  rules: {
    mapping: string;
    eligibility: string;
    canonicalMeaningOverwriteAllowed: boolean;
  };
  counts: {
    exactLinkedRows: number;
    unresolvedRows: number;
    ambiguousRows: number;
    quizEligibility: {
      englishToKoreanEligible: number;
      englishToKoreanReviewRequired: number;
      koreanToEnglishEligible: number;
      koreanToEnglishReviewRequired: number;
    };
  };
  files: ManifestFile[];
  packageSnapshotSha256: string;
};

type SourceRow = {
  source_id: string;
  source_key: string;
  source_type: string;
  title: string;
  publisher: string | null;
  edition: string | null;
  curriculum_revision: string | null;
  volume: string | null;
  school_name: string | null;
  grade_code: string | null;
  academic_year: number | null;
  semester: number | null;
  source_relative_path: string | null;
  source_sha256: string;
  status: string;
};

type NonWordCandidate = {
  lexemeId: string;
  headword: string;
  lexemeType: string;
};

type LinkPackageRow = {
  sourceRow: number;
  entryRowSha256: string;
  contentSha256: string;
  locatorSha256: string;
  headword: string;
  normalizedHeadword: string;
  unitLabel: string;
  unitNumber: number | null;
  positionInUnit: number;
  entryType: string;
  bookMeaningKo: string;
  mappingStatus:
    | "exact_headword_unreviewed"
    | "ambiguous"
    | "unresolved";
  mappingMethod: string;
  lexemeId: string | null;
  lexemeContentHash: string | null;
  canonicalTypeStatus: string | null;
  canonicalIsReady: boolean;
  legacyReadyClaim: boolean;
  nonWordCandidates: NonWordCandidate[];
};

type OccurrenceRow = {
  occurrence_id: string;
  lexeme_id: string;
  source_id: string;
  sense_id: null;
  surface_form: string;
  source_meaning_ko: string;
  day_no: number | null;
  unit_label: string;
  passage_label: string | null;
  page_label: string | null;
  item_label: string;
  sequence_no: number;
  occurrence_count: number;
  locator_status: string;
  priority_tier: string;
  priority_reason: string;
  mapping_status: string;
  source_label_raw: string;
  context_hash: string;
};

type EligibilityPackageRow = {
  sourceRow: number;
  entryRowSha256: string;
  englishToKoreanStatus: "eligible" | "review_required";
  koreanToEnglishStatus: "eligible" | "review_required";
  combinedStatus: "eligible" | "review_required";
  reasonCodes: string[];
};

type RemoteDataset = {
  id: string;
  dataset_key: string;
  source_sha256: string;
  row_count: number;
  is_active: boolean;
};

type RemoteEntry = {
  id: number;
  dataset_id: string;
  source_row: number;
  row_sha256: string;
  headword: string;
  headword_normalized: string;
};

type ImportStatus = {
  datasetId: string;
  sourceId: string;
  status: "loading" | "complete" | "failed";
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
  mappingCounts: Record<string, number>;
  canonicalSenseAutoLinks: number;
  batchCount: number;
};

type ImportRow = Record<string, unknown>;

const importTables: readonly ImportTable[] = [
  "occurrence",
  "vocab_entry_link",
  "vocab_entry_mapping_candidate",
  "vocab_entry_quiz_eligibility",
];

const batchSizes: Record<ImportTable, number> = {
  occurrence: 400,
  vocab_entry_link: 400,
  vocab_entry_mapping_candidate: 100,
  vocab_entry_quiz_eligibility: 400,
};

function parseOptions(args: string[]): CliOptions {
  let packageDir = "";
  let mode: ImportMode | null = null;
  let table: ImportTable | null = null;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--package-dir") {
      packageDir = args[index + 1] ?? "";
      index += 1;
    } else if (argument === "--mode") {
      const value = args[index + 1] as ImportMode | undefined;
      if (
        !value ||
        !["sample", "table", "status", "finalize"].includes(value)
      ) {
        throw new Error("잘못된 --mode 값입니다.");
      }
      mode = value;
      index += 1;
    } else if (argument === "--table") {
      const value = args[index + 1] as ImportTable | undefined;
      if (!value || !importTables.includes(value)) {
        throw new Error("잘못된 --table 값입니다.");
      }
      table = value;
      index += 1;
    } else if (argument === "--apply") {
      apply = true;
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${argument}`);
    }
  }

  if (!packageDir || !mode) {
    throw new Error(
      "사용법: npm run import:vocab-link -- --package-dir <패키지> --mode <sample|table|status|finalize> [--table <테이블>] [--apply]",
    );
  }
  if (mode === "table" && !table) {
    throw new Error("--mode table에는 --table이 필요합니다.");
  }
  if (mode !== "table" && table) {
    throw new Error("--table은 --mode table에서만 사용합니다.");
  }
  if (mode !== "status" && !apply) {
    throw new Error("데이터를 쓰는 모드에는 --apply를 명시해야 합니다.");
  }

  return {
    packageDir: path.resolve(packageDir),
    mode,
    table,
    apply,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readJsonLines<T>(filePath: string) {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function fileSha256(filePath: string) {
  return createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex")
    .toUpperCase();
}

async function countFileRows(filePath: string) {
  const text = await fs.readFile(filePath, "utf8");
  if (filePath.endsWith(".jsonl")) {
    return text.split(/\r?\n/).filter(Boolean).length;
  }
  if (filePath.endsWith(".csv")) {
    return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
  }
  return 1;
}

function occurrenceSourceRow(row: OccurrenceRow) {
  const match = /^source_row:(\d+)$/.exec(row.item_label);
  assert(match, `잘못된 occurrence item_label: ${row.item_label}`);
  return Number(match[1]);
}

function reasonCodesForMode(
  row: EligibilityPackageRow,
  mode: "book_meaning_en_to_ko" | "book_meaning_ko_to_en",
) {
  if (
    mode === "book_meaning_en_to_ko" &&
    row.englishToKoreanStatus === "eligible"
  ) {
    return [];
  }
  if (
    mode === "book_meaning_ko_to_en" &&
    row.koreanToEnglishStatus === "eligible"
  ) {
    return [];
  }
  return row.reasonCodes;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY가 필요합니다.",
    );
  }

  const manifest = await readJson<Manifest>(
    path.join(options.packageDir, "manifest.json"),
  );
  assert(manifest.schemaVersion === 1, "지원하지 않는 패키지 버전입니다.");
  assert(
    manifest.packageType === "canonical-vocab-app-link",
    "단어 연결 패키지가 아닙니다.",
  );
  assert(
    manifest.rules.canonicalMeaningOverwriteAllowed === false,
    "교재 뜻의 canonical sense 자동 덮어쓰기는 허용되지 않습니다.",
  );

  const verifiedFiles = [];
  for (const file of manifest.files) {
    const filePath = path.join(options.packageDir, file.file);
    const actualSha256 = await fileSha256(filePath);
    const actualRows = await countFileRows(filePath);
    assert(actualSha256 === file.sha256, `${file.file} SHA가 다릅니다.`);
    assert(actualRows === file.rows, `${file.file} 행 수가 다릅니다.`);
    verifiedFiles.push({
      file: file.file,
      rows: actualRows,
      sha256: actualSha256,
    });
  }
  assert(
    sha256(
      verifiedFiles.map((file) => [file.file, file.rows, file.sha256]),
    ) === manifest.packageSnapshotSha256,
    "연결 패키지 스냅샷 SHA가 다릅니다.",
  );

  const [source, packageLinks, occurrences, packageEligibility] =
    await Promise.all([
      readJson<SourceRow>(path.join(options.packageDir, "source.json")),
      readJsonLines<LinkPackageRow>(
        path.join(options.packageDir, "entry_lexeme_link.jsonl"),
      ),
      readJsonLines<OccurrenceRow>(
        path.join(options.packageDir, "occurrence_exact.jsonl"),
      ),
      readJsonLines<EligibilityPackageRow>(
        path.join(options.packageDir, "entry_quiz_eligibility.jsonl"),
      ),
    ]);

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { data: datasetData, error: datasetError } = await supabase
    .from("vocab_datasets")
    .select("id,dataset_key,source_sha256,row_count,is_active")
    .eq("dataset_key", manifest.dataset.datasetKey)
    .eq("is_active", true)
    .single();
  if (datasetError) {
    throw new Error(`활성 단어장 조회 실패: ${datasetError.message}`);
  }
  const dataset = datasetData as RemoteDataset;
  assert(
    dataset.source_sha256 === manifest.dataset.sourceSha256,
    "앱 단어장과 연결 패키지의 원본 SHA가 다릅니다.",
  );
  assert(
    dataset.row_count === manifest.dataset.expectedRows,
    "앱 단어장과 연결 패키지의 행 수가 다릅니다.",
  );

  const remoteEntries: RemoteEntry[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("vocab_entries")
      .select(
        "id,dataset_id,source_row,row_sha256,headword,headword_normalized",
      )
      .eq("dataset_id", dataset.id)
      .order("source_row", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(`앱 단어 행 조회 실패: ${error.message}`);
    }
    const page = (data ?? []) as RemoteEntry[];
    remoteEntries.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  assert(
    remoteEntries.length === manifest.dataset.expectedRows,
    "원격 앱 단어 행 수가 패키지와 다릅니다.",
  );
  const remoteBySourceRow = new Map(
    remoteEntries.map((entry) => [entry.source_row, entry]),
  );
  const linkBySourceRow = new Map(
    packageLinks.map((row) => [row.sourceRow, row]),
  );
  const eligibilityBySourceRow = new Map(
    packageEligibility.map((row) => [row.sourceRow, row]),
  );
  assert(
    remoteBySourceRow.size === remoteEntries.length &&
      linkBySourceRow.size === packageLinks.length &&
      eligibilityBySourceRow.size === packageEligibility.length,
    "sourceRow 중복이 있습니다.",
  );
  assert(
    packageLinks.length === manifest.dataset.expectedRows &&
      packageEligibility.length === manifest.dataset.expectedRows,
    "연결 또는 eligibility 전체 행이 누락됐습니다.",
  );

  for (const entry of remoteEntries) {
    const link = linkBySourceRow.get(entry.source_row);
    const eligibility = eligibilityBySourceRow.get(entry.source_row);
    assert(link, `연결 행 누락: sourceRow ${entry.source_row}`);
    assert(
      eligibility,
      `eligibility 행 누락: sourceRow ${entry.source_row}`,
    );
    assert(
      entry.row_sha256 === link.entryRowSha256 &&
        entry.row_sha256 === eligibility.entryRowSha256,
      `앱 단어 행 SHA 불일치: sourceRow ${entry.source_row}`,
    );
  }

  const occurrenceBySourceRow = new Map<number, OccurrenceRow>();
  for (const occurrence of occurrences) {
    const sourceRow = occurrenceSourceRow(occurrence);
    assert(
      !occurrenceBySourceRow.has(sourceRow),
      `occurrence sourceRow 중복: ${sourceRow}`,
    );
    assert(
      occurrence.source_id === source.source_id &&
        occurrence.sense_id === null,
      `occurrence 출처 또는 sense 위반: sourceRow ${sourceRow}`,
    );
    occurrenceBySourceRow.set(sourceRow, occurrence);
  }

  const exactLinks = packageLinks.filter(
    (row) => row.mappingStatus === "exact_headword_unreviewed",
  );
  assert(
    exactLinks.length === manifest.counts.exactLinkedRows &&
      occurrences.length === exactLinks.length,
    "정확 연결과 occurrence 수가 다릅니다.",
  );
  for (const link of packageLinks) {
    const occurrence = occurrenceBySourceRow.get(link.sourceRow);
    if (link.mappingStatus === "exact_headword_unreviewed") {
      assert(
        link.lexemeId &&
          link.lexemeContentHash &&
          occurrence &&
          occurrence.lexeme_id === link.lexemeId,
        `정확 연결 occurrence 불일치: sourceRow ${link.sourceRow}`,
      );
    } else {
      assert(
        link.lexemeId === null &&
          link.lexemeContentHash === null &&
          !occurrence,
        `미연결 행에 canonical 연결이 있습니다: sourceRow ${link.sourceRow}`,
      );
    }
  }

  const linkRows: ImportRow[] = packageLinks.map((link) => {
    const entry = remoteBySourceRow.get(link.sourceRow);
    assert(entry, `원격 단어 행 누락: sourceRow ${link.sourceRow}`);
    const occurrence = occurrenceBySourceRow.get(link.sourceRow);
    return {
      vocab_entry_id: entry.id,
      dataset_id: dataset.id,
      entry_row_sha256: link.entryRowSha256,
      source_id: source.source_id,
      lexeme_id: link.lexemeId,
      occurrence_id: occurrence?.occurrence_id ?? null,
      mapping_status: link.mappingStatus,
      mapping_method: link.mappingMethod,
      mapping_rule_version: manifest.rules.mapping,
      canonical_content_hash: link.lexemeContentHash,
      candidate_count: link.nonWordCandidates.length,
      evidence: {
        sourceRow: link.sourceRow,
        contentSha256: link.contentSha256,
        locatorSha256: link.locatorSha256,
        normalizedHeadword: link.normalizedHeadword,
        canonicalTypeStatus: link.canonicalTypeStatus,
        canonicalIsReady: link.canonicalIsReady,
        legacyReadyClaim: link.legacyReadyClaim,
      },
      mapped_at_utc: manifest.generatedAtUtc,
      reviewed_at_utc: null,
    };
  });

  const candidateRows: ImportRow[] = packageLinks.flatMap((link) => {
    const entry = remoteBySourceRow.get(link.sourceRow);
    assert(entry, `원격 단어 행 누락: sourceRow ${link.sourceRow}`);
    return link.nonWordCandidates.map((candidate, index) => ({
      vocab_entry_id: entry.id,
      candidate_lexeme_id: candidate.lexemeId,
      candidate_rank: index + 1,
      candidate_type: candidate.lexemeType,
      reason_code: "same_normalized_headword_non_word_lexeme",
      score: 1,
    }));
  });

  const eligibilityRows: ImportRow[] = packageEligibility.flatMap(
    (eligibility) => {
      const entry = remoteBySourceRow.get(eligibility.sourceRow);
      const link = linkBySourceRow.get(eligibility.sourceRow);
      assert(
        entry && link,
        `eligibility 연결 누락: sourceRow ${eligibility.sourceRow}`,
      );
      return [
        {
          vocab_entry_id: entry.id,
          dataset_id: dataset.id,
          quiz_mode: "book_meaning_en_to_ko",
          status: eligibility.englishToKoreanStatus,
          reason_codes: reasonCodesForMode(
            eligibility,
            "book_meaning_en_to_ko",
          ),
          input_content_hash: eligibility.entryRowSha256,
          canonical_lexeme_id: link.lexemeId,
          canonical_content_hash: link.lexemeContentHash,
          content_review_id: null,
          rule_version: manifest.rules.eligibility,
          evaluated_at_utc: manifest.generatedAtUtc,
        },
        {
          vocab_entry_id: entry.id,
          dataset_id: dataset.id,
          quiz_mode: "book_meaning_ko_to_en",
          status: eligibility.koreanToEnglishStatus,
          reason_codes: reasonCodesForMode(
            eligibility,
            "book_meaning_ko_to_en",
          ),
          input_content_hash: eligibility.entryRowSha256,
          canonical_lexeme_id: link.lexemeId,
          canonical_content_hash: link.lexemeContentHash,
          content_review_id: null,
          rule_version: manifest.rules.eligibility,
          evaluated_at_utc: manifest.generatedAtUtc,
        },
      ];
    },
  );

  const englishToKoreanCapability = resolveBookMeaningCapability(
    manifest.counts.quizEligibility.englishToKoreanEligible,
    manifest.counts.quizEligibility.englishToKoreanReviewRequired,
    "duplicate_headword_meaning_conflict_excluded",
  );
  const koreanToEnglishCapability = resolveBookMeaningCapability(
    manifest.counts.quizEligibility.koreanToEnglishEligible,
    manifest.counts.quizEligibility.koreanToEnglishReviewRequired,
    "duplicate_prompt_answer_conflict_excluded",
  );
  const capabilities: ImportRow[] = [
    {
      dataset_id: dataset.id,
      quiz_mode: "book_meaning_en_to_ko",
      status: englishToKoreanCapability.status,
      eligible_entry_count:
        manifest.counts.quizEligibility.englishToKoreanEligible,
      excluded_entry_count:
        manifest.counts.quizEligibility.englishToKoreanReviewRequired,
      reason_code: englishToKoreanCapability.reasonCode,
    },
    {
      dataset_id: dataset.id,
      quiz_mode: "book_meaning_ko_to_en",
      status: koreanToEnglishCapability.status,
      eligible_entry_count:
        manifest.counts.quizEligibility.koreanToEnglishEligible,
      excluded_entry_count:
        manifest.counts.quizEligibility.koreanToEnglishReviewRequired,
      reason_code: koreanToEnglishCapability.reasonCode,
    },
    ...[
      "canonical_definition_to_headword",
      "canonical_example_to_headword",
      "school_context_to_headword",
      "mock_exam_context_to_headword",
    ].map((quizMode) => ({
      dataset_id: dataset.id,
      quiz_mode: quizMode,
      status: "blocked",
      eligible_entry_count: 0,
      excluded_entry_count: manifest.dataset.expectedRows,
      reason_code: "canonical_content_not_ready",
    })),
  ].map((capability) => ({
    ...capability,
    dataset_source_sha256: manifest.dataset.sourceSha256,
    canonical_snapshot_sha256:
      manifest.wordIndex.inputSnapshotSha256.toUpperCase(),
    rule_version: manifest.rules.eligibility,
    evaluated_at_utc: manifest.generatedAtUtc,
    details: {
      packageSnapshotSha256: manifest.packageSnapshotSha256,
      exactLinkedRows: manifest.counts.exactLinkedRows,
      unresolvedRows: manifest.counts.unresolvedRows,
      ambiguousRows: manifest.counts.ambiguousRows,
    },
  }));

  const tableRows: Record<ImportTable, ImportRow[]> = {
    occurrence: occurrences as unknown as ImportRow[],
    vocab_entry_link: linkRows,
    vocab_entry_mapping_candidate: candidateRows,
    vocab_entry_quiz_eligibility: eligibilityRows,
  };
  const expectedCounts = {
    occurrence: occurrences.length,
    vocab_entry_link: linkRows.length,
    vocab_entry_mapping_candidate: candidateRows.length,
    vocab_entry_quiz_eligibility: eligibilityRows.length,
    vocab_dataset_capabilities: capabilities.length,
  };
  assert(
    expectedCounts.vocab_entry_link === manifest.dataset.expectedRows &&
      expectedCounts.vocab_entry_quiz_eligibility ===
        manifest.dataset.expectedRows * 2 &&
      expectedCounts.vocab_entry_mapping_candidate ===
        packageLinks.reduce(
          (count, link) => count + link.nonWordCandidates.length,
          0,
        ) &&
      expectedCounts.vocab_dataset_capabilities === 6,
    "예상 연결 건수가 승인된 명세와 다릅니다.",
  );

  const getStatus = async () => {
    const { data, error } = await supabase.rpc(
      "get_vocab_link_import_status",
      { p_dataset_id: dataset.id },
    );
    if (error) {
      throw new Error(`연결 가져오기 상태 조회 실패: ${error.message}`);
    }
    return data as ImportStatus;
  };

  if (options.mode === "status") {
    console.log(JSON.stringify(await getStatus(), null, 2));
    return;
  }

  const { data: beginData, error: beginError } = await supabase.rpc(
    "begin_vocab_link_import",
    {
      p_dataset_key: manifest.dataset.datasetKey,
      p_build_id: manifest.wordIndex.buildId,
      p_package_snapshot_sha256: manifest.packageSnapshotSha256,
      p_source: source,
      p_expected_counts: expectedCounts,
    },
  );
  if (beginError) {
    throw new Error(`연결 가져오기 시작 실패: ${beginError.message}`);
  }

  const importTable = async (
    table: ImportTable,
    firstBatchOnly: boolean,
  ) => {
    const rows = tableRows[table];
    const batchSize = batchSizes[table];
    const before = await getStatus();
    if (
      table === "vocab_entry_link" &&
      before.actualCounts.occurrence !== expectedCounts.occurrence
    ) {
      throw new Error("occurrence 전체 반영 후 연결표를 가져와야 합니다.");
    }
    if (
      ["vocab_entry_mapping_candidate", "vocab_entry_quiz_eligibility"].includes(
        table,
      ) &&
      before.actualCounts.vocab_entry_link !==
        expectedCounts.vocab_entry_link
    ) {
      throw new Error("연결표 전체 반영 후 후속 표를 가져와야 합니다.");
    }

    const totalBatches = Math.ceil(rows.length / batchSize);
    const batchLimit = firstBatchOnly ? Math.min(1, totalBatches) : totalBatches;
    for (let batchIndex = 0; batchIndex < batchLimit; batchIndex += 1) {
      const batchRows = rows.slice(
        batchIndex * batchSize,
        (batchIndex + 1) * batchSize,
      );
      const { data, error } = await supabase.rpc(
        "import_vocab_link_batch",
        {
          p_dataset_id: dataset.id,
          p_table_name: table,
          p_batch_no: batchIndex + 1,
          p_rows: batchRows,
        },
      );
      if (error) {
        throw new Error(
          `${table} ${batchIndex + 1}/${totalBatches} 배치 실패: ${error.message}`,
        );
      }
      const result = data as {
        receivedRows: number;
        insertedRows: number;
        idempotent: boolean;
      };
      assert(
        result.receivedRows === batchRows.length &&
          result.insertedRows === batchRows.length,
        `${table} ${batchIndex + 1} 배치 행 수가 다릅니다.`,
      );
      console.log(
        JSON.stringify({
          table,
          batch: batchIndex + 1,
          totalBatches,
          rows: batchRows.length,
          idempotent: result.idempotent,
        }),
      );
    }

    const after = await getStatus();
    const expectedAfter = firstBatchOnly
      ? Math.min(batchSize, rows.length)
      : rows.length;
    assert(
      after.actualCounts[table] === expectedAfter,
      `${table} 원격 행 수가 다릅니다: ${after.actualCounts[table] ?? 0}/${expectedAfter}`,
    );
    return after;
  };

  if (options.mode === "sample") {
    const status = await importTable("occurrence", true);
    console.log(
      JSON.stringify(
        {
          mode: "sample",
          beginData,
          packageSnapshotSha256: manifest.packageSnapshotSha256,
          importedTable: "occurrence",
          importedRows: status.actualCounts.occurrence,
          canonicalSenseAutoLinks: status.canonicalSenseAutoLinks,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (options.mode === "table") {
    const table = options.table as ImportTable;
    console.log(
      JSON.stringify(
        {
          mode: "table",
          beginData,
          table,
          status: await importTable(table, false),
        },
        null,
        2,
      ),
    );
    return;
  }

  const beforeFinalize = await getStatus();
  for (const [table, expected] of Object.entries(expectedCounts)) {
    if (table === "vocab_dataset_capabilities") {
      continue;
    }
    assert(
      beforeFinalize.actualCounts[table] === expected,
      `최종 확정 전 ${table} 행 수가 다릅니다.`,
    );
  }
  assert(
    beforeFinalize.canonicalSenseAutoLinks === 0,
    "교재 뜻이 canonical sense에 자동 연결됐습니다.",
  );
  const { data: finalizeData, error: finalizeError } = await supabase.rpc(
    "finalize_vocab_link_import",
    {
      p_dataset_id: dataset.id,
      p_capabilities: capabilities,
    },
  );
  if (finalizeError) {
    throw new Error(`연결 가져오기 최종 확정 실패: ${finalizeError.message}`);
  }
  console.log(
    JSON.stringify(
      {
        mode: "finalize",
        beginData,
        result: finalizeData,
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
