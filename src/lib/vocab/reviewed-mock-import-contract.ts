import { createHash } from "node:crypto";
import { z } from "zod";

import {
  computeExamUseEntryContentHash,
  computeExamUsePackageVersion,
  sha256CanonicalJson,
  validateExamUsePackage,
} from "./exam-use-import-contract";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const evidence = z.object({
  source: z.enum(["wordbook", "wiki", "preserved_raw", "reviewed_source"]),
  path: text(900),
  locator: text(500),
  sha256: sha,
}).strict();
const field = <T extends z.ZodType>(value: T) => z.object({
  status: z.enum(["linked", "missing", "review_required", "excluded"]),
  value: value.nullable(),
  evidence: z.array(evidence),
  reason: text(900),
}).strict().superRefine((item, ctx) => {
  const selectedValue: unknown = Reflect.get(item, "value");
  if ((item.status === "linked") !== (selectedValue !== null) ||
    (item.status === "linked" && item.evidence.length === 0)) {
    ctx.addIssue({ code: "custom", message: "연결된 값과 실제 근거가 일치해야 합니다." });
  }
});
const review = z.object({
  stage: z.literal("exam_scope"),
  reviewer: text(150),
  reviewer_version: text(80),
  review_run_id: text(180),
  reviewed_at: z.iso.datetime(),
  decision: z.literal("pass"),
  input_hash: sha,
  evidence: z.array(evidence).min(1),
}).strict();

export const reviewedMockResourceSchema = z.object({
  source_row: z.int().positive(),
  original_headword: text(200),
  original_gloss: text(600),
  original_pos: text(120).nullable(),
  source_marker: z.string().max(30),
  source_occurrence_id: text(200),
  source_evidence: evidence,
  inclusion_reason: text(900),
  dictionary: field(z.object({
    dictionary_id: text(180),
    legacy_id: z.uuid().nullable(),
    sense_id: text(160).nullable(),
    canonical_approved: z.literal(false),
  }).strict()),
  pos: field(text(120)),
  pronunciation: field(z.object({
    variant_id: text(160),
    variant_pos: text(160),
    notation: text(500),
    sound_audio: text(500),
    audio_url: z.url(),
    raw_sha256: sha,
  }).strict()),
  definition: field(text(1600)),
  example: field(z.object({ english: text(1800), korean: text(1800).nullable() }).strict()),
  exam_input_hash: sha,
  review_records: z.array(review).min(2),
}).strict();

const scopeSchema = z.object({
  unit_label: text(160),
  display_name: text(300),
  review_evidence_sha256: sha,
  metadata: z.object({
    executionYear: z.union([z.literal(2024), z.literal(2025), z.literal(2026)]),
    examMonth: z.int().min(1).max(12),
    examKind: z.literal("mock"),
    academicYear: z.null(),
    agency: text(120),
    typeCode: text(80),
    typeLabel: text(100),
    questionNumbers: z.array(z.int().min(18).max(45)).min(1).max(3),
    sharedPassage: z.boolean(),
  }).strict(),
}).strict();

const bundleSchema = z.object({
  schema_version: z.literal("reviewed_mock_wordbook_v1"),
  approval_id: text(180),
  content_sha256: sha,
  package: z.unknown(),
  inputs: z.array(evidence).min(1),
  scopes: z.array(scopeSchema).min(1).max(25),
  resources: z.array(reviewedMockResourceSchema).min(4).max(2000),
}).strict();

export type ReviewedMockResource = z.infer<typeof reviewedMockResourceSchema>;
export type ReviewedMockBundle = Omit<z.infer<typeof bundleSchema>, "package"> & {
  package: ReturnType<typeof validateExamUsePackage>["package"];
};

export function computeReviewedMockInputHash(entry: Record<string, unknown>, resources: Record<string, unknown>) {
  const entryBasis = { ...entry };
  const resourceBasis = { ...resources };
  delete entryBasis.content_hash;
  delete entryBasis.exam_input_hash;
  delete resourceBasis.exam_input_hash;
  delete resourceBasis.review_records;
  return sha256CanonicalJson({ entry: entryBasis, resources: resourceBasis } as Parameters<typeof sha256CanonicalJson>[0]);
}

