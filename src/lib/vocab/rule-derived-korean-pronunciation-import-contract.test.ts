import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateRuleDerivedKoreanPronunciationPackage } from "@/lib/vocab/rule-derived-korean-pronunciation-import-contract";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function fixture() {
  const itemWithoutHash = {
    dictionary_id: "word:meanwhile",
    headword: "meanwhile",
    pronunciation_identity_type: "webster_selected" as const,
    pronunciation_variant_id: "mw:288fb5a854433c5f7580",
    display_pronunciation_ko: "민와일",
    segments: [
      { text: "민", stress: "primary" as const },
      { text: "와일", stress: "secondary" as const },
    ],
    derivation_status: "rule_derived" as const,
    engine_version: "cmudict-hangul-nucleus-align-v3" as const,
    confidence: "high" as const,
    confidence_scope: "hangul_alignment_only" as const,
    stress_evidence: "selected_webster_lexical_stress" as const,
    alignment_cost: 0.1,
    alignment_margin: 0.2,
    webster_mw_notation: "ˈmēn-ˌ(h)wī(-ə)l",
    webster_cmu_primary_match: true,
    selected_webster_stress_applied: true,
    cmudict_sources: ["cmudict:meanwhile"],
    cmudict_stress_shape: {
      syllable_count: 2,
      primary_index: 0,
      secondary_indexes: [1],
    },
    raw_cmudict_stress_shape: {
      syllable_count: 2,
      primary_index: 0,
      secondary_indexes: [1],
    },
    source_audio_sha256: "1".repeat(64),
    occurrence_ids: ["occ:meanwhile-test"],
  };
  const item = { ...itemWithoutHash, content_sha256: hash(itemWithoutHash) };
  const packageWithoutGeneratedTimeAndHash = {
    schema_version: "rule-derived-korean-pronunciation-batch-v1" as const,
    package_id: "rule-derived-test-v3",
    dataset_key: "g12-long-reading-2025-exam-scope-v1",
    source_exam_package_version: "2".repeat(64),
    status: "complete" as const,
    derivation_method:
      "cmudict_arpabet_to_hangul_nucleus_alignment" as const,
    engine_version: "cmudict-hangul-nucleus-align-v3" as const,
    confidence_scope: "hangul_alignment_only" as const,
    display_semantics: "lexical_stress_not_tts_acoustic_prosody" as const,
    target_environment: "staging" as const,
    source_exam_package_sha256: "3".repeat(64),
    source_cmudict_sha256: "4".repeat(64),
    source_cmudict_commit: "5".repeat(40),
    source_corrections_sha256: "6".repeat(64),
    source_expression_manifest_sha256: "7".repeat(64),
    source_word_manifest_sha256: "8".repeat(64),
    source_webster_repair_sha256: "9".repeat(64),
    expected_occurrence_count: 1,
    covered_occurrence_count: 1,
    held_occurrence_count: 0,
    identity_count: 1,
    confidence_occurrence_counts: { high: 1, medium: 0, low: 0 },
    stress_evidence_occurrence_counts: {
      selected_webster_lexical_stress: 1,
      cmudict_lexical_stress_phrase_rule: 0,
      cmudict_lexical_stress: 0,
    },
    items: [item],
  };
  return {
    ...packageWithoutGeneratedTimeAndHash,
    generated_at_utc: "2026-08-14T00:00:00Z",
    package_version: hash(packageWithoutGeneratedTimeAndHash),
  };
}

function fullCoverageFixture() {
  const packageValue = structuredClone(fixture()) as Record<string, unknown>;
  const sampleItem = structuredClone(
    (packageValue.items as Array<Record<string, unknown>>)[0],
  );
  delete sampleItem.content_sha256;
  const items = Array.from({ length: 582 }, (_, index) => {
    const occurrenceIds = [`occ:coverage-${index}`];
    if (index < 19) occurrenceIds.push(`occ:coverage-${index}-second`);
    const itemWithoutHash = {
      ...sampleItem,
      dictionary_id: `word:coverage${index}`,
      headword: `coverage${index}`,
      pronunciation_variant_id: `mw:${index.toString(16).padStart(20, "0")}`,
      cmudict_sources: [`cmudict:coverage${index}`],
      occurrence_ids: occurrenceIds,
    };
    return {
      ...itemWithoutHash,
      content_sha256: hash(itemWithoutHash),
    };
  });
  Object.assign(packageValue, {
    expected_occurrence_count: 601,
    covered_occurrence_count: 601,
    identity_count: 582,
    confidence_occurrence_counts: { high: 601, medium: 0, low: 0 },
    stress_evidence_occurrence_counts: {
      selected_webster_lexical_stress: 601,
      cmudict_lexical_stress_phrase_rule: 0,
      cmudict_lexical_stress: 0,
    },
    items,
  });
  delete packageValue.generated_at_utc;
  delete packageValue.package_version;
  return {
    ...packageValue,
    generated_at_utc: "2026-08-14T00:00:00Z",
    package_version: hash(packageValue),
  };
}

describe("rule-derived Korean pronunciation import contract", () => {
  it("최종 음원 ID, 한 개의 주강세, 출현 수와 해시가 맞는 묶음만 받는다", () => {
    expect(validateRuleDerivedKoreanPronunciationPackage(fixture()).summary).toMatchObject({
      identityCount: 1,
      occurrenceCount: 1,
      llmTokens: 0,
    });
  });

  it("내부 TTS 요청 ID와 변조된 구간은 거부한다", () => {
    const wrongVariant = structuredClone(fixture());
    wrongVariant.items[0].pronunciation_variant_id = "ttsword:meanwhile";
    expect(() =>
      validateRuleDerivedKoreanPronunciationPackage(wrongVariant),
    ).toThrow();

    const changed = structuredClone(fixture());
    changed.items[0].segments = [{ text: "민와일", stress: "primary" }];
    expect(() => validateRuleDerivedKoreanPronunciationPackage(changed)).toThrow(
      "규칙 생성 발음 내용 해시가 다릅니다",
    );
  });

  it("실제 목표 규모인 고유 582개와 출현 601개를 중복 없이 검증한다", () => {
    expect(
      validateRuleDerivedKoreanPronunciationPackage(fullCoverageFixture())
        .summary,
    ).toMatchObject({
      identityCount: 582,
      occurrenceCount: 601,
      confidenceOccurrenceCounts: { high: 601, medium: 0, low: 0 },
    });
  });
});
