import { readFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateApprovedKoreanPronunciationPackage,
  type ApprovedKoreanPronunciationPackage,
} from "../src/lib/vocab/approved-korean-pronunciation-import-contract";

type Options = {
  packagePath: string;
  expectedProjectRef: string | null;
  mode: "dry-run" | "preflight" | "apply";
};

function parseOptions(arguments_: string[]): Options {
  const packageIndex = arguments_.indexOf("--package");
  const refIndex = arguments_.indexOf("--expected-project-ref");
  const packagePath =
    packageIndex >= 0 ? arguments_[packageIndex + 1] : undefined;
  const modes = ["--preflight", "--apply"].filter((flag) =>
    arguments_.includes(flag),
  );
  if (!packagePath) {
    throw new Error("--package <승인 발음 묶음 JSON>이 필요합니다.");
  }
  if (modes.length > 1) throw new Error("실행 모드는 하나만 선택해야 합니다.");
  return {
    packagePath,
    expectedProjectRef:
      refIndex >= 0 ? (arguments_[refIndex + 1] ?? null) : null,
    mode: arguments_.includes("--apply")
      ? "apply"
      : arguments_.includes("--preflight")
        ? "preflight"
        : "dry-run",
  };
}

function projectRef(supabaseUrl: string) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

async function verifySourceAudio(
  supabase: SupabaseClient,
  pronunciationPackage: ApprovedKoreanPronunciationPackage,
) {
  const assetIds = pronunciationPackage.items.map(
    ({ pronunciation_variant_id }) => pronunciation_variant_id,
  );
  const { data, error } = await supabase
    .from("vocab_synthetic_audio_assets")
    .select(
      "asset_id, dictionary_id, profile_id, audio_sha256, storage_verified, playback_enabled, canonical_pronunciation_approval_implied",
    )
    .in("asset_id", assetIds);
  if (error) {
    throw new Error(`합성 음원 근거를 확인하지 못했습니다: ${error.message}`);
  }
  const rows = new Map((data ?? []).map((row) => [row.asset_id, row] as const));
  for (const item of pronunciationPackage.items) {
    const row = rows.get(item.pronunciation_variant_id);
    if (
      !row ||
      row.dictionary_id !== item.dictionary_id ||
      row.profile_id !== pronunciationPackage.source_audio_profile_id ||
      row.audio_sha256 !== item.source_content_sha256 ||
      row.storage_verified !== true ||
      row.playback_enabled !== true ||
      row.canonical_pronunciation_approval_implied !== false
    ) {
      throw new Error(`합성 음원 근거가 다릅니다: ${item.dictionary_id}`);
    }
  }
  return rows.size;
}

async function verifyApprovedRows(
  supabase: SupabaseClient,
  pronunciationPackage: ApprovedKoreanPronunciationPackage,
) {
  const assetIds = pronunciationPackage.items.map(
    ({ pronunciation_variant_id }) => pronunciation_variant_id,
  );
  const { data, error } = await supabase
    .from("vocab_approved_korean_pronunciations")
    .select(
      "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, review_status, source_content_sha256, source_review_run_id",
    )
    .in("pronunciation_variant_id", assetIds);
  if (error) {
    throw new Error(`승인 강세를 다시 확인하지 못했습니다: ${error.message}`);
  }
  const rows = new Map(
    (data ?? []).map((row) => [
      `${row.dictionary_id}\u0000${row.pronunciation_variant_id}`,
      row,
    ] as const),
  );
  for (const item of pronunciationPackage.items) {
    const row = rows.get(
      `${item.dictionary_id}\u0000${item.pronunciation_variant_id}`,
    );
    if (
      !row ||
      row.display_pronunciation_ko !== item.display_pronunciation_ko ||
      JSON.stringify(row.segments) !== JSON.stringify(item.segments) ||
      row.review_status !== "approved" ||
      row.source_content_sha256 !== item.source_content_sha256 ||
      row.source_review_run_id !== item.source_review_run_id
    ) {
      throw new Error(`등록된 승인 강세가 다릅니다: ${item.dictionary_id}`);
    }
  }
  return rows.size;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const raw = JSON.parse(await readFile(options.packagePath, "utf8")) as unknown;
  const validated = validateApprovedKoreanPronunciationPackage(raw);
  if (options.mode === "dry-run") {
    console.log(
      JSON.stringify(
        { mode: "dry-run", llmTokens: 0, ...validated.summary },
        null,
        2,
      ),
    );
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

  const sourceAudioCount = await verifySourceAudio(
    supabase,
    validated.pronunciationPackage,
  );
  const { error: tableError } = await supabase
    .from("vocab_approved_korean_pronunciations")
    .select("dictionary_id", { count: "exact", head: true });
  if (tableError) {
    throw new Error(`승인 강세 DB가 준비되지 않았습니다: ${tableError.message}`);
  }
  if (options.mode === "preflight") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "preflight",
          projectRef: actualProjectRef,
          sourceAudioCount,
          llmTokens: 0,
          ...validated.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { data: importResult, error: importError } = await supabase.rpc(
    "import_approved_korean_pronunciation_package_v1",
    { p_package: validated.pronunciationPackage },
  );
  if (importError) {
    throw new Error(
      `승인 강세 등록에 실패했습니다: ${importError.code} ${importError.message}`,
    );
  }
  const approvedCount = await verifyApprovedRows(
    supabase,
    validated.pronunciationPackage,
  );
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        projectRef: actualProjectRef,
        sourceAudioCount,
        approvedCount,
        databaseResult: importResult,
        llmTokens: 0,
        ...validated.summary,
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
