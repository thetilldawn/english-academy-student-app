import { readFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { validateExamWebsterPronunciationRepairPackage } from "../src/lib/vocab/exam-webster-pronunciation-repair-contract";

type Options = {
  file: string;
  expectedProjectRef: string | null;
  apply: boolean;
};

function parseOptions(arguments_: string[]): Options {
  const fileIndex = arguments_.indexOf("--file");
  const refIndex = arguments_.indexOf("--expected-project-ref");
  const file = fileIndex >= 0 ? arguments_[fileIndex + 1] : undefined;
  if (!file) throw new Error("--file <Webster 복구 자료>가 필요합니다.");
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
  const { package: repairPackage, summary } =
    validateExamWebsterPronunciationRepairPackage(input);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", llmTokens: 0, ...summary }, null, 2));
    return;
  }

  loadEnvConfig(process.cwd());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRef(supabaseUrl);
  if (
    !options.expectedProjectRef ||
    !actualProjectRef ||
    options.expectedProjectRef !== actualProjectRef
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

  const { data: importResult, error: importError } = await supabase.rpc(
    "import_exam_webster_pronunciation_repair_v1",
    { p_package: repairPackage },
  );
  if (importError) {
    throw new Error(
      `Webster 동일발음 복구 저장에 실패했습니다: ${importError.code} ${importError.message}`,
    );
  }

  const { data, error } = await supabase
    .from("vocab_entry_pronunciations")
    .select(
      "source_row, selected_variant_id, selected_audio_url, content_sha256, listening_enabled",
    )
    .eq("source_package_version", repairPackage.package_version)
    .order("source_row");
  if (error) throw new Error(`Webster 복구 readback에 실패했습니다: ${error.code}`);
  const expectedBySourceRow = new Map(
    repairPackage.entries.map((entry) => [entry.source_row, entry] as const),
  );
  if (
    data?.length !== 29 ||
    data.some((row) => {
      const expected = expectedBySourceRow.get(row.source_row);
      return (
        !expected ||
        row.selected_variant_id !== expected.selected_variant_id ||
        row.selected_audio_url !== expected.selected_audio_url ||
        row.content_sha256 !== expected.content_sha256 ||
        row.listening_enabled !== true
      );
    })
  ) {
    throw new Error("Webster 복구 readback 결속값이 자료와 다릅니다.");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        projectRef: actualProjectRef,
        databaseResult: importResult,
        llmTokens: 0,
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
