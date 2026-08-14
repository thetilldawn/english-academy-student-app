import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateVocabPronunciationReleaseV2,
} from "../src/lib/vocab/vocab-pronunciation-release-v2-contract";

const TARGET_REFS = {
  staging: "wojxpruvbjzbhrpmsbuy",
  production: "xdxhswjgksukjmpbzqgz",
} as const;
const BUCKET = "vocab-pronunciation-audio";
const MIME_TYPE = "audio/mpeg";
const FILE_SIZE_LIMIT = 1_048_576;
const CACHE_CONTROL_SECONDS = "31536000";
const LOWER_SHA256 = /^[0-9a-f]{64}$/;

type Target = keyof typeof TARGET_REFS;
type ManifestItem = {
  candidate_id: string;
  headword: string;
  source_rows: number[];
  request_sha256: string;
  audio_sha256: string;
  byte_count: number;
  file_name: string;
  storage_bucket: string;
  storage_object_key: string;
  profile_id: string;
  model: string;
  voice: string;
  pronunciation_variant_id: string;
  playback_enabled: boolean;
};
type Manifest = {
  schema_version: string;
  status: string;
  dataset_key: string;
  source_plan_version: string;
  profile_id: string;
  asset_count: number;
  binding_count: number;
  total_byte_count: number;
  manifest_sha256: string;
  items: ManifestItem[];
};
type LocalAsset = { item: ManifestItem; value: Buffer };

function optionValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function parseOptions(arguments_: string[]) {
  const manifest = optionValue(arguments_, "--manifest");
  const release = optionValue(arguments_, "--release");
  const target = optionValue(arguments_, "--target");
  const envDir = optionValue(arguments_, "--env-dir") ?? process.cwd();
  const modes = ["--preflight", "--apply"].filter((flag) =>
    arguments_.includes(flag),
  );
  if (!manifest || !release) {
    throw new Error("--manifest와 --release가 모두 필요합니다.");
  }
  if (target !== "staging" && target !== "production") {
    throw new Error("--target staging|production이 필요합니다.");
  }
  if (modes.length > 1) throw new Error("실행 모드는 하나만 선택해야 합니다.");
  return {
    manifest,
    release,
    target: target as Target,
    envDir,
    mode: arguments_.includes("--apply")
      ? ("apply" as const)
      : arguments_.includes("--preflight")
        ? ("preflight" as const)
        : ("dry-run" as const),
  };
}

function projectRef(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.endsWith(".supabase.co")
      ? (hostname.split(".")[0] ?? null)
      : null;
  } catch {
    return null;
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

function manifestHash(value: unknown, uppercase = false) {
  // The Python generator intentionally serializes the approved +4 dB value as
  // `4.0`. JSON.parse loses that lexical decimal, so restore it before hashing.
  const canonical = JSON.stringify(stableValue(value)).replace(
    /"volume_gain_db":4(?=[,}])/g,
    '"volume_gain_db":4.0',
  );
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return uppercase ? hash.toUpperCase() : hash;
}

function isMp3(value: Buffer) {
  return (
    value.length >= 128 &&
    (value.subarray(0, 3).toString("ascii") === "ID3" ||
      (value[0] === 0xff && (value[1] & 0xe0) === 0xe0))
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Google TTS manifest 형식이 올바르지 않습니다.");
  }
  return value as Record<string, unknown>;
}

