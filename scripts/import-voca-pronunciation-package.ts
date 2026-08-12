import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

import { validateVocaPronunciationPackage } from "../src/lib/vocab/voca-pronunciation-import-contract";

type Options = {
  file: string;
  expectedProjectRef: string | null;
  apply: boolean;
};

function parseOptions(arguments_: string[]): Options {
  const fileIndex = arguments_.indexOf("--file");
  const refIndex = arguments_.indexOf("--expected-project-ref");
  const file = fileIndex >= 0 ? arguments_[fileIndex + 1] : undefined;
  if (!file) {
    throw new Error("--file <VOCA 발음 연결 자료>가 필요합니다.");
  }
  return {
    file,
    expectedProjectRef:
      refIndex >= 0 ? (arguments_[refIndex + 1] ?? null) : null,
    apply: arguments_.includes("--apply"),
  };
}

function projectRef(supabaseUrl: string) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = JSON.parse(await readFile(options.file, "utf8")) as unknown;
  const { package: audioPackage, summary } =
    validateVocaPronunciationPackage(input);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", ...summary }, null, 2));
    return;
  }

  loadEnvConfig(process.cwd());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRef(supabaseUrl);
  if (
    !options.expectedProjectRef ||
    !actualProjectRef ||
    actualProjectRef !== options.expectedProjectRef
  ) {
    throw new Error("Supabase 프로젝트 ref 안전장치가 일치하지 않습니다.");
  }
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { data: dataset, error: datasetError } = await supabase
    .from("vocab_datasets")
    .select("id")
    .eq("dataset_key", audioPackage.dataset_key)
    .single();
  if (datasetError || !dataset) {
    throw new Error(
      `운영 VOCA 데이터셋을 찾지 못했습니다: ${datasetError?.code ?? "no_row"} ${datasetError?.message ?? "no row"}`,
    );
  }

  const vocabulary: Array<{
    id: number;
    source_row: number;
    row_sha256: string;
    headword_normalized: string;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("vocab_entries")
      .select("id, source_row, row_sha256, headword_normalized")
      .eq("dataset_id", dataset.id)
      .order("source_row")
      .range(offset, offset + 999);
    if (error) throw new Error("운영 VOCA 행을 읽지 못했습니다.");
    vocabulary.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (vocabulary.length !== audioPackage.entries.length) {
    throw new Error("운영 VOCA 행 수와 발음 연결 자료가 다릅니다.");
  }
  const bySourceRow = new Map(vocabulary.map((row) => [row.source_row, row]));
  audioPackage.entries.forEach((entry) => {
    const vocabularyRow = bySourceRow.get(entry.source_row);
    if (
      !vocabularyRow ||
      vocabularyRow.row_sha256.toUpperCase() !== entry.entry_row_sha256 ||
      vocabularyRow.headword_normalized !== entry.normalized_headword
    ) {
      throw new Error(`${entry.source_row}번 운영 VOCA 결속값이 다릅니다.`);
    }
  });

  const { data: importResult, error: importError } = await supabase.rpc(
    "import_voca_pronunciation_package_v1",
    { p_package: audioPackage },
  );
  if (importError) {
    throw new Error(
      `VOCA 발음 3,001행을 일괄 저장하지 못했습니다: ${importError.code} ${importError.message}`,
    );
  }

  const verification: Array<{ status: string; needs_review: boolean }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("vocab_entry_pronunciations")
      .select("status, needs_review")
      .eq("dataset_id", dataset.id)
      .eq("source_package_version", audioPackage.package_version)
      .order("source_row")
      .range(offset, offset + 999);
    if (error) {
      throw new Error("저장된 VOCA 발음 연결 자료를 확인하지 못했습니다.");
    }
    verification.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const playable = verification.filter(
    (row) => row.status === "raw_first_variant_unreviewed",
  ).length;
  const needsReview = verification.filter((row) => row.needs_review).length;
  if (
    verification.length !== summary.total_rows ||
    playable !== summary.playable_rows ||
    needsReview !== summary.needs_review_rows
  ) {
    throw new Error("저장된 VOCA 발음 연결 자료 집계가 다릅니다.");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        projectRef: actualProjectRef,
        databaseResult: importResult,
        packageVersion: audioPackage.package_version,
        ...summary,
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
