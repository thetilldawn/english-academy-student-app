import fs from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  assertVocabularyImportApplyAllowed,
  normalizeVocabularyImport,
} from "@/lib/vocab/import-contract";

type CliOptions = {
  file: string;
  apply: boolean;
  markReady: boolean;
};

function parseOptions(args: string[]): CliOptions {
  let file = "";
  let apply = false;
  let markReady = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--file") {
      file = args[index + 1] ?? "";
      index += 1;
    } else if (argument === "--apply") {
      apply = true;
    } else if (argument === "--mark-ready") {
      markReady = true;
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${argument}`);
    }
  }

  if (!file) {
    throw new Error(
      "사용법: npm run import:vocab -- --file <검수본.json> [--apply] [--mark-ready]",
    );
  }
  if (markReady && !apply) {
    throw new Error("--mark-ready는 --apply와 함께 사용해야 합니다.");
  }

  return { file: path.resolve(file), apply, markReady };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const rawText = await fs.readFile(options.file, "utf8");
  const normalized = normalizeVocabularyImport(JSON.parse(rawText));

  const summary = {
    mode: options.apply ? "apply" : "dry-run",
    datasetKey: normalized.file.dataset.datasetKey,
    title: normalized.file.dataset.title,
    sourceSha256: normalized.file.dataset.sourceSha256,
    ...normalized.audit,
    requestedStatus: options.markReady ? "ready" : "pending_review",
  };

  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      "검증만 완료했습니다. 데이터베이스 쓰기는 0건입니다.",
    );
    return;
  }

  assertVocabularyImportApplyAllowed(normalized.file, options.markReady);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY가 필요합니다.",
    );
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { data: existing, error: existingError } = await supabase
    .from("vocab_datasets")
    .select("id, source_sha256, row_count, status")
    .eq("dataset_key", normalized.file.dataset.datasetKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`기존 데이터셋 확인 실패: ${existingError.message}`);
  }
  if (
    existing &&
    existing.source_sha256 !== normalized.file.dataset.sourceSha256
  ) {
    throw new Error(
      "같은 데이터셋 키에 다른 원본 SHA가 있습니다. 자동 교체하지 않습니다.",
    );
  }

  let datasetId = existing?.id as string | undefined;
  if (!datasetId) {
    const { data, error } = await supabase
      .from("vocab_datasets")
      .insert({
        dataset_key: normalized.file.dataset.datasetKey,
        title: normalized.file.dataset.title,
        edition: normalized.file.dataset.edition,
        source_label: normalized.file.dataset.sourceLabel,
        source_sha256: normalized.file.dataset.sourceSha256,
        row_count: normalized.audit.rowCount,
        status: "pending_review",
        metadata: {
          schemaVersion: normalized.file.schemaVersion,
          sourceSheet: normalized.file.dataset.sourceSheet,
          duplicateHeadwordGroups:
            normalized.audit.duplicateHeadwordGroups,
          repeatedHeadwordRows: normalized.audit.repeatedHeadwordRows,
          ambiguousMeaningGroups:
            normalized.audit.ambiguousMeaningGroups,
        },
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`데이터셋 생성 실패: ${error?.message ?? "unknown"}`);
    }
    datasetId = data.id;
  }

  const { data: unitData, error: unitError } = await supabase
    .from("vocab_units")
    .upsert(
      normalized.units.map((unit) => ({
        dataset_id: datasetId,
        unit_label: unit.unitLabel,
        normalized_label: unit.normalizedLabel,
        unit_kind: unit.unitKind,
        unit_number: unit.unitNumber,
        sort_index: unit.sortIndex,
        entry_count: unit.entryCount,
      })),
      { onConflict: "dataset_id,normalized_label" },
    )
    .select("id, normalized_label");

  if (unitError || unitData?.length !== normalized.units.length) {
    throw new Error(
      `단원 가져오기 실패: ${unitError?.message ?? "단원 수 불일치"}`,
    );
  }

  const unitIdByLabel = new Map(
    unitData.map((unit) => [unit.normalized_label, unit.id]),
  );
  const batchSize = 400;
  for (
    let offset = 0;
    offset < normalized.entries.length;
    offset += batchSize
  ) {
    const rows = normalized.entries
      .slice(offset, offset + batchSize)
      .map((entry) => {
        const unitId = unitIdByLabel.get(entry.unitNormalizedLabel);
        if (!unitId) {
          throw new Error(`단원 연결 실패: ${entry.unitLabel}`);
        }

        return {
          dataset_id: datasetId,
          unit_id: unitId,
          position_in_unit: entry.positionInUnit,
          entry_type: entry.entryType,
          source_row: entry.sourceRow,
          headword: entry.headword,
          headword_normalized: entry.headwordNormalized,
          meanings: entry.meanings,
          primary_meaning: entry.primaryMeaning,
          source_ref: entry.sourceRef,
          row_sha256: entry.rowSha256,
        };
      });
    const { error } = await supabase.from("vocab_entries").upsert(rows, {
      onConflict: "dataset_id,source_row",
    });
    if (error) {
      throw new Error(
        `${offset + 1}행부터 가져오기 실패: ${error.message}`,
      );
    }
  }

  const { count, error: countError } = await supabase
    .from("vocab_entries")
    .select("id", { count: "exact", head: true })
    .eq("dataset_id", datasetId);
  if (countError || count !== normalized.audit.rowCount) {
    throw new Error(
      `가져온 행 수 불일치: 예상 ${normalized.audit.rowCount}, 실제 ${count ?? "확인 불가"}`,
    );
  }

  if (options.markReady) {
    const { error } = await supabase
      .from("vocab_datasets")
      .update({
        status: "ready",
        is_active: true,
        row_count: normalized.audit.rowCount,
        imported_at: new Date().toISOString(),
      })
      .eq("id", datasetId)
      .eq("source_sha256", normalized.file.dataset.sourceSha256);
    if (error) {
      throw new Error(`검수 완료 상태 변경 실패: ${error.message}`);
    }
  }

  console.log(JSON.stringify({ ...summary, datasetId }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
