import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

type ImportMode = "sample" | "table" | "status" | "finalize";

type CliOptions = {
  wordIndex: string;
  mode: ImportMode;
  table: string | null;
  apply: boolean;
};

type SqliteRow = Record<string, unknown>;

const tableConfig = {
  schema_meta: { orderBy: "meta_key", batchSize: 100 },
  input_file_manifest: {
    orderBy: "build_id, relative_path",
    batchSize: 400,
  },
  lexeme: { orderBy: "lexeme_id", batchSize: 300 },
  source: { orderBy: "source_id", batchSize: 100 },
  sense: { orderBy: "sense_id", batchSize: 300 },
  etymology: { orderBy: "etymology_id", batchSize: 300 },
  occurrence: { orderBy: "occurrence_id", batchSize: 300 },
  relation: { orderBy: "relation_id", batchSize: 400 },
  relation_evidence: {
    orderBy: "relation_evidence_id",
    batchSize: 250,
  },
  example: { orderBy: "example_id", batchSize: 300 },
  review: { orderBy: "review_id", batchSize: 300 },
  raw_pointer: { orderBy: "raw_pointer_id", batchSize: 200 },
  level_mapping: { orderBy: "level_mapping_id", batchSize: 300 },
  type_decision: { orderBy: "type_decision_id", batchSize: 300 },
  data_issue: { orderBy: "data_issue_id", batchSize: 250 },
  pipeline_rule: { orderBy: "stage, rule_version", batchSize: 100 },
  legacy_freeze: { orderBy: "relative_path", batchSize: 100 },
  work_queue: { orderBy: "queue_rank", batchSize: 400 },
  lexeme_tag: {
    orderBy: "lexeme_id, tag_key, tag_value",
    batchSize: 400,
  },
  lexeme_metric: {
    orderBy: "lexeme_id, metric_key",
    batchSize: 400,
  },
} as const;

type ImportTable = keyof typeof tableConfig;

const sampleTables: ImportTable[] = [
  "schema_meta",
  "input_file_manifest",
  "lexeme",
  "source",
  "pipeline_rule",
  "legacy_freeze",
];

const prerequisites: Partial<Record<ImportTable, ImportTable[]>> = {
  sense: ["lexeme"],
  etymology: ["lexeme"],
  occurrence: ["lexeme", "source", "sense"],
  relation: ["lexeme"],
  relation_evidence: ["relation"],
  example: ["lexeme", "sense", "source"],
  review: ["lexeme"],
  raw_pointer: ["lexeme"],
  level_mapping: ["lexeme"],
  type_decision: ["lexeme"],
  work_queue: ["lexeme"],
  lexeme_tag: ["lexeme"],
  lexeme_metric: ["lexeme"],
};

const booleanColumns: Partial<Record<ImportTable, readonly string[]>> = {
  type_decision: ["requires_human_review"],
  data_issue: ["blocks_readiness"],
  pipeline_rule: ["is_current"],
  legacy_freeze: ["execution_allowed"],
  work_queue: ["requires_recertification", "legacy_ready_claim"],
};

const jsonColumns: Partial<Record<ImportTable, readonly string[]>> = {
  review: ["findings_json"],
};