export function validateReviewedMockBundle(input: unknown) {
  const bundle = bundleSchema.parse(input);
  const { package: pkg, summary } = validateExamUsePackage(bundle.package);
  if (!/^g12-mock-(2024|2025|2026)-(03|05|06|07|09|10)-v[1-9][0-9]*$/.test(pkg.dataset_key)) {
    throw new Error("고3 모의고사 월별 자료 키가 필요합니다.");
  }
  const calculated = sha256CanonicalJson(Object.fromEntries(Object.entries(bundle).filter(([key]) => key !== "content_sha256")) as Parameters<typeof sha256CanonicalJson>[0]);
  if (calculated !== bundle.content_sha256) throw new Error("검토 원고 확인값이 일치하지 않습니다.");
  if (pkg.exam_review_ledger_sha256 !== sha256CanonicalJson([...bundle.resources].sort((a, b) => a.source_row - b.source_row).map(row => row.review_records)) ||
    pkg.manifest_content_hash !== sha256CanonicalJson(bundle.scopes)) throw new Error("원고의 범위·검토 원장 확인값이 다릅니다.");
  const entryMap = new Map(pkg.entries.map(entry => [entry.source_row, entry]));
  if (new Set(pkg.entries.map(entry => entry.entry_row_sha256)).size !== pkg.entries.length) {
    throw new Error("문항별 원출현의 저장 식별값이 중복되었습니다.");
  }
  if (bundle.resources.length !== entryMap.size || new Set(bundle.resources.map(row => row.source_row)).size !== entryMap.size) {
    throw new Error("원출현과 학습정보 연결 수가 다릅니다.");
  }
  const scopeLabels = new Set(bundle.scopes.map(scope => scope.unit_label));
  if (scopeLabels.size !== bundle.scopes.length || scopeLabels.size !== new Set(pkg.entries.map(entry => entry.unit)).size ||
    pkg.entries.some(entry => !scopeLabels.has(entry.unit))) throw new Error("원문 단원과 문항 범위가 다릅니다.");
  for (const scope of bundle.scopes) {
    const q = scope.metadata.questionNumbers;
    if (new Set(q).size !== q.length || q.some((n, i) => i > 0 && n <= q[i - 1]!) ||
      (scope.metadata.sharedPassage !== (q[0]! >= 41)) ||
      (q[0]! >= 41 && !["41,42", "43,44,45"].includes(q.join(","))) ||
      (q[0]! < 41 && q.length !== 1)) throw new Error("문항과 공유지문 범위가 올바르지 않습니다.");
    const [, year, month] = pkg.dataset_key.match(/^g12-mock-(\d{4})-(\d{2})-/)!;
    if (scope.metadata.executionYear !== Number(year) || scope.metadata.examMonth !== Number(month)) throw new Error("자료와 출처 연도·월이 다릅니다.");
  }
  const links = { dictionary: 0, pos: 0, pronunciation: 0, definition: 0, example: 0 };
  for (const resource of bundle.resources) {
    const entry = entryMap.get(resource.source_row)!;
    const hash = computeReviewedMockInputHash(entry as unknown as Record<string, unknown>, resource as unknown as Record<string, unknown>);
    if (hash !== entry.exam_input_hash || hash !== resource.exam_input_hash ||
      resource.review_records.some(record => record.input_hash !== hash) ||
      new Set(resource.review_records.map(record => record.reviewer)).size < 2 ||
      new Set(resource.review_records.map(record => record.review_run_id)).size < 2) {
      throw new Error(`${resource.source_row}번의 동일 원고 독립 검토 2회가 필요합니다.`);
    }
    if (resource.original_gloss !== entry.display_gloss_ko && entry.context_evidence_status !== "manual_context_correction") {
      throw new Error(`${resource.source_row}번 원뜻 변경의 교정 근거가 필요합니다.`);
    }
    const dictionary = resource.dictionary.value;
    if (dictionary && (dictionary.dictionary_id !== entry.dictionary_id || dictionary.sense_id !== entry.sense_id ||
      (dictionary.legacy_id !== null && !entry.legacy_ids.some(id => id.id === dictionary.legacy_id)))) {
      throw new Error(`${resource.source_row}번 사전 참조가 다릅니다.`);
    }
    const pronunciation = resource.pronunciation.value;
    if ((entry.audio.status === "raw_attached") !== (pronunciation !== null) ||
      (pronunciation && (resource.pos.status !== "linked" || pronunciation.variant_pos !== resource.pos.value ||
        pronunciation.audio_url !== entry.audio.audio_url || pronunciation.raw_sha256 !== entry.audio.raw_response_sha256 ||
        pronunciation.variant_id !== entry.audio.variant_id || pronunciation.variant_pos !== entry.audio.variant_pos ||
        pronunciation.sound_audio !== entry.audio.sound_audio || pronunciation.notation !== entry.audio.mw_notation ||
        !resource.pronunciation.evidence.some(source => source.source === "preserved_raw" &&
          source.path === entry.audio.raw_relative_path && source.sha256 === pronunciation.raw_sha256 &&
          source.locator === entry.audio.source_locator)))) {
      throw new Error(`${resource.source_row}번 선택한 발음과 원문 근거가 다릅니다.`);
    }
    for (const key of Object.keys(links) as Array<keyof typeof links>) if (resource[key].status === "linked") links[key] += 1;
  }
  return { bundle: { ...bundle, package: pkg } satisfies ReviewedMockBundle,
    summary: { ...summary, scopeCount: bundle.scopes.length, links } };
}

