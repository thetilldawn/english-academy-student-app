// Synthetic, localhost-only browser fixtures. No app import and no remote writes.
import { createHash } from "node:crypto";
import { uid, DATA_ORIGIN, PUBLIC_KEY, ACCESS_TOKEN } from "./local-admin-baseline-data.mjs";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const filters = { search: "", kinds: [], years: [], yearFrom: null, yearTo: null, months: [], types: [], questions: [], sourceGrades: [], dayFrom: null, dayTo: null, lessons: [], schools: [], targetGrades: [], semesters: [], assessments: [], purposes: [] };
const empty = { displayKo: null, variantId: null, audioUrl: null, available: false };
const resource = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: empty, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
const baseClass = { kind: "mock", sourceGrade: "g12", exam: null, lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null };
const scopes = [2024, 2025, 2026].flatMap((year, y) => ["topic", "long_reading"].map((type, t) => {
  const n = y * 2 + t;
  const exam = { executionYear: year, examMonth: 9, examKind: "mock", academicYear: year + 1, agency: "가짜 출처", typeCode: type, typeLabel: t ? "장문독해" : "주제", questionNumbers: t ? [41, 42] : [23], sharedPassage: Boolean(t) };
  return { id: uid(600 + n), version: hash(n), name: `${year}년 9월 ${exam.typeLabel} [${exam.questionNumbers.join("·")}번]`, sourceTitle: `가짜 ${year}년 모의고사`, availability: "available",
    source: { datasetId: uid(10), unitId: uid(101), kind: "legacy_vocab", releaseId: null, releaseVersion: hash("legacy"), fileHash: hash("source"), locator: `fake/${n}` },
    classification: { ...baseClass, exam }, occurrences: ["apple", "book", "river", "school"].map((headword, i) => ({ key: hash([n, i]), sourceRow: n * 4 + i + 1, sourceEntryId: n * 4 + i + 1, rowHash: hash(["row", n, i]), state: "included", headword, meaning: ["사과", "책", "강", "학교"][i] })) };
}));
scopes.push(...["textbook", "wordbook", "unclassified"].map((kind, i) => ({ ...structuredClone(scopes[0]), id: uid(620 + i), version: hash(kind), name: ["교과서 1과", "기본 단어 DAY 1", "분류 확인 전 자료"][i],
  sourceTitle: "가짜 학교 자료", classification: { ...baseClass, kind, sourceGrade: "g11", lesson: i === 0 ? 1 : null, day: i === 1 ? 1 : null },
  occurrences: scopes[0].occurrences.map((r, j) => ({ ...r, key: hash([kind, j]), state: i === 2 && j === 0 ? "held" : "included" })) })));
