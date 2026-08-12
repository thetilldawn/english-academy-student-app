import { describe, expect, it } from "vitest";

import {
  assertExamUseImportEnvironment,
  assertPreviewImportEnvironment,
  computeExamUseEntryContentHash,
  computeExamUsePackageVersion,
  validateExamUsePackage,
} from "@/lib/vocab/exam-use-import-contract";

function buildEntry(sourceRow: number) {
  const suffix = String(sourceRow).padStart(12, "0");
  const entry: Record<string, unknown> = {
    source_row: sourceRow,
    sequence_no: sourceRow,
    unit: "2025-01 장문독해",
    day: null,
    position_in_unit: sourceRow,
    dictionary_id: `word:sample-${sourceRow}`,
    legacy_ids: [
      {
        system: "legacy-word-index",
        id: `00000000-0000-4000-8000-${suffix}`,
      },
    ],
    sense_id: null,
    pronunciation_variant_id:
      sourceRow === 1 ? "mw:sample-1" : null,
    display_headword: `sample${sourceRow}`,
    display_gloss_ko: `표본 ${sourceRow}`,
    display_pronunciation_ko: `샘플 ${sourceRow}`,
    display_pronunciation_review_status: "candidate",
    audio:
      sourceRow === 1
        ? {
            status: "raw_attached",
            audio_url:
              "https://media.merriam-webster.com/audio/prons/en/us/mp3/s/sample01.mp3",
            sound_audio: "sample01",
            raw_response_sha256: "a".repeat(64),
            raw_source: "api_raw",
            raw_relative_path: "pron-sample1.json",
            reason: null,
            selection_status: "single_exact_raw_variant",
            source_locator: "meta.id=sample hwi.prs[0]",
            variant_id: "mw:sample-1",
            variant_pos: "noun",
            mw_notation: "sam-pel",
          }
        : {
            status: "disabled",
            audio_url: null,
            sound_audio: null,
            raw_response_sha256: null,
            raw_source: null,
            raw_relative_path: null,
            reason: "official_audio_unavailable",
            selection_status: "none",
            source_locator: null,
            variant_id: null,
            variant_pos: null,
            mw_notation: null,
          },
    occurrence_id: `occ:sample-${sourceRow}`,
    occurrence_content_hash: "b".repeat(64),
    content_hash: "0".repeat(64),
    exam_review_id: `exam-review:sample-${sourceRow}`,
    exam_input_hash: "c".repeat(64),
    exam_use_status: "reviewed_for_preview",
    context_evidence_status: "source_entry_context",
    context_evidence: {
      source: "source_entries",
      source_entry_id: `entry-sample-${sourceRow}`,
      source_entry_sha256: "d".repeat(64),
    },
    entry_row_sha256: "E".repeat(64),
    source_entry_id: `entry-sample-${sourceRow}`,
    source_entry_sha256: "d".repeat(64),
    include_in_exam: true,
    manual_review_flags: [],
  };
  entry.content_hash = computeExamUseEntryContentHash(entry);
  return entry;
}

function buildPackage() {
  const input: Record<string, unknown> = {
    schema_version: "1.0",
    package_type: "student-app-exam-use-wordbook",
    target_environment: "preview",
    common_dictionary_release_allowed: false,
    exam_use_import_allowed: true,
    package_version: "0".repeat(64),
    dataset_key: "synthetic-exam-use-v1",
    source_sha256: "1".repeat(64),
    candidate_dictionary_version: "2".repeat(64),
    manifest_content_hash: "3".repeat(64),
    exam_review_ledger_sha256: "4".repeat(64),
    wordbook_id: "synthetic-wordbook",
    title: "통합 테스트용 가짜 단어장",
    generated_at_utc: "2026-08-07T00:00:00Z",
    entries: [1, 2, 3, 4].map(buildEntry),
  };
  input.package_version = computeExamUsePackageVersion(input);
  return input;
}

