import { describe, expect, it } from "vitest";

import {
  computeExamWebsterRepairEntryHash,
  computeExamWebsterRepairPackageVersion,
  validateExamWebsterPronunciationRepairPackage,
} from "@/lib/vocab/exam-webster-pronunciation-repair-contract";

function fixture() {
  const entries = Array.from({ length: 29 }, (_, index) => {
    const soil = index >= 27;
    const dictionaryId = soil ? "word:soil" : `word:item-${index}`;
    const sound = soil ? "soil0001" : `sound${index}`;
    const variantId = soil ? "mw:soil" : `mw:item-${index}`;
    const audioUrl = `https://media.merriam-webster.com/audio/prons/en/us/mp3/${sound[0]}/${sound}.mp3`;
    const entry: Record<string, unknown> = {
      occurrence_id: `occ:item-${index}`,
      dictionary_id: dictionaryId,
      source_row: index + 1,
      entry_row_sha256: "A".repeat(64),
      headword_normalized: soil ? "soil" : `item-${index}`,
      selected_variant_id: variantId,
      selected_audio_url: audioUrl,
      selected_sound_audio: sound,
      selected_pos: "noun",
      selected_mw_notation: "notation",
      variants: [
        {
          variant_id: variantId,
          locale: "en-US",
          pos: "noun",
          mw_notation: "notation",
          sound_audio: sound,
          source_locator: "fixture",
          audio_url: audioUrl,
        },
      ],
      raw_provenance: [
        {
          raw_response_sha256: "b".repeat(64),
          raw_relative_path: "fixture.json",
          raw_source: "fixture",
          decision: "cross_pos_same_pronunciation_webster_reuse",
          pronunciation_comparison: "webster_and_cmudict_same_pronunciation",
        },
      ],
    };
    entry.content_sha256 = computeExamWebsterRepairEntryHash(entry);
    return entry;
  });
  const value: Record<string, unknown> = {
    schema_version: "exam-webster-same-pronunciation-repair-v1",
    generated_at_utc: "2026-08-14T00:00:00Z",
    dataset_key: "g12-long-reading-2025-exam-scope-v1",
    source_exam_package_version: "1".repeat(64),
    source_exam_package_sha256: "2".repeat(64),
    source_decisions_sha256: "3".repeat(64),
    source_hydrated_sha256: "4".repeat(64),
    provider: "merriam_webster",
    decision_policy:
      "cross_pos_reuse_only_when_standard_american_pronunciation_matches_v1",
    status: "complete",
    app_release_allowed: true,
    expected_dictionary_count: 28,
    expected_occurrence_count: 29,
    entries,
    summary: {
      dictionary_count: 28,
      occurrence_count: 29,
      soil_occurrence_count: 2,
    },
  };
  value.package_version = computeExamWebsterRepairPackageVersion(value);
  return value;
}

describe("exam Webster pronunciation repair contract", () => {
  it("28개 표제어·29회 출현과 soil 2회를 허용한다", () => {
    expect(validateExamWebsterPronunciationRepairPackage(fixture()).summary).toMatchObject({
      dictionaryCount: 28,
      occurrenceCount: 29,
      soilOccurrenceCount: 2,
    });
  });

  it("선택 변형이나 행 해시를 바꾸면 거부한다", () => {
    const wrongVariant = fixture();
    const entries = wrongVariant.entries as Array<Record<string, unknown>>;
    entries[0].selected_variant_id = "mw:wrong";
    expect(() => validateExamWebsterPronunciationRepairPackage(wrongVariant)).toThrow();

    const wrongHash = fixture();
    const hashEntries = wrongHash.entries as Array<Record<string, unknown>>;
    hashEntries[1].entry_row_sha256 = "B".repeat(64);
    expect(() => validateExamWebsterPronunciationRepairPackage(wrongHash)).toThrow();

    const wrongPos = fixture();
    const posEntries = wrongPos.entries as Array<Record<string, unknown>>;
    posEntries[0].selected_pos = "verb";
    posEntries[0].content_sha256 = computeExamWebsterRepairEntryHash(
      posEntries[0],
    );
    wrongPos.package_version = computeExamWebsterRepairPackageVersion(wrongPos);
    expect(() =>
      validateExamWebsterPronunciationRepairPackage(wrongPos),
    ).toThrow();
  });
});
