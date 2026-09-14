import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { assertReviewedMockEnvironment, validateReviewedMockBundle, verifyReviewedMockRawPronunciations } from "../src/lib/vocab/reviewed-mock-import-contract";

async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]!;
    if (key === "--apply") { apply = true; continue; }
    if (!["--file", "--source-root", "--expected-project-ref"].includes(key) || !args[index + 1] || args[index + 1]!.startsWith("--")) {
      throw new Error("원고 파일, 자료 루트, 적용할 프로젝트를 확인해 주세요.");
    }
    if (key in options) throw new Error("같은 인자를 여러 번 지정할 수 없습니다.");
    options[key] = args[++index]!;
  }
  if (!options["--file"] || !options["--source-root"]) throw new Error("--file과 --source-root가 필요합니다.");
  const raw = await readFile(path.resolve(options["--file"]), "utf8");
  const { bundle, summary } = validateReviewedMockBundle(JSON.parse(raw));
  const root = await realpath(path.resolve(options["--source-root"]));
  const sourceFile = async (relativePath: string) => {
    const file = await realpath(path.resolve(root, relativePath));
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("근거 파일이 지정한 자료 루트 밖에 있습니다.");
    return file;
  };
  const references = [
    ...bundle.inputs,
    ...bundle.resources.flatMap(row => [row.source_evidence, ...row.review_records.flatMap(record => record.evidence),
      ...row.dictionary.evidence, ...row.pos.evidence, ...row.pronunciation.evidence, ...row.definition.evidence, ...row.example.evidence]),
  ];
  const checked = new Map<string, string>();
  for (const reference of references) {
    const file = await sourceFile(reference.path);
    let actual = checked.get(file);
    if (!actual) {
      actual = createHash("sha256").update(await readFile(file)).digest("hex");
      checked.set(file, actual);
    }
    if (actual !== reference.sha256) throw new Error("검토에 사용한 근거 파일이 변경됐습니다.");
  }
  await verifyReviewedMockRawPronunciations(bundle, async (file) => readFile(await sourceFile(file), "utf8"));
  const fileSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", writes: 0, fileSha256, evidenceFiles: checked.size, ...summary }));
    return;
  }
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = assertReviewedMockEnvironment(url, options["--expected-project-ref"] ?? "");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("서버 전용 등록 키가 필요합니다.");
  const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc("import_reviewed_mock_wordbook_v1", { p_bundle_text: raw });
  if (error) throw new Error(`승인된 원고 등록에 실패했습니다: ${error.code}`);
  console.log(JSON.stringify({ mode: "apply", projectRef, fileSha256, summary, result: data }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "원고를 확인하지 못했습니다.");
  process.exitCode = 1;
});
