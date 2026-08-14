import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateVocabPronunciationReleaseV2,
  vocabPronunciationReleaseHeader,
  type VocabPronunciationReleaseV2,
} from "../src/lib/vocab/vocab-pronunciation-release-v2-contract";

const TARGET_REFS = {
  staging: "wojxpruvbjzbhrpmsbuy",
  production: "xdxhswjgksukjmpbzqgz",
} as const;

type Target = keyof typeof TARGET_REFS;
type Mode = "dry-run" | "preflight" | "apply";
type Options = {
  file: string;
  envDir: string;
  target: Target;
  mode: Mode;
  activate: boolean;
};

function optionValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function parseOptions(arguments_: string[]): Options {
  const file = optionValue(arguments_, "--file");
  const target = optionValue(arguments_, "--target");
  const envDir = optionValue(arguments_, "--env-dir") ?? process.cwd();
  const modeFlags = ["--preflight", "--apply"].filter((flag) =>
    arguments_.includes(flag),
  );
  if (!file) throw new Error("--file <VOCA 발음 최종 묶음>이 필요합니다.");
  if (target !== "staging" && target !== "production") {
    throw new Error("--target staging|production이 필요합니다.");
  }
  if (modeFlags.length > 1) throw new Error("실행 모드는 하나만 선택해야 합니다.");
  const mode: Mode = arguments_.includes("--apply")
    ? "apply"
    : arguments_.includes("--preflight")
      ? "preflight"
      : "dry-run";
  const activate = arguments_.includes("--activate");
  if (activate && mode !== "apply") {
    throw new Error("--activate는 --apply와 함께만 사용할 수 있습니다.");
  }
  return { file, envDir, target, mode, activate };
}

function projectRef(supabaseUrl: string) {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] ?? null : null;
  } catch {
    return null;
  }
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

async function verifyDataset(
  supabase: SupabaseClient,
  release: VocabPronunciationReleaseV2,
) {
  const { data: dataset, error: datasetError } = await supabase
    .from("vocab_datasets")
    .select("id, dataset_key, source_sha256, row_count, status, is_active")
    .eq("dataset_key", release.dataset_key)
    .maybeSingle();
  if (datasetError || !dataset) {
    throw new Error(
      `VOCA 데이터셋을 찾지 못했습니다: ${datasetError?.code ?? "no_row"}`,
    );
  }
  if (
    String(dataset.source_sha256).toUpperCase() !==
      release.dataset_source_sha256 ||
    dataset.row_count !== release.summary.expected_entry_count
  ) {
    throw new Error("VOCA 데이터셋의 원본 해시 또는 행 수가 다릅니다.");
  }
  const expectedBySourceRow = new Map(
    release.bindings.map((binding) => [binding.source_row, binding] as const),
  );
  let checked = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("vocab_entries")
      .select("source_row, row_sha256, headword, headword_normalized")
      .eq("dataset_id", dataset.id)
      .order("source_row")
      .range(offset, offset + 999);
    if (error) throw new Error(`VOCA 3,001행 readback 실패: ${error.message}`);
    for (const row of data ?? []) {
      const expected = expectedBySourceRow.get(row.source_row);
      if (
        !expected ||
        String(row.row_sha256).toUpperCase() !== expected.entry_row_sha256 ||
        row.headword !== expected.headword ||
        row.headword_normalized !== expected.headword_normalized
      ) {
        throw new Error(`${row.source_row}번 VOCA 기준 행의 결속값이 다릅니다.`);
      }
      checked += 1;
    }
    if (!data || data.length < 1000) break;
  }
  if (checked !== release.summary.expected_entry_count) {
    throw new Error(`VOCA 기준 행 수가 다릅니다: ${checked}`);
  }
  return {
    datasetId: dataset.id as string,
    checked,
    status: dataset.status,
    active: dataset.is_active,
  };
}

