import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { libraryImportSchema } from "../src/features/wordbook-compositions/contracts/library-import";
import { libraryResourceSchema } from "../src/features/wordbook-compositions/contracts/library-resources";
import { libraryFiltersSchema, libraryHashSchema, templateMetadataSchema } from "../src/features/wordbook-compositions/contracts/library";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function atPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  if (!pointer.startsWith("/")) throw new Error("근거 값의 위치가 잘못됐습니다.");
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object") throw new Error("근거 값을 찾지 못했습니다.");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
const fileSchema = z.object({ path: z.string().min(1), sha256: libraryHashSchema, canonical_sha256: libraryHashSchema, bytes: z.number().int().positive() });
const manifestSchema = z.object({
  schemaVersion: z.literal("vocabulary-library-registration-manifest-v1"), sourceProjectRef: z.string().regex(/^[a-z0-9]{20}$/),
  inputHashes: z.object({ schemaVersion: z.literal("vocabulary-library-import-v1"), sourceCatalogHash: libraryHashSchema, linksHash: libraryHashSchema, referenceCatalogHash: libraryHashSchema }).strict(),
  scopeCount: z.number().int().positive(), sourceRows: z.number().int().positive(),
  bundles: z.array(fileSchema.extend({ scopeCount: z.number().int().positive(), sourceRows: z.number().int().positive(), datasetId: z.uuid() }).strict()).min(1),
  templates: fileSchema.strict(), referenceRegistry: fileSchema.strict(),
}).passthrough();
const templatePlanSchema = z.object({ schemaVersion: z.literal("vocabulary-library-template-plan-v1"), templates: z.array(z.object({
  key: z.string().min(1), metadata: templateMetadataSchema, filters: libraryFiltersSchema, scopeKeys: z.array(z.string().min(1)).max(2000),
  excludedOccurrenceKeys: z.array(libraryHashSchema).max(20000), scopeStatus: z.enum(["confirmed", "unconfirmed"]),
  expectedCounts: z.object({ scope_count: z.number().int(), source_occurrences: z.number().int(), included_occurrences: z.number().int() }).passthrough(),
  reviewedCompositionHash: libraryHashSchema,
}).strict()).max(100) }).strict();

