import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  SIMSEOK_PRODUCTION_APPROVAL,
  SIMSEOK_PRODUCTION_PROJECT_REF,
  SIMSEOK_PRODUCTION_SETS,
  validateSimseokProductionPair,
} from "../src/lib/vocab/simseok-production-release-contract";

async function main() {
  const arguments_ = process.argv.slice(2);
  const option = (name: string) => {
    const index = arguments_.indexOf(name);
    return index < 0 ? undefined : arguments_[index + 1];
  };
  const sourceRoot = option("--source-root");
  if (!sourceRoot) throw new Error("--source-root 자료 폴더가 필요합니다.");
  const pairs = await Promise.all(SIMSEOK_PRODUCTION_SETS.map(async (set) => {
    const [examText, questionText] = await Promise.all([
      readFile(path.join(sourceRoot, set.sourceVersion, "02_앱전달묶음", set.exam.packagePath), "utf8"),
      readFile(path.join(sourceRoot, set.sourceVersion, "03_통합문항_앱전달묶음", set.question.packagePath), "utf8"),
    ]);
    validateSimseokProductionPair(set.exam.datasetKey, examText, questionText);
    return { set, examText, questionText };
  }));
  console.log(JSON.stringify({ approval: SIMSEOK_PRODUCTION_APPROVAL, sets: pairs.length,
    occurrences: pairs.reduce((sum, pair) => sum + pair.set.exam.entryCount, 0),
    questions: pairs.reduce((sum, pair) => sum + pair.set.question.itemCount, 0),
    expanded: pairs.reduce((sum, pair) => sum + pair.set.question.expandedCount, 0) }));
  if (!arguments_.includes("--apply")) return;
  if (option("--approval") !== SIMSEOK_PRODUCTION_APPROVAL ||
      option("--expected-project-ref") !== SIMSEOK_PRODUCTION_PROJECT_REF) {
    throw new Error("명시된 운영 승인 번호와 대상 확인값이 필요합니다.");
  }
  loadEnvConfig(path.resolve(option("--env-dir") ?? process.cwd()));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (url !== `https://${SIMSEOK_PRODUCTION_PROJECT_REF}.supabase.co` || !key) {
    throw new Error("운영 DB 연결 설정이 승인 대상과 다릅니다.");
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const pair of pairs) {
    const { data, error } = await client.rpc("import_approved_simseok_production_pair_v1", {
      p_exam_text: pair.examText, p_question_text: pair.questionText,
    });
    if (error) throw new Error(`${pair.set.exam.datasetKey}: ${error.code} ${error.message}`);
    console.log(JSON.stringify({ datasetKey: pair.set.exam.datasetKey, result: data }));
  }
  for (const filename of ["simseok-g11-zai7-29-webster-pronunciation.json",
    "simseok-g11-zai7-29-canonical-choice-webster-pronunciation.json"]) {
    const audio = await readFile(path.join(sourceRoot,"v4_Preview_자이7회29_발음보완",filename),"utf8");
    const { data, error } = await client.rpc("import_approved_simseok_production_audio_v1", {p_package_text:audio});
    if(error) throw new Error(`${filename}: ${error.code} ${error.message}`);
    console.log(JSON.stringify({audio:filename,result:data}));
  }
  // Activation is deliberately separate: pronunciation bindings and readback first.
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "운영 가져오기 실패");
  process.exitCode = 1;
});
