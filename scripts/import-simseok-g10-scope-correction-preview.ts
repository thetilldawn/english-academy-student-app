import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  assertSimseokG10ScopeCorrectionPreviewEnvironment,
  SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS,
  SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS,
  validateSimseokG10ScopeCorrectionPreview,
} from "../src/lib/vocab/simseok-g10-scope-correction-preview-contract";

type Options = {
  examManifestPath: string;
  questionManifestPath: string;
  envDir: string;
  expectedProjectRef: string;
  apply: boolean;
  cutover: boolean;
};

const stateSchema = z.object({
  status: z.enum(["staged", "active"]),
  oldReferenceCount: z.literal(0),
  unaffectedDatasetCount: z.literal(4),
  correctedDatasetCount: z.literal(2),
  correctedOccurrenceCount: z.literal(222),
  correctedItemCount: z.literal(245),
  correctedExpandedCount: z.literal(249),
  correctedDefinitionCount: z.literal(138),
  correctedExampleCount: z.literal(107),
  activeDatasetCount: z.literal(6),
  activeOccurrenceCount: z.literal(1509),
  activeItemCount: z.literal(1766),
  activeExpandedCount: z.literal(1771),
  activeDefinitionCount: z.literal(840),
  activeExampleCount: z.literal(926),
  targetEnvironment: z.literal("preview"),
}).passthrough();

function parseOptions(arguments_: string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  let cutover = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--cutover") {
      cutover = true;
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
  const examManifest = values.get("--exam-manifest");
  const questionManifest = values.get("--question-manifest");
  if (!examManifest || !questionManifest) {
    throw new Error(
      "사용법: npm run import:simseok-g10-scope-correction-preview -- --exam-manifest <app-handoff-manifest.json> --question-manifest <combined-question-handoff-manifest.json> [--env-dir <Preview env 폴더> --expected-project-ref <ref> --apply [--cutover]]",
    );
  }
  if (cutover && !apply) {
    throw new Error("--cutover는 --apply와 함께 써야 합니다.");
  }
  const expectedProjectRef = values.get("--expected-project-ref") ?? "";
  if (apply && expectedProjectRef !== SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF) {
    throw new Error("심석고 고1 범위 정정의 Preview 프로젝트 확인값이 다릅니다.");
  }
  return {
    examManifestPath: path.resolve(examManifest),
    questionManifestPath: path.resolve(questionManifest),
    envDir: path.resolve(values.get("--env-dir") ?? process.cwd()),
    expectedProjectRef,
    apply,
    cutover,
  };
}

async function readExactPackages(
  directory: string,
  expected: ReadonlyArray<{ packagePath: string }>,
) {
  const packageDirectoryName = path.dirname(expected[0]!.packagePath);
  const packageDirectory = path.join(directory, packageDirectoryName);
  const actualFiles = (await readdir(packageDirectory))
    .filter((name) => name.endsWith(".json"))
    .toSorted();
  const expectedFiles = expected
    .map((item) => path.basename(item.packagePath))
    .toSorted();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${packageDirectoryName} 폴더의 JSON 파일 목록이 다릅니다.`);
  }
  return new Map(
    await Promise.all(
      expected.map(async (item) => [
        item.packagePath,
        await readFile(path.join(directory, item.packagePath), "utf8"),
      ] as const),
    ),
  );
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const examDirectory = path.dirname(options.examManifestPath);
  const questionDirectory = path.dirname(options.questionManifestPath);
  const [
    examManifestText,
    questionManifestText,
    reviewLedgerText,
    examPackageTexts,
    questionPackageTexts,
  ] = await Promise.all([
    readFile(options.examManifestPath, "utf8"),
    readFile(options.questionManifestPath, "utf8"),
    readFile(path.join(questionDirectory, "independent-review-rejections.json"), "utf8"),
    readExactPackages(examDirectory, SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS),
    readExactPackages(
      questionDirectory,
      SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS,
    ),
  ]);
  const validated = validateSimseokG10ScopeCorrectionPreview({
    examManifestText,
    examPackageTexts,
    questionManifestText,
    questionPackageTexts,
    reviewLedgerText,
  });
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", ...validated.summary }, null, 2));
    return;
  }

  loadEnvConfig(options.envDir);
  const { supabaseUrl, projectRef } =
    assertSimseokG10ScopeCorrectionPreviewEnvironment(process.env);
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

  const { data: stageData, error: stageError } = await supabase.rpc(
    "stage_simseok_g10_scope_correction_preview_v3",
    {
      p_exam_package_texts: validated.stagedPackages.map(
        (item) => item.examPackageText,
      ),
      p_question_package_texts: validated.stagedPackages.map(
        (item) => item.questionPackageText,
      ),
    },
  );
  if (stageError) {
    throw new Error(
      `고1 1·2과 숨김 단계 반영에 실패했습니다: ${stageError.code} ${stageError.message}`,
    );
  }
  const stage = stateSchema.parse(stageData);

  const { data: preflightData, error: preflightError } = await supabase.rpc(
    "preflight_simseok_g10_scope_correction_preview_v3",
  );
  if (preflightError) {
    throw new Error(
      `고1 1·2과 교체 직전 검산에 실패했습니다: ${preflightError.code} ${preflightError.message}`,
    );
  }
  const preflight = stateSchema.parse(preflightData);
  if (stage.status !== preflight.status) {
    throw new Error("단계 반영 직후 상태와 다시 읽은 상태가 다릅니다.");
  }

  let cutover: z.infer<typeof stateSchema> | undefined;
  if (options.cutover) {
    const { data, error } = await supabase.rpc(
      "cutover_simseok_g10_scope_correction_preview_v3",
    );
    if (error) {
      throw new Error(
        `고1 3·4과에서 1·2과로의 원자 교체에 실패했습니다: ${error.code} ${error.message}`,
      );
    }
    cutover = stateSchema.parse(data);
    if (cutover.status !== "active") {
      throw new Error("원자 교체 뒤 상태가 active가 아닙니다.");
    }
  }

  console.log(JSON.stringify({
    mode: options.cutover ? "apply-and-cutover" : "stage-and-preflight",
    projectRef,
    ...validated.summary,
    stage,
    preflight,
    cutover,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
