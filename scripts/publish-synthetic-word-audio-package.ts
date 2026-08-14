import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  validateSyntheticWordAudioFiles,
  type SyntheticWordAudioManifest,
  type SyntheticWordAudioManifestItem,
} from "../src/lib/vocab/synthetic-word-audio-import-contract";

const BUCKET = "vocab-pronunciation-audio";
const FILE_SIZE_LIMIT = 1_048_576;
const MIME_TYPE = "audio/mpeg";
const CACHE_CONTROL_SECONDS = "31536000";

type Options = {
  manifest: string;
  expectedProjectRef: string | null;
  mode: "dry-run" | "preflight" | "apply";
};

function parseOptions(arguments_: string[]): Options {
  const manifestIndex = arguments_.indexOf("--manifest");
  const refIndex = arguments_.indexOf("--expected-project-ref");
  const manifest =
    manifestIndex >= 0 ? arguments_[manifestIndex + 1] : undefined;
  const modes = ["--preflight", "--apply"].filter((flag) =>
    arguments_.includes(flag),
  );
  if (!manifest) throw new Error("--manifest <단어 합성 음원 manifest>가 필요합니다.");
  if (modes.length > 1) throw new Error("실행 모드는 하나만 선택해야 합니다.");
  return {
    manifest,
    expectedProjectRef:
      refIndex >= 0 ? (arguments_[refIndex + 1] ?? null) : null,
    mode: arguments_.includes("--apply")
      ? "apply"
      : arguments_.includes("--preflight")
        ? "preflight"
        : "dry-run",
  };
}

function projectRef(supabaseUrl: string) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function withConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      await operation(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
}

async function ensureBucket(supabase: SupabaseClient, apply: boolean) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Storage 버킷을 확인하지 못했습니다: ${error.message}`);
  const existing = buckets.find((bucket) => bucket.id === BUCKET);
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
  const allowedMimeTypes = existing.allowed_mime_types ?? [];
  if (
    existing.public !== true ||
    existing.file_size_limit !== FILE_SIZE_LIMIT ||
    allowedMimeTypes.length !== 1 ||
    allowedMimeTypes[0] !== MIME_TYPE
  ) {
    throw new Error("기존 합성 음원 버킷 설정이 고정 계약과 다릅니다.");
  }
  return { exists: true, created: false };
}

async function existingObjectNames(
  supabase: SupabaseClient,
  items: readonly SyntheticWordAudioManifestItem[],
) {
  const first = items[0];
  const prefix = first.storage_object_key.slice(
    0,
    first.storage_object_key.lastIndexOf("/"),
  );
  if (
    !items.every((item) =>
      item.storage_object_key.startsWith(`${prefix}/`),
    )
  ) {
    throw new Error("단어 합성 batch의 Storage profile 경로가 하나가 아닙니다.");
  }
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Storage 객체 목록을 읽지 못했습니다: ${error.message}`);
  return new Set((data ?? []).map((item) => item.name));
}

async function downloadAndVerify(
  supabase: SupabaseClient,
  item: SyntheticWordAudioManifestItem,
) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(item.storage_object_key);
  if (error || !data) {
    throw new Error(
      `업로드 단어 음원을 다시 확인하지 못했습니다: ${item.speech_text} ${error?.message ?? "no data"}`,
    );
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== item.byte_count || sha256(bytes) !== item.audio_sha256) {
    throw new Error(`Storage 단어 음원 해시가 다릅니다: ${item.speech_text}`);
  }
}