async function validateManifestFiles(
  manifestPath: string,
  rawManifest: unknown,
  rawRelease: unknown,
) {
  const manifest = objectValue(rawManifest) as unknown as Manifest;
  const { release } = validateVocabPronunciationReleaseV2(rawRelease);
  if (
    manifest.schema_version !== "google-chirp-voca-word-audio-batch-v1" ||
    manifest.status !== "complete" ||
    manifest.dataset_key !== release.dataset_key ||
    manifest.source_plan_version !== release.source_plan_version ||
    manifest.profile_id !== "profile:75ca7f418d66e6ab" ||
    !Array.isArray(manifest.items) ||
    manifest.asset_count !== manifest.items.length ||
    manifest.asset_count !== release.summary.tts_asset_count ||
    manifest.binding_count !== release.summary.tts_binding_count ||
    manifest.total_byte_count !==
      manifest.items.reduce((total, item) => total + item.byte_count, 0)
  ) {
    throw new Error("Google TTS manifest와 VOCA release 집계가 다릅니다.");
  }
  const manifestWithoutHash = { ...manifest } as Record<string, unknown>;
  delete manifestWithoutHash.manifest_sha256;
  if (
    !LOWER_SHA256.test(manifest.manifest_sha256) ||
    manifestHash(manifestWithoutHash) !== manifest.manifest_sha256 ||
    manifestHash(manifest, true) !== release.source_tts_manifest_sha256
  ) {
    throw new Error("Google TTS manifest 해시가 다릅니다.");
  }
  const ttsByRequest = new Map(
    release.identities.flatMap((identity) =>
      identity.audio_provider === "google_cloud_text_to_speech" &&
      identity.request_sha256
        ? [[identity.request_sha256, identity] as const]
        : [],
    ),
  );
  const seenRequests = new Set<string>();
  const seenCandidates = new Set<string>();
  const sourceRows = new Set<number>();
  const files: LocalAsset[] = [];
  for (const item of manifest.items) {
    const identity = ttsByRequest.get(item.request_sha256);
    if (
      !identity ||
      seenRequests.has(item.request_sha256) ||
      seenCandidates.has(item.candidate_id) ||
      !LOWER_SHA256.test(item.request_sha256) ||
      !LOWER_SHA256.test(item.audio_sha256) ||
      item.pronunciation_variant_id !== `synthetic:${item.request_sha256}` ||
      item.file_name !== `${item.request_sha256}.mp3` ||
      item.storage_bucket !== identity.storage_bucket ||
      item.storage_object_key !== identity.storage_object_key ||
      item.audio_sha256 !== identity.audio_sha256 ||
      item.byte_count !== identity.byte_count ||
      item.profile_id !== identity.profile_id ||
      item.model !== identity.model ||
      item.voice !== identity.voice ||
      item.playback_enabled !== true ||
      !Array.isArray(item.source_rows) ||
      item.source_rows.length === 0
    ) {
      throw new Error(`Google TTS 자산 결속값이 다릅니다: ${item.headword}`);
    }
    seenRequests.add(item.request_sha256);
    seenCandidates.add(item.candidate_id);
    for (const sourceRow of item.source_rows) {
      if (sourceRows.has(sourceRow)) {
        throw new Error(`Google TTS 출처 행이 중복됐습니다: ${sourceRow}`);
      }
      sourceRows.add(sourceRow);
    }
    const filePath = path.resolve(
      path.dirname(manifestPath),
      "objects",
      item.file_name,
    );
    const value = await readFile(filePath);
    if (
      !isMp3(value) ||
      value.length !== item.byte_count ||
      sha256(value) !== item.audio_sha256
    ) {
      throw new Error(`로컬 Google TTS MP3 검증 실패: ${item.headword}`);
    }
    files.push({ item, value });
  }
  const expectedTtsRows = new Set(
    release.bindings.flatMap((binding) => {
      const identity = release.identities.find(
        ({ identity_id }) => identity_id === binding.identity_id,
      );
      return identity?.audio_provider === "google_cloud_text_to_speech"
        ? [binding.source_row]
        : [];
    }),
  );
  if (
    sourceRows.size !== expectedTtsRows.size ||
    [...sourceRows].some((sourceRow) => !expectedTtsRows.has(sourceRow))
  ) {
    throw new Error("Google TTS 437개 출처 행과 VOCA release가 다릅니다.");
  }
  return { manifest, release, files };
}

async function withConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      await operation(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
}