describe("exam-use package import contract", () => {
  it("작은 가짜 패키지의 정본 해시와 출제·음원 경계를 검증한다", () => {
    const input = buildPackage();
    const result = validateExamUsePackage(input);

    expect(computeExamUsePackageVersion(input)).toBe(
      input.package_version,
    );
    expect(result.summary).toMatchObject({
      occurrenceCount: 4,
      dictionaryCount: 4,
      includedCount: 4,
      reviewRequiredCount: 0,
      excludedCount: 0,
      officialAudioCount: 1,
      disabledAudioCount: 3,
    });
  });

  it("패키지 한 글자 변경도 해시 불일치로 차단한다", () => {
    const input = buildPackage();
    const entries = input.entries as Array<Record<string, unknown>>;
    entries[0] = { ...entries[0], display_gloss_ko: "변조" };

    expect(() => validateExamUsePackage(input)).toThrow(
      "패키지 해시가 일치하지 않습니다",
    );
  });

  it("비공식 음원과 임시 식별자·UUID 유출을 차단한다", () => {
    const unofficial = buildPackage();
    const unofficialEntry = (
      unofficial.entries as Array<Record<string, unknown>>
    )[0];
    unofficialEntry.audio = {
      ...(unofficialEntry.audio as Record<string, unknown>),
      audio_url: "https://example.com/fake.mp3",
    };
    unofficialEntry.content_hash =
      computeExamUseEntryContentHash(unofficialEntry);
    unofficial.package_version = computeExamUsePackageVersion(unofficial);
    expect(() => validateExamUsePackage(unofficial)).toThrow(
      "공식 발음 음원 계약",
    );

    const provisional = buildPackage();
    provisional.wordbook_id = "exam-ready|temporary";
    provisional.package_version = computeExamUsePackageVersion(provisional);
    expect(() => validateExamUsePackage(provisional)).toThrow(
      "임시 exam-ready 식별자",
    );

    const leakedUuid = buildPackage();
    leakedUuid.wordbook_id = "00000000-0000-4000-8000-000000009999";
    leakedUuid.package_version = computeExamUsePackageVersion(leakedUuid);
    expect(() => validateExamUsePackage(leakedUuid)).toThrow(
      "legacy_ids 밖에 UUID",
    );
  });

  it("운영 환경과 다른 Preview ref를 모두 차단한다", () => {
    expect(() =>
      assertPreviewImportEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://wojxpruvbjzbhrpmsbuy.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          "wojxpruvbjzbhrpmsbuy",
      }),
    ).toThrow("Production 환경");

    expect(() =>
      assertPreviewImportEnvironment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          "wojxpruvbjzbhrpmsbuy",
      }),
    ).toThrow("프로젝트 ref");
  });

  it("운영 DB에는 승인된 고3 모의고사 자료판 하나만 허용한다", () => {
    const approved = buildPackage();
    approved.dataset_key = "g12-long-reading-2025-exam-scope-v1";
    approved.package_version =
      "fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08";
    expect(
      assertExamUseImportEnvironment(
        {
          NEXT_PUBLIC_SUPABASE_URL:
            "https://xdxhswjgksukjmpbzqgz.supabase.co",
        },
        approved as ReturnType<typeof validateExamUsePackage>["package"],
        "xdxhswjgksukjmpbzqgz",
      ).target,
    ).toBe("production_exact_g12");

    const unapproved = {
      ...approved,
      package_version: "9".repeat(64),
    } as ReturnType<typeof validateExamUsePackage>["package"];
    expect(() =>
      assertExamUseImportEnvironment(
        {
          NEXT_PUBLIC_SUPABASE_URL:
            "https://xdxhswjgksukjmpbzqgz.supabase.co",
        },
        unapproved,
        "xdxhswjgksukjmpbzqgz",
      ),
    ).toThrow("승인된 고3 모의고사 단어장");
  });
});