let seq = 2000;
const templates = [], requests = new Map(), materialized = new Map();
const metadata = title => ({ title, tags: ["화면 검사"], school: "가짜고", targetGrade: "g11", schoolYear: 2026, semester: 2, assessment: "기말", purpose: "직전 대비" });
function version(recipe, number, sourceVersionId = null) {
  const rows = recipe.scopes.flatMap(s => scopes.find(x => x.id === s.id)?.occurrences ?? []);
  return { id: uid(++seq), number, contentHash: hash(recipe), recipe: structuredClone(recipe), includedKeys: [...new Set(rows.filter(r => r.state === "included" && !recipe.excludedOccurrenceKeys.includes(r.key)).map(r => r.key))], sourceCount: rows.length, sourceVersionId, datasetId: null, createdAt: new Date().toISOString() };
}
templates.push({ id: uid(++seq), revision: 1, metadata: metadata("기말 범위 미확정"), versions: [version({ filters, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" }, 1)] });
templates.push({ id: uid(++seq), revision: 1, metadata: { ...metadata("3개년 주제"), targetGrade: "g12", school: null }, versions: [version({ filters, scopes: scopes.filter(s => s.classification.exam?.typeCode === "topic").map(({ id, version }) => ({ id, version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" }, 1)] });
export const LIBRARY_DATASET_ID = uid(13);
export function vocabularyLibraryFixture({ url, method, headers, body }) {
  const target = new URL(url), table = target.pathname.replace("/rest/v1/", "");
  if (target.origin !== DATA_ORIGIN || headers.get("apikey") !== PUBLIC_KEY || headers.get("authorization") !== `Bearer ${ACCESS_TOKEN}`) return null;
  const ok = body => ({ status: 200, body: structuredClone(body), category: "vocabulary-library-memory-only" });
  const deny = (code = "22023") => ({ status: 400, body: { code, message: "fake_fixture_rejected" }, category: "vocabulary-library-rejected" });
  const input = body ? JSON.parse(body) : {};
  if (method === "POST" && table === "rpc/list_vocabulary_library_v1") return ok({ viewerId: uid(999), scopes, templates });
  if (method === "POST" && table === "rpc/list_vocabulary_unit_source_classifications_v1") return ok([]);
  if (method === "POST" && table === "rpc/save_vocabulary_library_template_v1") {
    const c = input.p_request;
    if (!c || !/^[0-9a-f-]{36}$/.test(c.requestId ?? "")) return deny();
    if (requests.has(c.requestId)) { const old = requests.get(c.requestId); return old.hash === hash(c) ? ok(old.result) : deny("40001"); }
    let t = templates.find(t => t.id === c.templateId);
    if (c.action === "metadata" || c.action === "version") {
      if (!t || t.revision !== c.expectedRevision) return deny("40001");
      if (c.action === "metadata") t.metadata = c.metadata;
      else { if (t.versions[0].contentHash !== c.expectedContentHash) return deny("40001"); t.versions.unshift(version(c.recipe, t.versions[0].number + 1, t.versions[0].id)); }
      t.revision++;
    } else if (c.action === "create") { t = { id: uid(++seq), revision: 1, metadata: c.metadata, versions: [version(c.recipe, 1)] }; templates.push(t); }
    else if (c.action === "copy") { const source = templates.flatMap(t => t.versions).find(v => v.id === c.sourceVersionId); if (!source) return deny(); t = { id: uid(++seq), revision: 1, metadata: c.metadata, versions: [version(source.recipe, 1, source.id)] }; templates.push(t); }
    else return deny();
    const result = { template: structuredClone(t) }; requests.set(c.requestId, { hash: hash(c), result }); return ok(result);
  }
  if (method === "POST" && table === "rpc/prepare_vocabulary_template_book_v1") {
    const c = input.p_request, t = templates.find(t => t.id === c?.templateId), v = t?.versions.find(v => v.id === c?.versionId);
    if (!v || v.contentHash !== c.contentHash || v.recipe.scopeStatus !== "confirmed" || !v.includedKeys.length) return deny();
    v.datasetId = LIBRARY_DATASET_ID; materialized.set(v.id, { t, v });
    return ok({ versionId: v.id, datasetId: LIBRARY_DATASET_ID, contentHash: v.contentHash, state: "ready", entries: [{ id: 1, unitId: uid(710), sourceRow: 1, headword: "apple", primaryMeaning: "사과", sourceKind: "legacy_vocab", sourceEntryId: 1, eligibleDirections: ["english_to_korean"], compositionTargetKey: hash(1), resources: resource }] });
  }
  const active = [...materialized.values()].at(-1);
  if (method === "POST" && table === "rpc/get_vocabulary_composition_summary_v1") {
    const m = materialized.get(input.p_version_id); if (!m) return deny(); const { t, v } = m;
    return ok({ template: t, createdBook: { versionId: v.id, contentHash: v.contentHash, dataset: { id: LIBRARY_DATASET_ID, title: t.metadata.title, displayName: t.metadata.title, edition: null, catalogGroup: "high", materialKind: "wordbook", gradeCode: t.metadata.targetGrade,
      publisher: null, seriesTitle: null, academicYear: t.metadata.schoolYear, curriculumRevision: null, editionLabel: null, isAssignable: v.includedKeys.length >= 4, catalogSortIndex: 100,
      schoolName: t.metadata.school, schoolClassification: t.metadata.school ? "school" : "unclassified", purpose: "exam_prep", semester: t.metadata.semester,
      isActive: true, rowCount: v.includedKeys.length, status: "ready", questionBankKind: "vocabulary_composition_v1", availableQuestionModes: ["book_meaning_choice"] } } });
  }
  if (!active) return null;
  const { t, v } = active, single = rows => headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
  const sourceScopes = v.recipe.scopes.map(s => scopes.find(x => x.id === s.id));
  const units = sourceScopes.map((s, i) => ({ id: uid(710 + i), dataset_id: LIBRARY_DATASET_ID, unit_label: s.name, unit_kind: "day", unit_number: null, sort_index: i + 1, entry_count: s.occurrences.filter(r => v.includedKeys.includes(r.key)).length }));
  if (method === "GET" && table === "vocab_datasets" && target.searchParams.get("id") === `eq.${LIBRARY_DATASET_ID}`) return ok(single([{ id: LIBRARY_DATASET_ID, dataset_key: "local-library-only", title: t.metadata.title, edition: null, row_count: v.includedKeys.length, is_active: true, status: "ready", metadata: { questionBankKind: "vocabulary_composition_v1" } }]));
  if (method === "GET" && table === "vocab_dataset_catalog" && target.searchParams.get("dataset_id") === `eq.${LIBRARY_DATASET_ID}`) return ok(single([{ dataset_id: LIBRARY_DATASET_ID, display_name: t.metadata.title, catalog_group: "high", material_kind: "wordbook", grade_code: t.metadata.targetGrade, publisher: null, series_title: null, academic_year: t.metadata.schoolYear, curriculum_revision: null, edition_label: null, is_assignable: true, sort_index: 100, metadata: { school: t.metadata.school, semester: 2, purpose: "exam_prep" } }]));
  if (method === "GET" && table === "vocab_units" && target.searchParams.get("dataset_id") === `eq.${LIBRARY_DATASET_ID}`) return ok(units);
  if (method === "GET" && table === "vocab_unit_catalog" && target.searchParams.get("unit_id")?.includes(uid(710))) return ok(units.map((u, i) => ({ unit_id: u.id, catalog_group: "high", unit_type: sourceScopes[i].classification.exam ? "exam_scope" : "lesson", display_name: u.unit_label, academic_year: null, exam_month: null, agency: null, item_range: null, sort_index: i + 1,
    metadata: { librarySourceScopes: [{ id: sourceScopes[i].id, name: sourceScopes[i].name }], ...(sourceScopes[i].classification.exam ? { mockScope: sourceScopes[i].classification.exam } : {}) } })));
  return null;
}
