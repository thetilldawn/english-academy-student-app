import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  assertSimseokSem2PreviewEnvironment,
  SIMSEOK_SEM2_EXPECTED_SETS,
  SIMSEOK_SEM2_PREVIEW_PROJECT_REF,
  validateSimseokSem2PreviewHandoff,
} from "../src/lib/vocab/simseok-sem2-preview-import-contract";

type Options = {
  manifestPath: string;
  envDir: string;
  expectedProjectRef: string;
  apply: boolean;
};

const importResultSchema = z.object({
  status: z.literal("active"),
  datasetCount: z.literal(6),
  occurrenceCount: z.literal(1584),
  targetEnvironment: z.literal("preview"),
  officialSchoolRangeConfirmed: z.literal(false),
  datasets: z
    .array(
      z.object({
        status: z.literal("active"),
        idempotent: z.boolean(),
        occurrenceCount: z.number().int().positive(),
      }).passthrough(),
    )
    .length(6),
});

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
  const manifestPath = path.resolve(values.get("--manifest") ?? "");
  const envDir = path.resolve(values.get("--env-dir") ?? process.cwd());
  const expectedProjectRef = values.get("--expected-project-ref") ?? "";
  if (!values.get("--manifest")) {
    throw new Error(
      "사용법: npm run import:simseok-sem2-preview -- --manifest <app-handoff-manifest.json> [--env-dir <Preview env 폴더> --expected-project-ref <ref> --apply]",
    );
  }
  if (
    apply &&
    expectedProjectRef !== SIMSEOK_SEM2_PREVIEW_PROJECT_REF
  ) {
    throw new Error("심석고 검토본의 Preview 프로젝트 ref 확인값이 다릅니다.");
  }
  return { manifestPath, envDir, expectedProjectRef, apply };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const handoffDirectory = path.dirname(options.manifestPath);
  const manifestText = await readFile(options.manifestPath, "utf8");
  const declaredPackageDirectory = path.join(
    handoffDirectory,
    "exam-use-packages",
  );
  const actualFiles = (await readdir(declaredPackageDirectory))
    .filter((name) => name.endsWith(".json"))
    .toSorted();
  const expectedFiles = SIMSEOK_SEM2_EXPECTED_SETS.map((item) =>
    path.basename(item.packagePath),
  ).toSorted();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("심석고 앱 전달 폴더의 패키지 파일 목록이 다릅니다.");
  }
  const packageTexts = new Map<string, string>();
  await Promise.all(
    SIMSEOK_SEM2_EXPECTED_SETS.map(async (expected) => {
      packageTexts.set(
        expected.packagePath,
        await readFile(path.join(handoffDirectory, expected.packagePath), "utf8"),
      );
    }),
  );
  const validated = validateSimseokSem2PreviewHandoff(
    manifestText,
    packageTexts,
  );
  if (!options.apply) {
    console.log(
      JSON.stringify(
        { mode: "dry-run", ...validated.summary },
        null,
        2,
      ),
    );
    return;
  }

  loadEnvConfig(options.envDir);
  const { supabaseUrl, projectRef } =
    assertSimseokSem2PreviewEnvironment(process.env);
  if (projectRef !== options.expectedProjectRef) {
    throw new Error("명령의 Preview 프로젝트 ref와 실제 연결이 다릅니다.");
  }
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
    "import_simseok_sem2_preview_bundle_v1",
    {
      p_package_texts: validated.packages.map((item) => {
        const packageText = packageTexts.get(item.packagePath);
        if (packageText === undefined) {
          throw new Error(`${item.packagePath} 원문이 없습니다.`);
        }
        return packageText;
      }),
    },
  );
  if (error) {
    throw new Error(
      `심석고 2학기 여섯 자료의 원자적 Preview 가져오기에 실패했습니다: ${error.code} ${error.message}`,
    );
  }
  const parsedResult = importResultSchema.parse(data);
  const writes = parsedResult.datasets.filter(
    (item) => !item.idempotent,
  ).length;
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        projectRef,
        ...validated.summary,
        writes,
        result: parsedResult,
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