async function publishObjects(
  supabase: SupabaseClient,
  files: Awaited<ReturnType<typeof validateSyntheticWordAudioFiles>>["files"],
) {
  const names = await existingObjectNames(
    supabase,
    files.map((file) => file.item),
  );
  let uploaded = 0;
  let reused = 0;
  await withConcurrency(files, 6, async ({ item, value }, index) => {
    const fileName = item.storage_object_key.slice(
      item.storage_object_key.lastIndexOf("/") + 1,
    );
    if (names.has(fileName)) {
      await downloadAndVerify(supabase, item);
      reused += 1;
    } else {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(item.storage_object_key, value, {
          cacheControl: CACHE_CONTROL_SECONDS,
          contentType: MIME_TYPE,
          upsert: false,
        });
      if (error) {
        throw new Error(`단어 합성 음원 업로드 실패: ${item.speech_text} ${error.message}`);
      }
      await downloadAndVerify(supabase, item);
      uploaded += 1;
    }
    if ((index + 1) % 10 === 0 || index + 1 === files.length) {
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

async function verifyDatabase(
  supabase: SupabaseClient,
  manifest: SyntheticWordAudioManifest,
) {
  const { data: bindingData, error: bindingError } = await supabase
    .from("vocab_synthetic_audio_bindings")
    .select(
      "release_id, vocab_entry_id, dictionary_id, occurrence_id, asset_id, source_queue_item_sha256",
    )
    .eq("dataset_key", manifest.dataset_key)
    .eq("source_exam_package_version", manifest.source_exam_package_version)
    .eq("profile_id", manifest.profile_id)
    .order("occurrence_id");
  if (bindingError) throw new Error(`단어 음원 출현 연결 readback 실패: ${bindingError.message}`);
  const bindingRows = bindingData ?? [];
  if (
    bindingRows.length !== 29 ||
    bindingRows.some(
      (row) => typeof row.release_id !== "string" || typeof row.vocab_entry_id !== "number",
    )
  ) {
    throw new Error("단어 음원 출현 연결 수 또는 authoritative ID가 다릅니다.");
  }
  const expectedByOccurrence = new Map(
    manifest.items.flatMap((item) =>
      item.occurrence_ids.map((occurrenceId) => [occurrenceId, item] as const),
    ),
  );
  for (const row of bindingRows) {
    const item = expectedByOccurrence.get(row.occurrence_id);
    if (
      !item ||
      row.dictionary_id !== item.dictionary_id ||
      row.asset_id !== item.asset_id ||
      row.source_queue_item_sha256 !== item.source_queue_item_sha256
    ) {
      throw new Error(`단어 음원 출현 결속값이 다릅니다: ${row.occurrence_id}`);
    }
  }

  const assetIds = [...new Set(bindingRows.map((row) => row.asset_id))];
  const { data: assetData, error: assetError } = await supabase
    .from("vocab_synthetic_audio_assets")
    .select(
      "asset_id, dictionary_id, speech_text, profile_id, pronunciation_variant_id, pronunciation_identity_type, pronunciation_mode, canonical_ipa, google_tts_ipa, request_sha256, audio_sha256, storage_object_key, playback_enabled",
    )
    .in("asset_id", assetIds)
    .order("dictionary_id");
  if (assetError) throw new Error(`단어 합성 자산 readback 실패: ${assetError.message}`);
  const assetRows = assetData ?? [];
  const expectedByAsset = new Map(
    manifest.items.map((item) => [item.asset_id, item] as const),
  );
  if (assetRows.length !== 28 || assetRows.some((row) => row.playback_enabled !== true)) {
    throw new Error("단어 합성 자산 수 또는 재생 상태가 manifest와 다릅니다.");
  }
  for (const row of assetRows) {
    const item = expectedByAsset.get(row.asset_id);
    if (
      !item ||
      row.dictionary_id !== item.dictionary_id ||
      row.speech_text !== item.speech_text ||
      row.profile_id !== item.profile_id ||
      row.pronunciation_variant_id !== item.pronunciation_variant_id ||
      row.pronunciation_identity_type !== item.pronunciation_identity_type ||
      row.pronunciation_mode !== item.pronunciation_mode ||
      row.canonical_ipa !== item.canonical_ipa ||
      row.google_tts_ipa !== item.google_tts_ipa ||
      row.request_sha256 !== item.request_sha256 ||
      row.audio_sha256 !== item.audio_sha256 ||
      row.storage_object_key !== item.storage_object_key
    ) {
      throw new Error(`단어 합성 자산 결속값이 다릅니다: ${row.asset_id}`);
    }
  }
  return { assetRows, bindingRows };
}

async function verifyPublicCanary(
  supabase: SupabaseClient,
  manifest: SyntheticWordAudioManifest,
) {
  const canary = manifest.items.find((item) => item.speech_text === "selflessness");
  if (!canary) throw new Error("selflessness 공개 검증 자산이 없습니다.");
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(canary.storage_object_key);
  const response = await fetch(data.publicUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`단어 공개 음원 응답 실패: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const value = Buffer.from(await response.arrayBuffer());
  if (
    contentType !== MIME_TYPE ||
    value.length !== canary.byte_count ||
    sha256(value) !== canary.audio_sha256
  ) {
    throw new Error("selflessness 공개 단어 음원 검증에 실패했습니다.");
  }
  return { publicUrl: data.publicUrl, contentType, byteCount: value.length };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const raw = JSON.parse(await readFile(options.manifest, "utf8")) as unknown;
  const validated = await validateSyntheticWordAudioFiles(options.manifest, raw);
  if (options.mode === "dry-run") {
    console.log(JSON.stringify({ mode: "dry-run", llmTokens: 0, ...validated.summary }, null, 2));
    return;
  }

  loadEnvConfig(process.cwd());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRef(supabaseUrl);
  if (
    !options.expectedProjectRef ||
    !actualProjectRef ||
    options.expectedProjectRef !== actualProjectRef
  ) {
    throw new Error("Supabase 프로젝트 ref 안전장치가 일치하지 않습니다.");
  }
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const bucket = await ensureBucket(supabase, options.mode === "apply");
  const { error: assetTableError } = await supabase
    .from("vocab_synthetic_audio_assets")
    .select("asset_id, pronunciation_variant_id", { count: "exact", head: true });
  const { error: bindingTableError } = await supabase
    .from("vocab_synthetic_audio_bindings")
    .select("asset_id, release_id, vocab_entry_id", { count: "exact", head: true });
  if (assetTableError || bindingTableError) {
    throw new Error("단어 합성 음원 DB migration이 준비되지 않았습니다.");
  }
  if (options.mode === "preflight") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "preflight",
          projectRef: actualProjectRef,
          bucket,
          llmTokens: 0,
          ...validated.summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const storage = await publishObjects(supabase, validated.files);
  const { data: importResult, error: importError } = await supabase.rpc(
    "import_vocab_synthetic_word_audio_package_v1",
    { p_package: validated.manifest },
  );
  if (importError) {
    throw new Error(`단어 합성 음원 DB 등록 실패: ${importError.code} ${importError.message}`);
  }
  const database = await verifyDatabase(supabase, validated.manifest);
  const publicCanary = await verifyPublicCanary(supabase, validated.manifest);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: "apply",
        projectRef: actualProjectRef,
        bucket,
        storage,
        databaseResult: importResult,
        databaseAssetCount: database.assetRows.length,
        databaseOccurrenceBindingCount: database.bindingRows.length,
        publicCanary,
        llmTokens: 0,
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
