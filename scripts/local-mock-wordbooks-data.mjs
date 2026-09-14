// Fake materials for the isolated localhost browser runner. Never used by the app.
const uid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const MOCK_DATASET_ID = uid(12);
export const MOCK_SCOPE_IDS = Array.from({ length: 9 }, (_, i) => uid(600 + i));
export const MOCK_UNIT_IDS = Array.from({ length: 9 }, (_, i) => uid(700 + i));
export const mockScopes = [2024, 2025, 2026].flatMap((year, y) => [
  { month: 3, numbers: [31], label: "빈칸 추론", code: "blank" },
  { month: 6, numbers: [41, 42], label: "장문독해", code: "long_reading" },
  { month: 6, numbers: [43, 44, 45], label: "장문독해", code: "long_reading" },
].map((type, t) => ({
  id: MOCK_SCOPE_IDS[y * 3 + t], version: String(y * 3 + t + 1).repeat(64),
  displayName: `${year}년 ${type.month}월 ${type.label} [${type.numbers.join("·")}번]`,
  sourceTitle: `화면 검사 전용 가짜 ${year}년 고3 모의고사`, sourceEntryCount: 4, includedEntryCount: 4,
  metadata: { executionYear: year, examMonth: type.month, examKind: "mock", academicYear: null,
    agency: "가짜 출처", typeCode: type.code, typeLabel: type.label, questionNumbers: type.numbers, sharedPassage: t > 0 },
})));
let composition = null;
const requests = new Map();
export function mockWordbookFixture({ target, method, input, headers }) {
  const table = target.pathname.replace("/rest/v1/", "");
  const ok = body => ({ status: 200, body, category: "mock-wordbooks-memory-only" });
  const deny = () => ({ status: 400, body: { code: "22023", message: "invalid_composition_request" }, category: "mock-wordbooks-rejected" });
  if (method === "POST" && table === "rpc/list_mock_wordbook_scopes_v1") return ok({ scopes: mockScopes });
  if (method === "POST" && table === "rpc/create_mock_wordbook_composition_v1") {
    const request = input.p_request;
    if (!request || !/^[0-9a-f-]{36}$/.test(request.requestId ?? "") || typeof request.title !== "string" || !request.title.trim() || request.title.length > 100 ||
      !Array.isArray(request.scopes) || !request.scopes.length || new Set(request.scopes.map(s => s.id)).size !== request.scopes.length ||
      request.scopes.some(s => !mockScopes.some(source => source.id === s.id && source.version === s.version))) return deny();
    const prior = requests.get(request.requestId);
    if (prior) return JSON.stringify(prior.request) === JSON.stringify(request) ? ok(prior.result) : deny();
    if (composition) return deny();
    composition = { title: request.title, scopes: request.scopes.map(s => mockScopes.find(source => source.id === s.id)) };
    const result = { datasetId: MOCK_DATASET_ID, title: request.title, scopeCount: request.scopes.length, sourceEntryCount: request.scopes.length * 4, includedEntryCount: request.scopes.length * 4 };
    requests.set(request.requestId, { request, result });
    return ok(result);
  }
  if (!composition) return null;
  const units = composition.scopes.map((s, i) => ({ id: MOCK_UNIT_IDS[i], dataset_id: MOCK_DATASET_ID,
    unit_label: s.displayName, unit_kind: "day", unit_number: i + 1, sort_index: i + 1, entry_count: 4 }));
  const entries = units.flatMap((u, i) => [1, 2, 3, 4].map(n => ({ id: 1200 + i * 4 + n, unit_id: u.id, source_row: i * 4 + n,
    headword: `sample${n}`, headword_normalized: `sample${n}`, primary_meaning: `가짜 뜻 ${n}` })));
  const page = rows => rows.slice(Number(target.searchParams.get("offset") ?? 0), Number(target.searchParams.get("offset") ?? 0) + Number(target.searchParams.get("limit") ?? rows.length));
  if (method === "POST" && table === "rpc/list_active_exam_use_eligibility_v2" && input.p_dataset_id === MOCK_DATASET_ID) {
    return ok(page(entries.flatMap(e => ["book_meaning_en_to_ko", "book_meaning_ko_to_en"].map(quiz_mode => ({
      vocab_entry_id: e.id, quiz_mode, canonical_lexeme_id: null, canonical_dictionary_id: null, composition_identity_key: String((e.id - 1201) % 4 + 1).repeat(64),
    })))));
  }
  const id = target.searchParams.get("id"), datasetId = target.searchParams.get("dataset_id");
  if (method === "HEAD" && table === "vocab_entries" && datasetId === `eq.${MOCK_DATASET_ID}` && target.searchParams.get("select") === "id") {
    const filter = target.searchParams.get("unit_id");
    if (!filter || !/^in\.\([0-9a-f,-]+\)$/.test(filter)) return deny();
    const selected = new Set(filter.slice(4, -1).split(","));
    if ([...selected].some(unit => !units.some(u => u.id === unit))) return deny();
    return { ...ok([]), count: entries.filter(e => selected.has(e.unit_id)).length };
  }
  if (method !== "GET") return null;
  const single = rows => headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
  if (table === "vocab_datasets" && id === `eq.${MOCK_DATASET_ID}`) return ok(single([{ id: MOCK_DATASET_ID, dataset_key: "local-mock-wordbook", title: composition.title, edition: null,
    row_count: entries.length, status: "ready", is_active: true, metadata: { projectionProfile: "exam_scope_candidate_v1" } }]));
  if (table === "vocab_dataset_catalog" && datasetId === `eq.${MOCK_DATASET_ID}`) return ok(single([{ dataset_id: MOCK_DATASET_ID, display_name: composition.title,
    catalog_group: "high_mock", material_kind: "wordbook", grade_code: "g12", publisher: null, series_title: null, academic_year: null, curriculum_revision: null, edition_label: null,
    is_assignable: true, sort_index: 100, metadata: {} }]));
  if (datasetId === `eq.${MOCK_DATASET_ID}` && table === "vocab_units") return ok(units);
  if (datasetId === `eq.${MOCK_DATASET_ID}` && table === "vocab_entries") return ok(page(entries));
  if (table === "vocab_unit_catalog" && target.searchParams.get("unit_id")?.includes(MOCK_UNIT_IDS[0])) return ok(units.map((u, i) => ({
    unit_id: u.id, catalog_group: "high_mock", unit_type: "exam_scope", display_name: u.unit_label, academic_year: null,
    exam_month: composition.scopes[i].metadata.examMonth, agency: "가짜 출처", item_range: composition.scopes[i].metadata.questionNumbers.join("·"),
    sort_index: u.sort_index, metadata: { mockScope: composition.scopes[i].metadata },
  })));
  if (["assignment_review_targets", "assignment_students", "quiz_attempts", "assignment_questions", "assignments", "student_vocab_wrong_items", "student_vocab_wrong_events"].includes(table)) return ok([]);
  return null;
}