async function main() {
  const args = process.argv.slice(2), options: Record<string, string> = {}; let apply = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--manifest", "--source-root", "--expected-project-ref", "--receipt"].includes(key) || key in options || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error("등록 자료와 자료 루트 인자를 확인해 주세요.");
    options[key] = args[++i]!;
  }
  if (!options["--manifest"] || !options["--source-root"]) throw new Error("--manifest와 --source-root가 필요합니다.");
  const root = await realpath(options["--source-root"]), manifestFile = await realpath(options["--manifest"]), directory = path.dirname(manifestFile);
  const within = (file: string) => { const relative = path.relative(root, file); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("근거 파일이 자료 루트 밖에 있습니다."); return file; };
  within(manifestFile);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  const readChecked = async (record: z.infer<typeof fileSchema>) => {
    const file = within(await realpath(path.resolve(directory, record.path))), raw = await readFile(file);
    if (raw.length !== record.bytes || hash(raw) !== record.sha256) throw new Error("검토한 등록 파일이 바뀌었습니다.");
    const value = JSON.parse(raw.toString("utf8"));
    if (hash(canonical(value)) !== record.canonical_sha256) throw new Error("등록 내용 확인값이 다릅니다.");
    return { value, raw: raw.toString("utf8") };
  };
  const referenceRows = z.array(z.object({ path: z.string(), sha256: libraryHashSchema, format: z.string() }).passthrough()).parse((await readChecked(manifest.referenceRegistry)).value);
  const sources = new Map<string, unknown>();
  for (const record of referenceRows) {
    const file = within(await realpath(path.resolve(root, record.path))), raw = await readFile(file);
    if (hash(raw) !== record.sha256) throw new Error("선택한 값의 원자료가 바뀌었습니다.");
    const text = raw.toString("utf8").replace(/^\uFEFF/, "");
    sources.set(record.sha256, record.format === "jsonl" ? text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)) : JSON.parse(text));
  }
  const bundles = [], scopeByKey = new Map<string, z.infer<typeof libraryImportSchema>["scopes"][number]>();
  let sourceRows = 0, references = 0;
  for (const record of manifest.bundles) {
    const checked = await readChecked(record), bundle = libraryImportSchema.parse(checked.value);
    for (const [key, value] of Object.entries(manifest.inputHashes)) if (Reflect.get(bundle, key) !== value) throw new Error("등록 묶음의 검토 입력이 다릅니다.");
    if (bundle.scopes.length !== record.scopeCount || bundle.scopes.reduce((n, s) => n + s.rows.length, 0) !== record.sourceRows) throw new Error("범위 수 또는 원행 수가 달라졌습니다.");
    for (const scope of bundle.scopes) {
      if (scopeByKey.has(scope.key) || scope.source.datasetId !== record.datasetId) throw new Error("범위 식별자가 중복되거나 다른 자료입니다.");
      scopeByKey.set(scope.key, scope);
      for (const row of scope.rows) {
        const result = libraryResourceSchema.safeParse(row.resources.selected);
        if (!result.success) throw new Error(`학습정보 형식 확인 필요: ${scope.key} / ${row.sourceRow} / ${result.error.issues.map(i => i.path.join(".") + ":" + i.code).join(",")}`);
        for (const proof of Object.values(result.data.proofs)) {
          if (!proof.ref) { if (proof.value !== null) throw new Error("값에 근거 참조가 없습니다."); continue; }
          let document = sources.get(proof.ref.fileHash);
          if (document === undefined) throw new Error("선택한 값의 근거 파일이 목록에 없습니다.");
          if (proof.ref.line !== null) {
            if (!Array.isArray(document)) throw new Error("근거 행 목록을 확인하지 못했습니다.");
            document = document[proof.ref.line - 1];
          }
          const value = atPointer(document, proof.ref.pointer);
          if (hash(canonical(value)) !== proof.ref.valueHash || canonical(value) !== canonical(proof.value)) throw new Error("선택한 값과 원자료 참조가 다릅니다.");
          references++;
        }
        if (row.resources.entryHash === null && (result.data.pronunciation.available || result.data.definitionEn !== null || result.data.lexicalPos !== null || result.data.dictionary !== null)) throw new Error("보류 원행을 선택된 학습정보로 올릴 수 없습니다.");
      }
    }
    sourceRows += record.sourceRows; bundles.push({ record, bundle, raw: checked.raw });
  }
  if (scopeByKey.size !== manifest.scopeCount || sourceRows !== manifest.sourceRows) throw new Error("전체 원자료 수가 다릅니다.");
  const plan = templatePlanSchema.parse((await readChecked(manifest.templates)).value);
  for (const t of plan.templates) {
    if (new Set(t.scopeKeys).size !== t.scopeKeys.length || t.scopeKeys.some(key => !scopeByKey.has(key)) || t.scopeKeys.length !== t.expectedCounts.scope_count || t.scopeStatus === "unconfirmed" && t.scopeKeys.length) throw new Error("템플릿의 선택 범위가 다릅니다.");
    const count = t.scopeKeys.reduce((n, key) => n + scopeByKey.get(key)!.rows.filter(r => r.resources.entryHash !== null).length, 0);
    if (count !== t.expectedCounts.included_occurrences) throw new Error("템플릿 포함 행 수가 다릅니다.");
  }
  const summary = { scopeCount: scopeByKey.size, sourceRows, templates: plan.templates.length, referenceFiles: sources.size, checkedValues: references };
  if (!apply) { console.log(JSON.stringify({ mode: "dry-run", writes: 0, ...summary })); return; }
  if (!options["--receipt"] || !options["--expected-project-ref"]) throw new Error("실제 적용에는 대상 프로젝트와 결과 저장 경로가 필요합니다.");
  const receipt = within(path.resolve(options["--receipt"]));
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", ref = options["--expected-project-ref"];
  if (!/^[a-z0-9]{20}$/.test(ref!) || url !== `https://${ref}.supabase.co`) throw new Error("대상 프로젝트가 지정한 환경과 다릅니다.");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("서버 전용 등록 키가 필요합니다.");
  const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const registered = new Map<string, { id: string; version: string }>();
  const records: unknown[] = [];
  for (const { record, bundle, raw } of bundles) {
    const response = await client.rpc("import_vocabulary_library_v1", { p_text: raw });
    if (response.error) throw new Error(`승인된 범위 등록 실패: ${response.error.code}; 완료된 묶음은 결과 파일에서 확인하세요.`);
    const result = z.object({ scopes: z.array(z.object({ key: z.string(), id: z.uuid(), version: libraryHashSchema }).strict()) }).strict().parse(response.data);
    if (result.scopes.length !== bundle.scopes.length || result.scopes.some(r => !bundle.scopes.some(s => s.key === r.key))) throw new Error("등록된 범위 응답이 다릅니다.");
    for (const row of result.scopes) registered.set(row.key, { id: row.id, version: row.version });
    records.push({ fileHash: record.sha256, ...result });
    await writeFile(receipt, JSON.stringify({ mode: "apply", projectRef: ref, summary, complete: false, records }, null, 2) + "\n");
  }
  const templateRequests = plan.templates.map(t => {
    const recipe = { filters: t.filters, scopes: t.scopeKeys.map(key => registered.get(key)!), excludedOccurrenceKeys: t.excludedOccurrenceKeys, scopeStatus: t.scopeStatus };
    // A repeated approved import produces the identical administrator command.
    const digest = hash(canonical(["vocabulary-template-import-v1", ref, t.key, t.metadata, recipe]));
    const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return { localTemplateKey: t.key, expectedCounts: t.expectedCounts, command: { action: "create", requestId, metadata: t.metadata, recipe } };
  });
  await writeFile(receipt, JSON.stringify({ mode: "apply", projectRef: ref, summary, complete: true, records, templateRequests, templatesRegistered: false }, null, 2) + "\n");
  console.log(JSON.stringify({ mode: "apply", projectRef: ref, ...summary, templatesRegistered: false }));
}

main().catch((error: unknown) => { console.error(error instanceof z.ZodError ? JSON.stringify(error.issues.map(i => ({ path: i.path, code: i.code }))) : error instanceof Error ? error.message : "등록 자료를 확인하지 못했습니다."); process.exitCode = 1; });
