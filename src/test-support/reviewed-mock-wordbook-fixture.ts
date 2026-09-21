import { computeReviewedMockInputHash, sealReviewedMockBundle, type ReviewedMockBundle, type ReviewedMockResource } from "@/lib/vocab/reviewed-mock-import-contract";
import type { ExamUseEntry } from "@/lib/vocab/exam-use-import-contract";

const sha = "a".repeat(64);
export const mockEvidence = { source: "wordbook" as const, path: "fake-source.md", locator: "fixture row", sha256: sha };
const missing = { status: "missing" as const, value: null, evidence: [mockEvidence], reason: "가짜 원천에 해당 필드가 없음" };
const linked = <T>(value: T) => ({ status: "linked" as const, value, evidence: [mockEvidence], reason: "가짜 원천과 선택값을 확인" });

export function resealMockReview(bundle: ReviewedMockBundle) {
  for (const entry of bundle.package.entries) {
    const resource = bundle.resources.find(row => row.source_row === entry.source_row)!;
    const hash = computeReviewedMockInputHash(entry as unknown as Record<string, unknown>, resource as unknown as Record<string, unknown>);
    entry.exam_input_hash = hash;
    resource.exam_input_hash = hash;
    for (const record of resource.review_records) record.input_hash = hash;
  }
  return sealReviewedMockBundle(bundle);
}

export function buildReviewedMockFixture(version = 1): ReviewedMockBundle {
  const entries: ExamUseEntry[] = [];
  const resources: ReviewedMockResource[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const entry: ExamUseEntry = {
      source_row: i, sequence_no: i, unit: i <= 3 ? "2026년 3월 목적 [18]" : "2026년 3월 심경 [19]", day: null,
      position_in_unit: (i - 1) % 3 + 1, dictionary_id: `word:fixture-${i}`, legacy_ids: [], sense_id: null,
      pronunciation_variant_id: null, display_headword: `fixture${i}`, display_gloss_ko: `가짜 뜻 ${i}`,
      display_pronunciation_ko: null, display_pronunciation_review_status: "candidate",
      audio: { status: "disabled", audio_url: null, sound_audio: null, raw_response_sha256: null, raw_source: null,
        raw_relative_path: null, reason: "가짜 원천에 발음 없음", selection_status: "disabled", source_locator: null,
        variant_id: null, variant_pos: null, mw_notation: null },
      occurrence_id: `occ:mock-fixture-${i}`, occurrence_content_hash: sha, content_hash: sha,
      exam_review_id: `exam-review:mock-fixture-${i}`, exam_input_hash: sha,
      exam_use_status: "reviewed_for_preview", context_evidence_status: "source_entry_context",
      context_evidence: { source: "source_entries", source_entry_id: `source-${i}`, source_entry_sha256: sha },
      entry_row_sha256: i.toString(16).toUpperCase().padStart(64, 'A'), source_entry_id: `source-${i}`, source_entry_sha256: sha,
      include_in_exam: true, manual_review_flags: [],
    };
    const resource: ReviewedMockResource = {
      source_row: i, original_headword: entry.display_headword, original_gloss: entry.display_gloss_ko, original_pos: null,
      source_marker: "", source_occurrence_id: `source-${i}`, source_evidence: mockEvidence, inclusion_reason: "가짜 원고의 뜻 시험 포함",
      dictionary: linked({ dictionary_id: entry.dictionary_id, legacy_id: null, sense_id: null, canonical_approved: false as const }),
      pos: linked("noun"), pronunciation: { ...missing }, definition: i === 1 ? linked("A fabricated fixture definition.") : { ...missing },
      example: i === 1 ? linked({ english: "This is fixture one.", korean: "가짜 예문 하나." }) : { ...missing },
      exam_input_hash: sha,
      review_records: ["alpha", "beta"].map(name => ({ stage: "exam_scope" as const, reviewer: `fixture-${name}`,
        reviewer_version: "fixture-v1", review_run_id: `fixture-${name}-run-1`, reviewed_at: "2026-09-01T00:00:00Z",
        decision: "pass" as const, input_hash: sha, evidence: [mockEvidence] })),
    };
    entries.push(entry); resources.push(resource);
  }
  const bundle: ReviewedMockBundle = {
    schema_version: "reviewed_mock_wordbook_v1", approval_id: `mock-fixture-${version}`, content_sha256: sha,
    package: { schema_version: "1.0", package_type: "student-app-exam-use-wordbook", target_environment: "preview",
      common_dictionary_release_allowed: false, exam_use_import_allowed: true, package_version: sha,
      dataset_key: `g12-mock-2026-03-v${version}`, source_sha256: sha, candidate_dictionary_version: sha,
      manifest_content_hash: sha, exam_review_ledger_sha256: sha, wordbook_id: "fake-mock-wordbook", title: "가짜 모의고사 자료",
      generated_at_utc: "2026-09-01T00:00:00Z", entries },
    inputs: [mockEvidence],
    scopes: [18, 19].map((number, index) => ({ unit_label: entries[index * 3]!.unit, display_name: entries[index * 3]!.unit,
      review_evidence_sha256: sha, metadata: { executionYear: 2026 as const, examMonth: 3, examKind: "mock" as const,
        academicYear: null, agency: "가짜 출제기관", typeCode: number === 18 ? "purpose" : "emotion", typeLabel: number === 18 ? "목적" : "심경",
        questionNumbers: [number], sharedPassage: false } })), resources,
  };
  return resealMockReview(bundle);
}

