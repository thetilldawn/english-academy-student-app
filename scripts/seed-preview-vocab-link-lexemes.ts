import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

const PREVIEW_PROJECT_REF = "wojxpruvbjzbhrpmsbuy";
// One-time recovery input; keep this script Preview-only.
const APPROVED_LEXEME_FILE_SHA256 =
  "47A71EDE0CFC76244763E11A068D4E71E91B32754458971861B5F86D58C76066";

type LinkRow = {
  mappingStatus: string;
  lexemeId: string | null;
  lexemeContentHash: string | null;
  nonWordCandidates: Array<{
    lexemeId: string;
    headword: string;
    lexemeType: string;
  }>;
};

type LexemeRow = {
  lexeme_id: string;
  headword: string;
  lexeme_type: string;
  canonical_lexeme_id: string | null;
  content_hash: string;
};

type Manifest = {
  wordIndex: {
    buildId: string;
    inputSnapshotSha256: string;
  };
  counts: {
    exactLinkedUniqueHeadwords: number;
  };
  files: Array<{ file: string; sha256: string }>;
  packageSnapshotSha256: string;
};

function optionValue(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function projectRef(value: string) {
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] ?? null : null;
  } catch {
    return null;
  }
}

async function sha256(file: string) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex")
    .toUpperCase();
}

