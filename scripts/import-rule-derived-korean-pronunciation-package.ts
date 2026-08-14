import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateRuleDerivedKoreanPronunciationPackage,
  type RuleDerivedKoreanPronunciationPackage,
} from "../src/lib/vocab/rule-derived-korean-pronunciation-import-contract";

type Options = {
  packagePath: string;
  envDir: string;
  target: keyof typeof TARGET_REFS;
  mode: "dry-run" | "preflight" | "apply";
};

const TARGET_REFS = {
  staging: "wojxpruvbjzbhrpmsbuy",
  production: "xdxhswjgksukjmpbzqgz",
} as const;

function parseOptions(arguments_: string[]): Options {
  const packageIndex = arguments_.indexOf("--package");
  const targetIndex = arguments_.indexOf("--target");
  const envDirIndex = arguments_.indexOf("--env-dir");
  const packagePath =
    packageIndex >= 0 ? arguments_[packageIndex + 1] : undefined;
  const target = targetIndex >= 0 ? arguments_[targetIndex + 1] : undefined;
  const modes = ["--preflight", "--apply"].filter((flag) =>
    arguments_.includes(flag),
  );
  if (!packagePath) {
    throw new Error("--package <규칙 생성 발음 묶음 JSON>이 필요합니다.");
  }
  if (target !== "staging" && target !== "production") {
    throw new Error("--target staging|production이 필요합니다.");
  }
  if (modes.length > 1) throw new Error("실행 모드는 하나만 선택해야 합니다.");
  return {
    packagePath,
    envDir:
      envDirIndex >= 0
        ? (arguments_[envDirIndex + 1] ?? process.cwd())
        : process.cwd(),
    target,
    mode: arguments_.includes("--apply")
      ? "apply"
      : arguments_.includes("--preflight")
        ? "preflight"
        : "dry-run",
  };
}

function projectRef(supabaseUrl: string) {
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname;
    const suffix = ".supabase.co";
    if (!hostname.endsWith(suffix)) return null;
    const ref = hostname.slice(0, -suffix.length);
    return /^[a-z0-9]{20}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

async function verifyImportedRows(
  supabase: SupabaseClient,
  pronunciationPackage: RuleDerivedKoreanPronunciationPackage,
) {
  let verifiedCount = 0;
  const chunkSize = 80;
  for (
    let offset = 0;
    offset < pronunciationPackage.items.length;
    offset += chunkSize
  ) {
    const items = pronunciationPackage.items.slice(offset, offset + chunkSize);
    const variantIds = [...new Set(items.map((item) => item.pronunciation_variant_id))];
    const { data, error } = await supabase
      .from("vocab_rule_derived_korean_pronunciations")
      .select(
        "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, derivation_status, engine_version, confidence, content_sha256, package_version, display_enabled",
      )
      .in("pronunciation_variant_id", variantIds);
    if (error) {
      throw new Error(`규칙 생성 강세를 다시 확인하지 못했습니다: ${error.message}`);
    }
    const rows = new Map(
      (data ?? []).map((row) => [
        `${row.dictionary_id}\u0000${row.pronunciation_variant_id}`,
        row,
      ] as const),
    );
    for (const item of items) {
      const row = rows.get(
        `${item.dictionary_id}\u0000${item.pronunciation_variant_id}`,
      );
      if (
        !row ||
        row.display_pronunciation_ko !== item.display_pronunciation_ko ||
        JSON.stringify(row.segments) !== JSON.stringify(item.segments) ||
        row.derivation_status !== "rule_derived" ||
        row.engine_version !== pronunciationPackage.engine_version ||
        row.confidence !== item.confidence ||
        row.content_sha256 !== item.content_sha256 ||
        row.package_version !== pronunciationPackage.package_version ||
        row.display_enabled !== true
      ) {
        throw new Error(`등록된 규칙 생성 강세가 다릅니다: ${item.dictionary_id}`);
      }
      verifiedCount += 1;
    }
  }
  return verifiedCount;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const raw = JSON.parse(await readFile(options.packagePath, "utf8")) as unknown;
  const validated = validateRuleDerivedKoreanPronunciationPackage(raw);
  if (validated.pronunciationPackage.target_environment !== options.target) {
    throw new Error("규칙 생성 발음 묶음의 목표 환경이 --target과 다릅니다.");
  }
  if (options.mode === "dry-run") {
    console.log(JSON.stringify({ mode: "dry-run", ...validated.summary }, null, 2));
    return;
  }

  loadEnvConfig(path.resolve(options.envDir));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRef(supabaseUrl);
  if (
    !actualProjectRef ||
    TARGET_REFS[options.target] !== actualProjectRef
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
  const { error: tableError } = await supabase
    .from("vocab_rule_derived_korean_pronunciations")
    .select("dictionary_id", { count: "exact", head: true });
  if (tableError) {
    throw new Error(`규칙 생성 강세 DB가 준비되지 않았습니다: ${tableError.message}`);
  }
  if (options.mode === "preflight") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "preflight",
          projectRef: actualProjectRef,
          ...validated.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { data: importResult, error: importError } = await supabase.rpc(
    options.target === "production"
      ? "import_rule_derived_korean_pronunciation_package_production_v3"
      : "import_rule_derived_korean_pronunciation_package_v2",
    { p_package: validated.pronunciationPackage },
  );
  if (importError) {
    throw new Error(
      `규칙 생성 강세 등록에 실패했습니다: ${importError.code} ${importError.message}`,
    );
  }
  const verifiedCount = await verifyImportedRows(
    supabase,
    validated.pronunciationPackage,
  );
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        projectRef: actualProjectRef,
        verifiedCount,
        databaseResult: importResult,
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
