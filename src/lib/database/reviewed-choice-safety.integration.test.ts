import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedCsatFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";
import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import type { ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import type { ReviewedChoiceSafety } from "@/lib/quiz/choice-safety";
import type { QuizQuestionDraft } from "@/lib/quiz/question-types";
import { normalizeQuizChoice, normalizeQuizHeadword } from "@/lib/quiz/word-identity";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema } from "@/features/wordbook-compositions/contracts/library";
import { compositionQuestionInputSchema, compositionPreparationSchema, compositionStepSchema, type CompositionQuestionInput } from "@/features/wordbook-compositions/contracts/library-materialization";
import { planCompositionQuestions } from "@/features/wordbook-compositions/server/use-cases/composition-question-plan";
vi.mock("server-only", () => ({}));

const adminId = "00000000-0000-4000-8000-000000097601", studentId = "00000000-0000-4000-8000-000000097602";
const project = "wojxpruvbjzbhrpmsbuy", sha = (s: string) => createHash("sha256").update(s).digest("hex");
const selected = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
describe.sequential("reviewed choice safety across original, composed and delivered questions", () => {
  let db: PGlite, bundle: ReviewedMockBundle, datasetId: string, sourceIds: number[], prep: CompositionQuestionInput, plan: QuizQuestionDraft[], original: unknown;
  let command: { action: string; requestId: string; templateId: string; versionId: string; contentHash: string };
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const sourceSnapshot = () => scalar(`select jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by id) from public.vocab_entries e where dataset_id=$1),
    'occurrences',(select jsonb_agg(to_jsonb(o) order by source_row) from word_index.app_exam_use_occurrence o where vocab_entry_id=any($2::bigint[]))) value`, [datasetId, sourceIds]);
  async function approve(b: ReviewedMockBundle) {
    await owner();
    await db.query(`insert into private.reviewed_mock_source_approvals_v1(approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,package_version,occurrence_count,included_count,scope_count,expected_link_counts,review_evidence_sha256)
      values($1,$2,$3,$4,$5,$6,100,100,25,$7,$8)`, [b.approval_id, project, b.package.dataset_key, sha(JSON.stringify(b)), b.content_sha256, b.package.package_version,
      JSON.stringify({ dictionary: 100, pos: 100, pronunciation: 0, definition: 1, example: 1 }), sha256CanonicalJson(b.resources.map(r => r.review_records))]);
    await service();
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name === "20260921070000_preserve_reviewed_choice_conflicts.sql") {
        // Deployed functions may retain Windows line endings. The usual test
        // harness normalizes files, so deliberately exercise that boundary.
        const previous = (await database.query<{ body: string }>("select pg_get_functiondef('private.validate_vocabulary_composition_question_plan_v1(uuid,jsonb)'::regprocedure) body")).rows[0]!.body;
        await database.exec(previous.replace(/\r?\n/g, "\r\n"));
      }
    } });
    await db.exec(`select set_config('request.jwt.claims','{"ref":"${project}"}',false); insert into auth.users(id) values('${adminId}');
      insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자');
      insert into public.students(id,display_name,created_by,school_name,grade_label) values('${studentId}','가짜 학생','${adminId}','가짜 고등학교','고3')`);
    bundle = buildReviewedCsatFixture(2025, 21);
    (bundle.package.entries[0]!.context_evidence.choice_safety as ReviewedChoiceSafety).exclusions = [
      { direction: "english_to_korean", choice: "가짜 뜻 2" }, { direction: "korean_to_english", choice: "fixture2" },
    ];
    resealMockReview(bundle); await approve(bundle);
    const saved = await scalar<{ datasetId: string; releaseId: string }>("select public.import_reviewed_mock_wordbook_v1($1) value", [JSON.stringify(bundle)]);
    datasetId = saved.datasetId; await owner();
    const rows = (await db.query<{ id: number; source_row: number; unit_id: string; row_hash: string }>("select id,source_row,unit_id,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [datasetId])).rows;
    sourceIds = rows.map(r => r.id); original = await sourceSnapshot();
    const lib = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("safety-catalog"), linksHash: sha("safety-links"), referenceCatalogHash: sha("safety-refs"),
      scopes: [0, 1].map(index => ({ key: `safety-${index}`, name: `가짜 수능 범위 ${index}`, sourceTitle: "가짜 수능",
        source: { datasetId, unitId: rows[index * 4]!.unit_id, kind: "exam_use", releaseId: saved.releaseId, releaseVersion: bundle.package.package_version, fileHash: sha(JSON.stringify(bundle)), locator: "fake.json" },
        classification: { kind: "csat", sourceGrade: "g12", exam: bundle.scopes[index]!.metadata, lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
        rows: rows.slice(index * 4, index * 4 + 4).map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: sha(`safety:${r.id}`), selected } })),
      })) };
    const text = JSON.stringify(lib), contentHash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [text]);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,$3,2,'fake-choice-safety')", [project, sha(text), contentHash]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [text]); await admin();
    const catalog = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value"));
    const t = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(),
      metadata: { title: "가짜 보기 검토", tags: [], school: null, targetGrade: "g12", schoolYear: 2026, semester: null, assessment: null, purpose: null },
      recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: catalog.scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    command = { action: "materialize", requestId: randomUUID(), templateId: t.id, versionId: t.versions[0]!.id, contentHash: t.versions[0]!.contentHash };
  }, 60000);
  afterAll(async () => db?.close());

  it("uses the same displayed-value normalization in the generator and storage", async () => {
    await owner();
    for (const value of ["v", "view", "\t가짜 뜻 2\r\n", "\vＦＩＸ*ＴＵＲＥ2\v", "\u2028\uFEFFfixture2\u3000", "가짜 뜻 2"]) {
      for (const direction of ["english_to_korean", "korean_to_english"] as const) {
        expect(await scalar("select private.reviewed_choice_key_v1($1,$2) value", [value, direction]))
          .toBe(direction === "english_to_korean" ? normalizeQuizChoice(value) : normalizeQuizHeadword(value));
      }
    }
  });

  it("returns complete cursor pages to admins and blocks student/anonymous access", async () => {
    await admin(); let after = 0; const all: { vocab_entry_id: number; choice_safety: ReviewedChoiceSafety }[] = [];
    for (;;) {
      const rows = (await db.query<typeof all[number]>("select * from public.list_vocabulary_choice_safety_v1($1,$2,33)", [datasetId, after])).rows;
      if (!rows.length) break; all.push(...rows); after = rows.at(-1)!.vocab_entry_id;
    }
    expect(all.map(r => r.vocab_entry_id)).toEqual(sourceIds);
    expect(all[0]!.choice_safety).toEqual(bundle.package.entries[0]!.context_evidence.choice_safety);
    await db.exec("reset role; set role anon");
    await expect(db.query("select * from public.list_vocabulary_choice_safety_v1($1)", [datasetId])).rejects.toThrow("permission denied");
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${studentId}',false)`);
    await expect(db.query("select * from public.list_vocabulary_choice_safety_v1($1)", [datasetId])).rejects.toThrow("admin_required");
    await expect(db.query("select private.vocabulary_entry_choice_safety_v1($1)", [sourceIds[0]])).rejects.toThrow("permission denied");
  });
  it("rejects a newly approved CSAT package lacking a reviewed policy atomically", async () => {
    const bad = buildReviewedCsatFixture(2025, 22); delete bad.package.entries[0]!.context_evidence.choice_safety;
    resealMockReview(bad); await approve(bad);
    await expect(db.query("select public.import_reviewed_mock_wordbook_v1($1)", [JSON.stringify(bad)])).rejects.toThrow("csat_choice_review_required");
    await owner(); expect(await scalar("select count(*)::int value from public.vocab_datasets where dataset_key=$1", [bad.package.dataset_key])).toBe(0);
    expect(await sourceSnapshot()).toEqual(original);
  });
  it("copies policy through both preparation APIs and excludes it in actual generated choices", async () => {
    await admin();
    prep = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(command)]));
    expect(prep.entries).toHaveLength(8);
    expect(prep.entries[0]!.choiceSafety).toEqual(bundle.package.entries[0]!.context_evidence.choice_safety);
    const full = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [prep.versionId, prep.contentHash]));
    expect(full.entries.map(entry => { const copy: Partial<typeof entry> = { ...entry }; delete copy.resources; return copy; })).toEqual(prep.entries);
    plan = planCompositionQuestions(prep); expect(plan).toHaveLength(16);
    for (const q of plan.filter(q => q.vocabEntryId === prep.entries[0]!.id)) expect(q.choices).not.toContain(q.direction === "english_to_korean" ? "가짜 뜻 2" : "fixture2");
  });
  it("rejects a changed full plan before persisting a batch or legacy finalization", async () => {
    const bad = structuredClone(plan), q = bad.find(q => q.vocabEntryId === prep.entries[0]!.id && q.direction === "english_to_korean")!;
    const index = (q.correctChoiceIndex + 1) % 4; q.choices[index] = "가짜 뜻 2"; q.choiceVocabEntryIds[index] = prep.entries[1]!.id;
    await service();
    for (const fn of ["advance_vocabulary_composition_questions_v1", "finalize_vocabulary_composition_summary_v1"]) {
      await expect(db.query(`select public.${fn}($1,$2,$3::jsonb)`, [prep.versionId, prep.contentHash, JSON.stringify(bad)])).rejects.toThrow("reviewed_choice_ambiguous");
    }
    await owner();
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_items where version_id=$1", [prep.versionId])).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_question_plans where version_id=$1", [prep.versionId])).toBe(0);
  });
  it("publishes a valid bank with policy proof in the exact item hash", async () => {
    await service();
    let step = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value", [prep.versionId, prep.contentHash, JSON.stringify(plan)]));
    for (let i = 0; i < 4 && step.state !== "ready"; i++) step = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,null) value", [prep.versionId, prep.contentHash]));
    expect(step.state).toBe("ready"); await owner();
    expect(await scalar(`select bool_and(item_id=item_sha256 and item_sha256=private.reviewed_exam_sha256_v1(jsonb_build_object(
      'vocabEntryId',vocab_entry_id,'direction',direction,'prompt',prompt,'choices',to_jsonb(choice_texts),'choiceVocabEntryIds',to_jsonb(choice_vocab_entry_ids),
      'correctChoiceIndex',correct_choice_index,'versionId',version_id,'proof',source_proof,'pronunciation',pronunciation_snapshot))) value from private.vocabulary_composition_items where version_id=$1`, [prep.versionId])).toBe(true);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_items where version_id=$1 and source_proof#>>'{choicePolicy,evidenceSha256}'=$2", [prep.versionId, "a".repeat(64)])).toBe(16);
    expect(await sourceSnapshot()).toEqual(original);
  });
  it("delivers the frozen bank and exact review safely, blocking prompt/index/content bypasses", async () => {
    await admin(); const units = [...new Set(prep.entries.map(e => e.unitId))];
    const rows = (await db.query<{ vocab_entry_id: number; direction: string; question_item_id: string; question_item_sha256: string }>("select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')", [prep.datasetId, units])).rows.filter(q => q.direction === "english_to_korean");
    const questions = rows.map((q, index) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: index + 1, direction: q.direction,
      composition_bank: { mode: "book_meaning_choice", version_id: prep.versionId, content_sha256: prep.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } }));
    expect(questions).toHaveLength(8);
    const assignment = await scalar<string>(`select public.create_assignment_with_delivery_v7('가짜 검토 시험',$1::uuid,$2::uuid[],8,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [prep.datasetId, units, JSON.stringify(questions)]);
    await owner();
    const attempt = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [studentId, assignment]);
    expect(await scalar("select choices value from public.quiz_questions where attempt_id=$1 and vocab_entry_id=$2", [attempt, prep.entries[0]!.id])).not.toContain("가짜 뜻 2");
    for (const change of ["prompt='변조'", "correct_choice_index=(correct_choice_index+1)%4", "choices=jsonb_set(choices,array[((correct_choice_index+1)%4)::text],'\"가짜 뜻 2\"'::jsonb)"]) {
      await expect(db.query(`update public.assignment_questions set ${change} where assignment_id=$1 and vocab_entry_id=$2`, [assignment, prep.entries[0]!.id])).rejects.toThrow(/reviewed_choice_(prompt_mismatch|answer_mismatch|ambiguous)/);
    }
    const exact = plan.filter(q => q.direction === "english_to_korean").map((q, i) => ({ vocab_entry_id: q.vocabEntryId, base_order_index: i + 1, direction: q.direction, choice_vocab_entry_ids: q.choiceVocabEntryIds }));
    const review = await scalar<string>(`select private.create_exact_review_assignment_with_delivery_v1('가짜 오답 재출제',$1::uuid,$2::uuid[],8,100::smallint,300,80::smallint,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [prep.datasetId, units, JSON.stringify(exact)]);
    expect(await scalar("select choices value from public.assignment_questions where assignment_id=$1 and vocab_entry_id=$2", [review, prep.entries[0]!.id])).not.toContain("가짜 뜻 2");
    expect(await sourceSnapshot()).toEqual(original);
  });
});
