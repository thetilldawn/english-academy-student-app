import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

import {
  assertPreviewImportEnvironment,
  validateExamUsePackage,
} from "../src/lib/vocab/exam-use-import-contract";

type Options = {
  file: string;
  apply: boolean;
};

function parseOptions(arguments_: string[]): Options {
  let file = "";
  let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--file") {
      file = arguments_[index + 1] ?? "";
      index += 1;
    } else if (argument === "--apply") {
      apply = true;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!file) {
    throw new Error(
      "사용법: npm run import:exam-use -- --file <app-exam-use-package.json> [--apply]",
    );
  }
  return { file: resolve(file), apply };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = JSON.parse(await readFile(options.file, "utf8")) as unknown;
  const { summary } = validateExamUsePackage(input);

  if (!options.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          writes: 0,
          file: options.file,
          ...summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  loadEnvConfig(process.cwd());
  const { supabaseUrl, projectRef } =
    assertPreviewImportEnvironment(process.env);
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.rpc(
    "import_app_exam_use_package_v1",
    { p_package: input },
  );
  if (error) {
    throw new Error(
      `시험용 단어장 가져오기에 실패했습니다: ${error.code} ${error.message}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        projectRef,
        file: options.file,
        package: summary,
        result: data,
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