async function releaseStatus(
  supabase: SupabaseClient,
  release: VocabPronunciationReleaseV2,
) {
  const { data, error } = await supabase
    .from("vocab_pronunciation_releases_v2")
    .select("release_id, package_version, status")
    .eq("release_id", release.release_id)
    .maybeSingle();
  if (error) {
    throw new Error(`VOCA 발음 release 상태 조회 실패: ${error.message}`);
  }
  if (data && data.package_version !== release.package_version) {
    throw new Error("같은 release ID에 다른 패키지가 이미 있습니다.");
  }
  return data as
    | { release_id: string; package_version: string; status: string }
    | null;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const raw = JSON.parse(await readFile(options.file, "utf8")) as unknown;
  const { release, summary } = validateVocabPronunciationReleaseV2(raw);
  if (options.mode === "dry-run") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "dry-run",
          target: options.target,
          releaseId: release.release_id,
          packageVersion: release.package_version,
          ...summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  loadEnvConfig(path.resolve(options.envDir));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualRef = projectRef(supabaseUrl);
  const expectedRef = TARGET_REFS[options.target];
  if (!actualRef || actualRef !== expectedRef) {
    throw new Error(
      `Supabase 대상 안전장치 불일치: ${options.target}은 ${expectedRef}여야 합니다.`,
    );
  }
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const dataset = await verifyDataset(supabase, release);
  const before = await releaseStatus(supabase, release);
  if (options.mode === "preflight") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "preflight",
          target: options.target,
          projectRef: actualRef,
          releaseBefore: before?.status ?? null,
          dataset,
          ...summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { data: staged, error: stageError } = await supabase.rpc(
    "stage_vocab_pronunciation_release_v2",
    { p_header: vocabPronunciationReleaseHeader(release) },
  );
  if (stageError) {
    throw new Error(`VOCA 발음 release 준비 실패: ${stageError.code} ${stageError.message}`);
  }
  const stagedStatus =
    staged && typeof staged === "object" && "status" in staged
      ? String(staged.status)
      : null;
  if (stagedStatus === "staged") {
    let importedIdentities = 0;
    for (const batch of chunks(release.identities, 200)) {
      const { error } = await supabase.rpc(
        "import_vocab_pronunciation_identity_batch_v2",
        { p_release_id: release.release_id, p_items: batch },
      );
      if (error) {
        throw new Error(`VOCA 발음 묶음 저장 실패: ${error.code} ${error.message}`);
      }
      importedIdentities += batch.length;
      console.log(
        JSON.stringify({
          status: "identity_imported",
          checked: importedIdentities,
          total: release.identities.length,
        }),
      );
    }
    let importedBindings = 0;
    for (const batch of chunks(release.bindings, 300)) {
      const { error } = await supabase.rpc(
        "import_vocab_pronunciation_binding_batch_v2",
        { p_release_id: release.release_id, p_items: batch },
      );
      if (error) {
        throw new Error(`VOCA 발음 연결 저장 실패: ${error.code} ${error.message}`);
      }
      importedBindings += batch.length;
      console.log(
        JSON.stringify({
          status: "binding_imported",
          checked: importedBindings,
          total: release.bindings.length,
        }),
      );
    }
  } else if (stagedStatus !== "active" && stagedStatus !== "retired") {
    throw new Error(`알 수 없는 VOCA release 상태입니다: ${stagedStatus ?? "null"}`);
  }

  const { data: verified, error: verifyError } = await supabase.rpc(
    "verify_vocab_pronunciation_release_v2",
    { p_release_id: release.release_id },
  );
  if (verifyError) {
    throw new Error(`VOCA 발음 release 검증 실패: ${verifyError.code} ${verifyError.message}`);
  }
  let activated: unknown = null;
  if (options.activate) {
    const { data, error } = await supabase.rpc(
      "activate_vocab_pronunciation_release_v2",
      { p_release_id: release.release_id },
    );
    if (error) {
      throw new Error(`VOCA 발음 release 활성화 실패: ${error.code} ${error.message}`);
    }
    activated = data;
  }
  const after = await releaseStatus(supabase, release);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        target: options.target,
        projectRef: actualRef,
        dataset,
        staged,
        verified,
        activated,
        releaseAfter: after?.status ?? null,
        releaseId: release.release_id,
        packageVersion: release.package_version,
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