async function jsonLines<T>(file: string) {
  return (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const packageDir = path.resolve(
    optionValue(arguments_, "--package-dir") ?? "",
  );
  const lexemeFile = path.resolve(
    optionValue(arguments_, "--lexeme-file") ?? "",
  );
  const envDir = path.resolve(optionValue(arguments_, "--env-dir") ?? "");
  const expectedProjectRef = optionValue(
    arguments_,
    "--expected-project-ref",
  );
  const apply = arguments_.includes("--apply");
  const candidateOnly = arguments_.includes("--candidate-only");
  const finalize = arguments_.includes("--finalize");
  const wordIndexFileOption = optionValue(arguments_, "--word-index-file");
  if (
    !optionValue(arguments_, "--package-dir") ||
    !optionValue(arguments_, "--lexeme-file")
  ) {
    throw new Error("--package-dir와 --lexeme-file이 필요합니다.");
  }
  if ((await sha256(lexemeFile)) !== APPROVED_LEXEME_FILE_SHA256) {
    throw new Error("공용 단어 JSONL SHA가 다릅니다.");
  }

  const manifest = JSON.parse(
    await fs.readFile(path.join(packageDir, "manifest.json"), "utf8"),
  ) as Manifest;
  const linkManifest = manifest.files.find(
    (file) => file.file === "entry_lexeme_link.jsonl",
  );
  if (!linkManifest) throw new Error("연결 패키지 명세가 없습니다.");
  const linkFile = path.join(packageDir, linkManifest.file);
  if ((await sha256(linkFile)) !== linkManifest.sha256) {
    throw new Error("연결 패키지 SHA가 다릅니다.");
  }

  const [links, lexemes] = await Promise.all([
    jsonLines<LinkRow>(linkFile),
    jsonLines<LexemeRow>(lexemeFile),
  ]);
  const exactHashes = new Map<string, string>();
  const candidateIdentities = new Map<
    string,
    { headword: string; lexemeType: string }
  >();
  for (const link of links) {
    for (const candidate of link.nonWordCandidates) {
      const previous = candidateIdentities.get(candidate.lexemeId);
      if (
        previous &&
        (previous.headword !== candidate.headword ||
          previous.lexemeType !== candidate.lexemeType)
      ) {
        throw new Error(`후보 단어 ID의 신분값이 다릅니다: ${candidate.lexemeId}`);
      }
      candidateIdentities.set(candidate.lexemeId, candidate);
    }
    if (link.mappingStatus !== "exact_headword_unreviewed") continue;
    if (!link.lexemeId || !link.lexemeContentHash) {
      throw new Error("정확 연결에 단어 ID 또는 내용 SHA가 없습니다.");
    }
    const expected = link.lexemeContentHash.toUpperCase();
    const previous = exactHashes.get(link.lexemeId);
    if (previous && previous !== expected) {
      throw new Error(`같은 단어 ID의 내용 SHA가 다릅니다: ${link.lexemeId}`);
    }
    exactHashes.set(link.lexemeId, expected);
  }
  const lexemeById = new Map(lexemes.map((row) => [row.lexeme_id, row]));
  const selected = [...exactHashes]
    .map(([lexemeId, expectedHash]) => {
      const row = lexemeById.get(lexemeId);
      if (!row || row.content_hash.toUpperCase() !== expectedHash) {
        throw new Error(`공용 단어 원장 결속값이 다릅니다: ${lexemeId}`);
      }
      if (row.canonical_lexeme_id !== null) {
        throw new Error(`선행 단어 ID가 필요한 행입니다: ${lexemeId}`);
      }
      return row;
    })
    .sort((left, right) => left.lexeme_id.localeCompare(right.lexeme_id));
  const candidates = [...candidateIdentities]
    .map(([lexemeId, expected]) => {
      const row = lexemeById.get(lexemeId);
      if (
        !row ||
        row.headword !== expected.headword ||
        row.lexeme_type !== expected.lexemeType
      ) {
        throw new Error(`후보 단어 원장 신분값이 다릅니다: ${lexemeId}`);
      }
      if (row.canonical_lexeme_id !== null) {
        throw new Error(`선행 단어 ID가 필요한 후보 행입니다: ${lexemeId}`);
      }
      return row;
    })
    .sort((left, right) => left.lexeme_id.localeCompare(right.lexeme_id));
  if (
    selected.length !== manifest.counts.exactLinkedUniqueHeadwords ||
    selected.length !== 1977
  ) {
    throw new Error(`공용 단어 신분표 수가 다릅니다: ${selected.length}`);
  }
  if (candidates.length !== 2) {
    throw new Error(`후보 단어 신분표 수가 다릅니다: ${candidates.length}`);
  }

  const rowsToApply = candidateOnly ? candidates : selected;
  const allRequired = [...selected, ...candidates].sort((left, right) =>
    left.lexeme_id.localeCompare(right.lexeme_id),
  );
  if (allRequired.length !== 1979) {
    throw new Error(`전체 공용 단어 신분표 수가 다릅니다: ${allRequired.length}`);
  }
  let wordIndexPackageSha256: string | null = null;
  if (finalize) {
    if (!wordIndexFileOption) {
      throw new Error("--finalize에는 --word-index-file이 필요합니다.");
    }
    wordIndexPackageSha256 = await sha256(path.resolve(wordIndexFileOption));
    if (
      wordIndexPackageSha256 !==
      "899E7F8611611347E1B2D7249C877C3583D33CE4DEEDCF9BF304159CD4C6FCA7"
    ) {
      throw new Error("공용 단어 원장 SQLite SHA가 다릅니다.");
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    subset: finalize
      ? "audit-finalize"
      : candidateOnly
        ? "mapping-candidates"
        : "exact-links",
    buildId: manifest.wordIndex.buildId,
    inputSnapshotSha256: manifest.wordIndex.inputSnapshotSha256.toUpperCase(),
    linkPackageSnapshotSha256: manifest.packageSnapshotSha256,
    selectedLexemes: finalize ? allRequired.length : rowsToApply.length,
    wordIndexPackageSha256,
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!expectedProjectRef) {
    throw new Error("--apply에는 --expected-project-ref가 필요합니다.");
  }
  if (expectedProjectRef !== PREVIEW_PROJECT_REF) {
    throw new Error("이 복구 스크립트는 승인된 Preview 전용입니다.");
  }

  loadEnvConfig(envDir);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const actualProjectRef = projectRef(supabaseUrl);
  if (!actualProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error("Supabase 프로젝트 ref 안전장치가 일치하지 않습니다.");
  }
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY가 필요합니다.");

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  if (finalize) {
    const members = allRequired.map((row) => ({
      lexeme_id: row.lexeme_id,
      content_hash: row.content_hash.toUpperCase(),
    }));
    const { data, error } = await supabase.rpc(
      "finalize_preview_vocab_link_lexeme_seed_v1",
      {
        p_dataset_key: "ability-voca-etymology-2025",
        p_build_id: manifest.wordIndex.buildId,
        p_input_snapshot_sha256:
          manifest.wordIndex.inputSnapshotSha256.toUpperCase(),
        p_link_package_snapshot_sha256: manifest.packageSnapshotSha256,
        p_word_index_package_sha256: wordIndexPackageSha256,
        p_members: members,
      },
    );
    if (error) {
      throw new Error(`공용 단어 신분표 최종 장부 확정 실패: ${error.message}`);
    }
    console.log(
      JSON.stringify(
        { ...summary, projectRef: actualProjectRef, result: data },
        null,
        2,
      ),
    );
    return;
  }
  let insertedRows = 0;
  let existingRows = 0;
  const batchSize = 200;
  for (let offset = 0; offset < rowsToApply.length; offset += batchSize) {
    const rows = rowsToApply.slice(offset, offset + batchSize);
    const batchNo =
      (candidateOnly ? 1000 : 0) + Math.floor(offset / batchSize) + 1;
    const { data, error } = await supabase.rpc(
      "seed_preview_vocab_link_lexeme_batch_v1",
      {
        p_build_id: manifest.wordIndex.buildId,
        p_input_snapshot_sha256:
          manifest.wordIndex.inputSnapshotSha256.toUpperCase(),
        p_link_package_snapshot_sha256: manifest.packageSnapshotSha256,
        p_batch_no: batchNo,
        p_rows: rows,
      },
    );
    if (error) {
      throw new Error(`공용 단어 신분표 ${batchNo}차 반영 실패: ${error.message}`);
    }
    const result = data as {
      receivedRows: number;
      insertedRows: number;
      existingRows: number;
    };
    if (result.receivedRows !== rows.length) {
      throw new Error(`공용 단어 신분표 ${batchNo}차 수량이 다릅니다.`);
    }
    insertedRows += result.insertedRows;
    existingRows += result.existingRows;
    console.log(JSON.stringify({ batchNo, ...result }));
  }
  console.log(
    JSON.stringify(
      {
        ...summary,
        projectRef: actualProjectRef,
        insertedRows,
        existingRows,
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