/** Read the selected original entry as well as comparing copies of its metadata. */
export async function verifyReviewedMockRawPronunciations(
  bundle: ReviewedMockBundle,
  readSource: (relativePath: string) => Promise<string>,
) {
  const cache = new Map<string, unknown[]>();
  const normalize = (value: string) => value.normalize("NFKC").replaceAll("*", "").trim().replace(/\s+/g, " ").toLowerCase();
  for (const entry of bundle.package.entries) {
    if (entry.audio.status !== "raw_attached") continue;
    const audio = entry.audio;
    const file = audio.raw_relative_path!;
    const cacheKey = `${file}:${audio.raw_response_sha256}`;
    let payload = cache.get(cacheKey);
    if (!payload) {
      const raw = await readSource(file);
      if (createHash("sha256").update(raw, "utf8").digest("hex") !== audio.raw_response_sha256) throw new Error("선택한 발음 원문 확인값이 다릅니다.");
      const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (!Array.isArray(parsed)) throw new Error("발음 원문 목록이 올바르지 않습니다.");
      payload = parsed;
      cache.set(cacheKey, payload);
    }
    const match = /^payload\[(\d+)\] meta\.id=(.+) hwi\.prs\[(\d+)\]$/.exec(audio.source_locator!);
    if (!match) throw new Error("선택한 발음의 원문 위치가 올바르지 않습니다.");
    const original = payload[Number(match[1])] as { meta?: { id?: string }; fl?: string; hwi?: { hw?: string; prs?: { mw?: string; sound?: { audio?: string } }[] } } | undefined;
    const pronunciation = original?.hwi?.prs?.[Number(match[3])];
    const headword = normalize(entry.display_headword);
    if (!original?.meta?.id || original.meta.id !== match[2] || original.fl !== audio.variant_pos ||
      ![normalize(original.meta.id.split(":")[0]!), normalize(original.hwi?.hw ?? "")].includes(headword) ||
      pronunciation?.mw !== audio.mw_notation || pronunciation?.sound?.audio !== audio.sound_audio) {
      throw new Error("선택한 발음의 원표제어·품사·표기·음원이 일치하지 않습니다.");
    }
    const seed = { entry_index: Number(match[1]), meta_id: original.meta.id, pos: original.fl,
      pronunciation_index: Number(match[3]), mw_notation: pronunciation.mw, sound_audio: pronunciation.sound.audio };
    const sound = pronunciation.sound.audio;
    const folder = sound.toLowerCase().startsWith("bix") ? "bix" : sound.toLowerCase().startsWith("gg") ? "gg" : /^[a-z]/i.test(sound) ? sound[0]!.toLowerCase() : "number";
    if (audio.variant_id !== `mw:${sha256CanonicalJson(seed).slice(0, 20)}` ||
      audio.audio_url !== `https://media.merriam-webster.com/audio/prons/en/us/mp3/${folder}/${sound}.mp3`) {
      throw new Error("선택한 발음의 식별자 또는 음원 주소가 원문과 다릅니다.");
    }
  }
}

// Keep the existing exact legacy package policy intact. This separate importer
// additionally requires a database approval pinned to the reviewed file.
export function assertReviewedMockEnvironment(url: string, expectedProjectRef: string) {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url);
  if (!match || match[1] !== expectedProjectRef || !["wojxpruvbjzbhrpmsbuy", "xdxhswjgksukjmpbzqgz"].includes(expectedProjectRef)) {
    throw new Error("검토 원고를 적용할 프로젝트가 명시한 대상과 다릅니다.");
  }
  return expectedProjectRef;
}

export function sealReviewedMockBundle(input: ReviewedMockBundle): ReviewedMockBundle {
  for (const entry of input.package.entries) {
    entry.content_hash = computeExamUseEntryContentHash(entry as unknown as Record<string, unknown>);
  }
  input.package.exam_review_ledger_sha256 = sha256CanonicalJson([...input.resources].sort((a, b) => a.source_row - b.source_row).map(row => row.review_records));
  input.package.manifest_content_hash = sha256CanonicalJson(input.scopes);
  input.package.package_version = computeExamUsePackageVersion(input.package as unknown as Record<string, unknown>);
  input.content_sha256 = sha256CanonicalJson(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "content_sha256")) as Parameters<typeof sha256CanonicalJson>[0]);
  return input;
}