async function ensureBucket(supabase: SupabaseClient, apply: boolean) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Storage 버킷 조회 실패: ${error.message}`);
  const existing = data.find(({ id }) => id === BUCKET);
  if (!existing) {
    if (!apply) return { exists: false, created: false };
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: [MIME_TYPE],
    });
    if (createError) throw new Error(`Storage 버킷 생성 실패: ${createError.message}`);
    return { exists: true, created: true };
  }
  if (
    existing.public !== true ||
    existing.file_size_limit !== FILE_SIZE_LIMIT ||
    existing.allowed_mime_types?.length !== 1 ||
    existing.allowed_mime_types[0] !== MIME_TYPE
  ) {
    throw new Error("기존 발음 Storage 버킷 설정이 고정 계약과 다릅니다.");
  }
  return { exists: true, created: false };
}

async function downloadAndVerify(supabase: SupabaseClient, asset: LocalAsset) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(asset.item.storage_object_key);
  if (error || !data) {
    throw new Error(`Storage 음원 readback 실패: ${asset.item.headword}`);
  }
  const value = Buffer.from(await data.arrayBuffer());
  if (
    value.length !== asset.item.byte_count ||
    sha256(value) !== asset.item.audio_sha256
  ) {
    throw new Error(`Storage 음원 해시 불일치: ${asset.item.headword}`);
  }
}

async function publishObjects(supabase: SupabaseClient, files: LocalAsset[]) {
  const prefix = path.posix.dirname(files[0].item.storage_object_key);
  if (
    files.some(
      ({ item }) => path.posix.dirname(item.storage_object_key) !== prefix,
    )
  ) {
    throw new Error("Google TTS Storage 경로가 하나의 고정 prefix가 아닙니다.");
  }
  const { data: listed, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (listError) throw new Error(`Storage 객체 목록 조회 실패: ${listError.message}`);
  const existingNames = new Set((listed ?? []).map(({ name }) => name));
  let uploaded = 0;
  let reused = 0;
  await withConcurrency(files, 6, async (asset, index) => {
    if (existingNames.has(asset.item.file_name)) {
      await downloadAndVerify(supabase, asset);
      reused += 1;
    } else {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(asset.item.storage_object_key, asset.value, {
          cacheControl: CACHE_CONTROL_SECONDS,
          contentType: MIME_TYPE,
          upsert: false,
        });
      if (error) {
        throw new Error(
          `Storage 업로드 실패: ${asset.item.headword} (${error.message})`,
        );
      }
      await downloadAndVerify(supabase, asset);
      uploaded += 1;
    }
    if ((index + 1) % 50 === 0 || index + 1 === files.length) {
      console.log(
        JSON.stringify({
          status: "storage_verified",
          checked: index + 1,
          total: files.length,
        }),
      );
    }
  });
  return { uploaded, reused };
}

async function registerVerifiedAssets(
  supabase: SupabaseClient,
  files: LocalAsset[],
) {
  const items = files.map(({ item }) => ({
    request_sha256: item.request_sha256,
    audio_sha256: item.audio_sha256,
    byte_count: item.byte_count,
    storage_bucket: item.storage_bucket,
    storage_object_key: item.storage_object_key,
    profile_id: item.profile_id,
    model: item.model,
    voice: item.voice,
    storage_verified: true,
  }));
  for (let offset = 0; offset < items.length; offset += 100) {
    const { error } = await supabase.rpc(
      "register_vocab_pronunciation_tts_asset_batch_v2",
      { p_items: items.slice(offset, offset + 100) },
    );
    if (error) {
      throw new Error(`검증된 TTS 자산 DB 등록 실패: ${error.code} ${error.message}`);
    }
  }
  const requestHashes = items.map(({ request_sha256 }) => request_sha256);
  let checked = 0;
  for (let offset = 0; offset < requestHashes.length; offset += 200) {
    const { data, error } = await supabase
      .from("vocab_pronunciation_tts_assets_v2")
      .select("request_sha256, storage_verified")
      .in("request_sha256", requestHashes.slice(offset, offset + 200));
    if (error) throw new Error(`TTS 자산 DB readback 실패: ${error.message}`);
    checked += (data ?? []).filter(({ storage_verified }) => storage_verified).length;
  }
  if (checked !== items.length) throw new Error("TTS 자산 DB 등록 수가 다릅니다.");
  return { registered: checked };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [rawManifest, rawRelease] = await Promise.all([
    readFile(options.manifest, "utf8").then(JSON.parse),
    readFile(options.release, "utf8").then(JSON.parse),
  ]);
  const validated = await validateManifestFiles(
    options.manifest,
    rawManifest,
    rawRelease,
  );
  if (options.mode === "dry-run") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "dry-run",
          target: options.target,
          assetCount: validated.files.length,
          bindingCount: validated.manifest.binding_count,
          totalByteCount: validated.manifest.total_byte_count,
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
  if (actualRef !== TARGET_REFS[options.target]) {
    throw new Error(`Supabase ${options.target} 프로젝트 ref 안전장치가 다릅니다.`);
  }
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const bucket = await ensureBucket(supabase, options.mode === "apply");
  const { error: tableError } = await supabase
    .from("vocab_pronunciation_tts_assets_v2")
    .select("request_sha256", { count: "exact", head: true });
  if (tableError) throw new Error("VOCA 발음 v2 migration이 준비되지 않았습니다.");
  if (options.mode === "preflight") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "preflight",
          target: options.target,
          projectRef: actualRef,
          bucket,
          assetCount: validated.files.length,
          bindingCount: validated.manifest.binding_count,
        },
        null,
        2,
      ),
    );
    return;
  }
  const storage = await publishObjects(supabase, validated.files);
  const database = await registerVerifiedAssets(supabase, validated.files);
  const canary = validated.files[0];
  const { data: publicData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(canary.item.storage_object_key);
  const response = await fetch(publicData.publicUrl, { cache: "no-store" });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";")[0] !== MIME_TYPE ||
    sha256(responseBytes) !== canary.item.audio_sha256
  ) {
    throw new Error("공개 TTS canary 검증에 실패했습니다.");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        target: options.target,
        projectRef: actualRef,
        bucket,
        storage,
        database,
        canary: {
          headword: canary.item.headword,
          contentType: MIME_TYPE,
          byteCount: responseBytes.length,
        },
        assetCount: validated.files.length,
        bindingCount: validated.manifest.binding_count,
        totalByteCount: validated.manifest.total_byte_count,
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
