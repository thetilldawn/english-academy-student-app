import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import {
  CANONICAL_QUESTION_PREVIEW_PROJECT_REF,
  projectRefFromSupabaseUrl,
  validateCanonicalQuestionPreviewImport,
} from "../src/lib/vocab/canonical-question-preview-import-contract";

type Options = {
  manifestPath: string;
  itemsPath: string;
  datasetId: string;
  expectedProjectRef: string;
  envDir: string;
  apply: boolean;
};

function parseOptions(arguments_: string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} 값이 필요합니다.`);
    }
    values.set(argument, value);
    index += 1;
  }
  const manifestPath = values.get("--manifest") ?? "";
  const itemsPath = values.get("--items") ?? "";
  const datasetId = values.get("--dataset-id") ?? "";
  const expectedProjectRef = values.get("--expected-project-ref") ?? "";
  const envDir = values.get("--env-dir") ?? process.cwd();
  if (!manifestPath || !itemsPath || !datasetId || !expectedProjectRef) {
    throw new Error(
      "사용법: npm run import:canonical-question-preview -- --manifest <manifest-v1.json> --items <preview-question-items-v1.jsonl> --dataset-id <uuid> --expected-project-ref <ref> [--env-dir <Preview env 폴더> --apply]",
    );
  }
  if (
    expectedProjectRef !== CANONICAL_QUESTION_PREVIEW_PROJECT_REF ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      datasetId,
    )
  ) {
    throw new Error("Preview 프로젝트 ref 또는 단어장 ID 안전장치가 다릅니다.");
  }
  return {
    manifestPath: path.resolve(manifestPath),
    itemsPath: path.resolve(itemsPath),
    datasetId,
    expectedProjectRef,
    envDir: path.resolve(envDir),
    apply,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [manifestText, itemJsonl] = await Promise.all([
    readFile(options.manifestPath, "utf8"),
    readFile(options.itemsPath, "utf8"),
  ]);
  const validated = validateCanonicalQuestionPreviewImport(
    JSON.parse(manifestText) as unknown,
    itemJsonl,
  );
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", writes: 0, ...validated.summary }, null, 2));
    return;
  }

  loadEnvConfig(options.envDir);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (
    actualProjectRef !== options.expectedProjectRef ||
    actualProjectRef !== validated.summary.targetProjectRef ||
    !secretKey
  ) {
    throw new Error("Preview Supabase 연결 안전장치가 일치하지 않습니다.");
  }
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.rpc(
    "import_canonical_question_preview_release_v1",
    {
      p_dataset_id: options.datasetId,
      p_manifest: validated.manifest,
      p_items: validated.items,
    },
  );
  if (error) {
    throw new Error(
      `Preview 문제 묶음 등록에 실패했습니다: ${error.code} ${error.message}`,
    );
  }
  console.log(JSON.stringify({ mode: "apply", projectRef: actualProjectRef, ...validated.summary, result: data }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