function parseOptions(args: string[]): CliOptions {
  let wordIndex = "";
  let mode: ImportMode | null = null;
  let table: string | null = null;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--word-index") {
      wordIndex = args[index + 1] ?? "";
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
      table = args[index + 1] ?? "";
      index += 1;
    } else if (argument === "--apply") {
      apply = true;
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${argument}`);
    }
  }

  if (!wordIndex || !mode) {
    throw new Error(
      "사용법: npm run import:word-index -- --word-index <sqlite> --mode <sample|table|status|finalize> [--table <표>] [--apply]",
    );
  }
  if (
    mode === "table" &&
    (!table || !(table in tableConfig))
  ) {
    throw new Error(
      `--mode table에는 --table이 필요합니다: ${Object.keys(tableConfig).join(", ")}`,
    );
  }
  if (mode !== "table" && table) {
    throw new Error("--table은 --mode table에서만 사용합니다.");
  }
  if (["sample", "table", "finalize"].includes(mode) && !apply) {
    throw new Error("쓰기 모드는 --apply를 명시해야 합니다.");
  }

  return {
    wordIndex: path.resolve(wordIndex),
    mode,
    table,
    apply,
  };
}

function parseJson(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value);
}

function normalizeRows(table: ImportTable, rows: readonly SqliteRow[]) {
  const booleanKeys = new Set(booleanColumns[table] ?? []);
  const jsonKeys = new Set(jsonColumns[table] ?? []);
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (booleanKeys.has(key)) {
          return [key, Number(value) === 1];
        }
        if (jsonKeys.has(key)) {
          return [key, parseJson(value)];
        }
        return [key, value];
      }),
    ),
  );
}

function payloadSha256(rows: readonly unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify(rows), "utf8")
    .digest("hex")
    .toUpperCase();
}

async function streamFileSha256(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex").toUpperCase();
}

function tableCounts(database: DatabaseSync) {
  const counts: Record<string, number> = {};
  for (const table of Object.keys(tableConfig) as ImportTable[]) {
    counts[table] = Number(
      (
        database
          .prepare(`select count(*) as count from "${table}"`)
          .get() as SqliteRow
      ).count,
    );
  }
  counts.v_readiness_ready = Number(
    (
      database
        .prepare(
          "select count(*) as count from v_readiness where is_ready = 1",
        )
        .get() as SqliteRow
    ).count,
  );
  return counts;
}

function rowsForTable(database: DatabaseSync, table: ImportTable) {
  const config = tableConfig[table];
  return normalizeRows(
    table,
    database
      .prepare(
        `select * from "${table}" order by ${config.orderBy}`,
      )
      .all() as SqliteRow[],
  );
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
  const buildId = String(build.build_id);
  const expectedCounts = tableCounts(database);
  const packageSnapshotSha256 = await streamFileSha256(options.wordIndex);

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const status = async () => {
    const { data, error } = await supabase.rpc(
      "get_word_index_import_status",
      { p_build_id: buildId },
    );
    if (error) {
      throw new Error(`단어원장 가져오기 상태 확인 실패: ${error.message}`);
    }
    return data as {
      status: string;
      expectedCounts: Record<string, number>;
      actualCounts: Record<string, number>;
      readyCount: number;
      batchCount: number;
      insertedRows: number;
    };
  };

  if (options.mode === "status") {
    console.log(JSON.stringify(await status(), null, 2));
    return;
  }

  const summaryJson = parseJson(build.summary_json);
  const { data: beginResult, error: beginError } = await supabase.rpc(
    "begin_word_index_import",
    {
      p_build_id: buildId,
      p_schema_version: String(build.schema_version),
      p_builder_version: String(build.builder_version),
      p_source_root_label: String(build.source_root_label),
      p_input_file_count: Number(build.input_file_count),
      p_input_snapshot_sha256: String(
        build.input_snapshot_sha256,
      ).toUpperCase(),
      p_source_started_at_utc: String(build.started_at_utc),
      p_source_completed_at_utc: String(build.completed_at_utc),
      p_summary_json: summaryJson,
      p_package_snapshot_sha256: packageSnapshotSha256,
      p_expected_counts: expectedCounts,
    },
  );
  if (beginError) {
    throw new Error(`단어원장 가져오기 시작 실패: ${beginError.message}`);
  }

  if (options.mode === "finalize") {
    const { data, error } = await supabase.rpc(
      "finalize_word_index_import",
      { p_build_id: buildId },
    );
    if (error) {
      throw new Error(`단어원장 최종 확정 실패: ${error.message}`);
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const importTable = async (
    table: ImportTable,
    onlyFirstBatch: boolean,
  ) => {
    const config = tableConfig[table];
    const rows = rowsForTable(database, table);
    const remoteBefore = await status();
    for (const prerequisite of prerequisites[table] ?? []) {
      if (
        remoteBefore.actualCounts[prerequisite] !==
        expectedCounts[prerequisite]
      ) {
        throw new Error(
          `${table} 전제조건 미완료: ${prerequisite} ${remoteBefore.actualCounts[prerequisite] ?? 0}/${expectedCounts[prerequisite]}`,
        );
      }
    }

    const totalBatches = Math.ceil(rows.length / config.batchSize);
    const batchLimit = onlyFirstBatch ? Math.min(1, totalBatches) : totalBatches;
    for (let batchIndex = 0; batchIndex < batchLimit; batchIndex += 1) {
      const batchRows = rows.slice(
        batchIndex * config.batchSize,
        (batchIndex + 1) * config.batchSize,
      );
      const { data, error } = await supabase.rpc(
        "import_word_index_batch",
        {
          p_build_id: buildId,
          p_table_name: table,
          p_batch_no: batchIndex + 1,
          p_payload_sha256: payloadSha256(batchRows),
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
      if (
        result.receivedRows !== batchRows.length ||
        result.insertedRows !== batchRows.length
      ) {
        throw new Error(
          `${table} ${batchIndex + 1} 배치 행 수 불일치`,
        );
      }
      if (
        batchIndex === 0 ||
        batchIndex + 1 === batchLimit ||
        (batchIndex + 1) % 20 === 0
      ) {
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
    }

    const remoteAfter = await status();
    const expectedAfter = onlyFirstBatch
      ? Math.min(config.batchSize, rows.length)
      : rows.length;
    if (remoteAfter.actualCounts[table] !== expectedAfter) {
      throw new Error(
        `${table} 원격 행 수 불일치: 예상 ${expectedAfter}, 실제 ${remoteAfter.actualCounts[table] ?? 0}`,
      );
    }
    return {
      table,
      expectedAfter,
      actualAfter: remoteAfter.actualCounts[table],
    };
  };

  if (options.mode === "sample") {
    const results = [];
    for (const table of sampleTables) {
      results.push(await importTable(table, true));
    }
    console.log(
      JSON.stringify(
        {
          mode: "sample",
          beginResult,
          packageSnapshotSha256,
          results,
          status: await status(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const table = options.table as ImportTable;
  console.log(
    JSON.stringify(
      {
        mode: "table",
        beginResult,
        result: await importTable(table, false),
        status: await status(),
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