export function buildReviewedCsatFixture(year: 2023 | 2024 | 2025 = 2025, version = 1): ReviewedMockBundle {
  const bundle = buildReviewedMockFixture(version);
  const seedEntry = bundle.package.entries[0]!;
  const seedResource = bundle.resources[0]!;
  const seedScope = bundle.scopes[0]!;
  bundle.approval_id = `csat-fixture-${year}-${version}`;
  bundle.package.dataset_key = `g12-csat-${year}-v${version}`;
  bundle.package.wordbook_id = `fake-csat-${year}`;
  bundle.package.title = `가짜 ${year + 1}학년도 수능`;
  bundle.package.entries = [];
  bundle.resources = [];
  const questions = [...Array.from({ length: 23 }, (_, i) => [i + 18]), [41, 42], [43, 44, 45]];
  bundle.scopes = questions.map((numbers, index) => {
    const unit = `${year + 1}학년도 수능 [${numbers.join(",")}]`;
    for (let position = 1; position <= 4; position += 1) {
      const n = index * 4 + position;
      const sourceId = `csat-${year}-${version}-${n}`;
      const entry = structuredClone(seedEntry);
      Object.assign(entry, { source_row: n, sequence_no: n, position_in_unit: position, unit,
        dictionary_id: `word:fixture-${n}`, display_headword: `fixture${n}`, display_gloss_ko: `가짜 뜻 ${n}`,
        occurrence_id: `occ:${sourceId}`, exam_review_id: `exam-review:${sourceId}`, source_entry_id: sourceId,
        entry_row_sha256: n.toString(16).toUpperCase().padStart(64, "B"),
        context_evidence: { source: "source_entries", source_entry_id: sourceId, source_entry_sha256: sha } });
      entry.context_evidence.choice_safety = {
        version: "reviewed-choice-conflicts-v1", evidenceSha256: sha,
        target: { headword: entry.display_headword, primaryMeaning: entry.display_gloss_ko }, exclusions: [],
      };
      const resource = structuredClone(seedResource);
      Object.assign(resource, { source_row: n, original_headword: entry.display_headword,
        original_gloss: entry.display_gloss_ko, source_occurrence_id: sourceId,
        dictionary: linked({ dictionary_id: entry.dictionary_id, legacy_id: null, sense_id: null, canonical_approved: false as const }) });
      if (n !== 1) { resource.definition = { ...missing }; resource.example = { ...missing }; }
      bundle.package.entries.push(entry);
      bundle.resources.push(resource);
    }
    return { ...seedScope, unit_label: unit, display_name: unit,
      metadata: { ...seedScope.metadata, executionYear: year, examMonth: 11 as const, academicYear: year + 1,
        examKind: "csat" as const, questionNumbers: numbers, sharedPassage: numbers[0]! >= 41 } };
  });
  return resealMockReview(bundle);
}
