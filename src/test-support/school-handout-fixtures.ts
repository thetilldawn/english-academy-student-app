import { reviewedExamFixture, reviewedFixtureModes, reviewedHash, sha256Text } from "./reviewed-exam-fixtures";

export type SchoolFixture = ReturnType<typeof schoolHandoutFixture>;
/** Fake school rows only. No teaching material or student data. */
export function schoolHandoutFixture() {
  const old = reviewedExamFixture();
  const rows = Array.from({ length: 73 }, (_, i) => ({
    source_row: i + 1, w: i < 4 ? old.voice.identities[i]!.headword : `fakeword${i + 1}`,
    p: i === 4 ? null : "명", k: `가짜 뜻 ${i + 1}`, d: `a fake school definition ${i + 1}`,
    src: "fake-l2", source_jsonl_line: i + 280, source_locator: { jsonl_line: i + 280 },
  }));
  const source = { scope: { school: "검사고", grade: "고2", school_year: 2026, semester: 2, purpose: "직전대비", source_kind: "school_handout" },
    inputs: [{ path: "fake-handout", sha256: "d".repeat(64) }], entries: rows };
  const entries = rows.map((s, index) => {
    const identity = old.voice.identities[index];
    const binding = old.voice.bindings[index]!;
    const donor = index < 4 && identity ? {
      dataset_key: old.voice.dataset_key, source_row: index + 1, entry_row_sha256: binding.entry_row_sha256.toLowerCase(),
      identity_id: identity.identity_id, identity_content_sha256: identity.identity_content_sha256.toLowerCase(),
      identity_headword: identity.headword, identity_lexical_pos: identity.lexical_pos,
      variant_id: identity.pronunciation_variant_id, audio_key: identity.official_audio_url,
      display_override: null,
    } : null;
    const e = { source_row: s.source_row, headword: s.w, source_pos: s.p, source_meaning: s.k,
      korean_meaning: s.k, school_english_definition: s.d, english_definition: s.d,
      source_code: s.src, jsonl_line: s.source_jsonl_line, lexical_pos: "noun",
      lexical_classification_note: s.p === null ? "가짜 미기재 품사의 내부 분류" : null,
      unit_key: "fake-l2", position_in_unit: index + 1, definition_provenance: { kind: "school_handout", provided_definition_found: true },
      pronunciation_donor: donor, pronunciation_ko: donor ? identity!.display_pronunciation_ko : null };
    return { ...e, entry_row_sha256: reviewedHash(e) };
  });
  const questions = entries.flatMap((e, index) => reviewedFixtureModes.map(([mode, direction, prompt_role, choice_role], mi) => {
    const choice_source_rows = [0, 1, 2, 3].map(offset => (index + offset) % 73 + 1);
    const q = { item_id: `school-fake-${e.source_row}-${mi}`, source_row: e.source_row, entry_row_sha256: e.entry_row_sha256,
      mode, direction, prompt_role, choice_role, prompt: e[prompt_role], choice_source_rows,
      choice_texts: choice_source_rows.map(row => entries[row - 1]![choice_role]), correct_choice_index: 0 };
    return { ...q, item_sha256: reviewedHash(q) };
  }));
  const bundle = { format: "school-handout-reviewed-bundle-v1", schema_version: 1,
    dataset: { key: "fake-school-l2-v1", title: "검사고 학교 어휘", catalog_template_key: old.voice.dataset_key,
      source_label: "가짜 학교 원문", review_work: "WORD-20260913-01", hide_dataset_keys: [old.voice.dataset_key] },
    scope: source.scope, source_file_sha256: sha256Text(JSON.stringify(source)), inputs: source.inputs,
    units: [{ key: "fake-l2", label: "가짜 2과", unit_type: "lesson", entry_count: 73, sort_index: 1, academic_year: null, exam_month: null, item_range: null }],
    entries, questions, content_sha256: "", permissions: { canonical_approved: false, release_allowed: true },
    reviews: [] as Array<{ reviewer: string; status: string; input_content_sha256: string; report_sha256: string }> };
  return sealSchoolFixture({ old, source, bundle });
}
export function sealSchoolFixture<T extends { source: unknown; bundle: {
  dataset: unknown; scope: unknown; inputs: unknown; units: unknown; entries: unknown; questions: unknown;
  source_file_sha256: string; content_sha256: string;
  reviews: Array<{ reviewer: string; status: string; input_content_sha256: string; report_sha256: string }>;
} }>(fixture: T) {
  const b = fixture.bundle;
  b.source_file_sha256 = sha256Text(JSON.stringify(fixture.source));
  b.content_sha256 = reviewedHash({ dataset: b.dataset, scope: b.scope, inputs: b.inputs, units: b.units,
    entries: b.entries, questions: b.questions, source_file_sha256: b.source_file_sha256 });
  b.reviews = ["fake-review-one", "fake-review-two"].map(reviewer => ({ reviewer, status: "passed",
    input_content_sha256: b.content_sha256, report_sha256: reviewedHash(reviewer) }));
  return fixture;
}

