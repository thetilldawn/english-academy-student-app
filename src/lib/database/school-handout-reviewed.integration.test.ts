import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { schoolHandoutFixture, sealSchoolFixture, type SchoolFixture } from "@/test-support/school-handout-fixtures";
import { reviewedHash, sha256Text, reviewedFixtureId as id, reviewedFixtureModes } from "@/test-support/reviewed-exam-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

describe.sequential("학교 원문 직접 등록과 기존 시험 보호", () => {
  let db: PGlite;
  const fixture = schoolHandoutFixture();
  let releaseId: string, datasetId: string;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const importSchool = (f: SchoolFixture) => scalar<{ release_id: string; dataset_id: string; entries: number; questions: number }>(
    "select private.import_school_handout_reviewed_bundle_v1($1,$2) value", [JSON.stringify(f.bundle), JSON.stringify(f.source)]);
  async function approve(f: SchoolFixture, overrides: { file?: string; project?: string; layout?: string } = {}) {
    await db.query(`insert into private.school_handout_import_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,source_file_sha256,scope_sha256,inputs_sha256,reviews_sha256,source_layout,entry_count,question_count,catalog_template_key,hide_dataset_keys)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$12,73,292,$10,$11)`,
      ["fake:" + f.bundle.dataset.key, overrides.project ?? "wojxpruvbjzbhrpmsbuy", f.bundle.dataset.key,
        overrides.file ?? sha256Text(JSON.stringify(f.bundle)), f.bundle.content_sha256, f.bundle.source_file_sha256,
        reviewedHash(f.source.scope), reviewedHash(f.source.inputs), reviewedHash(f.bundle.reviews),
        f.bundle.dataset.catalog_template_key, f.bundle.dataset.hide_dataset_keys, overrides.layout ?? "school_compact_v1"]);
  }
  function reseal(f: SchoolFixture) {
    for (const e of f.bundle.entries) e.entry_row_sha256 = reviewedHash(Object.fromEntries(Object.entries(e).filter(([key]) => key !== "entry_row_sha256")));
    for (const q of f.bundle.questions) {
      const e = f.bundle.entries[q.source_row - 1]!;
      q.entry_row_sha256 = e.entry_row_sha256;
      q.prompt = e[q.prompt_role];
      q.choice_texts = q.choice_source_rows.map(row => f.bundle.entries[row - 1]![q.choice_role]);
      q.item_sha256 = reviewedHash(Object.fromEntries(Object.entries(q).filter(([key]) => key !== "item_sha256")));
    }
    return sealSchoolFixture(f);
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    // Match Supabase's service role for trigger regression checks.
    await db.exec("alter role service_role bypassrls");
    await db.exec(`insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 관리자');
      insert into public.students(id,display_name,created_by) values('${id(2)}','가짜 학생','${id(1)}');
      select set_config('request.jwt.claim.sub','${id(1)}',false);
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claims','{"role":"authenticated","ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
    const voice = fixture.old.voice;
    const prior = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status) values($1,'가짜 이전자료','fake',$2,278,'ready') returning id value", [voice.dataset_key, voice.dataset_source_sha256]);
    const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,sort_index,entry_count) values($1,'이전 단위','fake','supplement',1,278) returning id value", [prior]);
    await db.query(`insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,metadata)
      values($1,'가짜 이전자료','high','textbook','g11','{"school":"검사고","semester":2,"schoolYear":2026}')`, [prior]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
      select $1,r.source_row,r.entry_row_sha256,r.headword,r.headword_normalized,array['가짜'],'가짜',$3,r.source_row,'word'
      from jsonb_to_recordset($2::jsonb) r(source_row int,entry_row_sha256 text,headword text,headword_normalized text)`,
      [prior, JSON.stringify(voice.bindings), unit]);
    for (const [name, args] of [
      ["stage_school_pronunciation_release_v1", [vocabPronunciationReleaseHeader(voice as never)]],
      ["import_vocab_pronunciation_identity_batch_v3", [voice.release_id, voice.identities]],
      ["import_vocab_pronunciation_binding_batch_v3", [voice.release_id, voice.bindings]],
      ["verify_vocab_pronunciation_release_v3", [voice.release_id]],
      ["activate_vocab_pronunciation_release_v3", [voice.release_id]],
    ] as const) {
      await scalar(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`, args.map(v => typeof v === "string" ? v : JSON.stringify(v)));
    }
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it.each(["anon", "authenticated", "service_role"])("%s는 학교 승인·정답·등록·활성화에 직접 접근할 수 없다", async role => {
    await db.exec("set role " + role);
    try {
      for (const sql of ["select * from private.school_handout_import_approvals_v1",
        "select private.import_school_handout_reviewed_bundle_v1('{}','{}')",
        `select private.activate_school_handout_reviewed_release_v1('${id(7)}')`]) await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
  it("승인 없는 파일을 거절한다", async () => { await expect(importSchool(fixture)).rejects.toThrow("school_import_not_approved"); });
  it("임의 메모로 같은 철자의 다른 품사 발음을 연결하지 못한다", async () => {
    const e = { ...fixture.bundle.entries[0]!, source_pos: "동", lexical_pos: "verb", pronunciation_classification_note: "검토" };
    await expect(db.query("select private.school_handout_pronunciation_v1($1::jsonb)", [JSON.stringify(e)])).rejects.toThrow("school_pronunciation_pos_mismatch");
  });
  it("정상 명사 원천 발음 근거도 새 동사 항목에 옮기지 못한다", async () => {
    await db.exec("begin");
    try {
      const e = structuredClone(fixture.bundle.entries[0]!);
      const donor = e.pronunciation_donor!;
      const entryId = await scalar<number>("select e.id value from public.vocab_entries e join public.vocab_datasets d on d.id=e.dataset_id where d.dataset_key=$1 and e.source_row=1", [donor.dataset_key]);
      await db.query(`insert into private.entry_source_pronunciations_v1(vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,identity_id,identity_content_sha256,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work)
        values($1,$2,$3,'noun','identity',$4,$5,$6,$7,'교정','[{"text":"교정","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260913-01')`,
        [entryId,donor.entry_row_sha256,e.headword,donor.identity_id,donor.identity_content_sha256,donor.variant_id,donor.audio_key]);
      const display = await scalar<Record<string,unknown>>("select to_jsonb(s)-'vocab_entry_id' value from public.list_entry_source_pronunciations_v1(array[$1]::bigint[]) s", [entryId]);
      const changed = { ...e, source_pos: "동", lexical_pos: "verb", pronunciation_classification_note: "검토",
        pronunciation_ko: "교정", pronunciation_donor: { ...donor, display_override: display } };
      await expect(db.query("select private.school_handout_pronunciation_v1($1::jsonb)", [JSON.stringify(changed)])).rejects.toThrow("school_pronunciation_pos_mismatch");
    } finally { await db.exec("rollback"); }
  });

  it("확장형 원문과 별도 작성한 보충 풀이를 혼동하지 않고 등록한다", async () => {
    const f = structuredClone(fixture);
    (f as unknown as { source: unknown }).source = { ...f.source, entries: f.source.entries.map(s => ({
      source_row: s.source_row, headword: s.w, source_pos: s.p, korean_meaning: s.k,
      school_english_definition: null, source_code: s.src, source_locator: s.source_locator,
    })) };
    for (const e of f.bundle.entries) {
      (e as unknown as { school_english_definition: null }).school_english_definition = null;
      e.definition_provenance = { kind: "author_created_supplement", provided_definition_found: false };
    }
    reseal(f);
    await db.exec("begin");
    try {
      await approve(f, { layout: "school_expanded_v1" });
      const imported = await importSchool(f);
      await db.query("select private.activate_school_handout_reviewed_release_v1($1)", [imported.release_id]);
      expect(await scalar("select count(*)::int value from private.reviewed_exam_entries where release_id=$1 and payload->'school_english_definition'='null'::jsonb and payload#>>'{definition_provenance,kind}'='author_created_supplement'", [imported.release_id])).toBe(73);
    } finally { await db.exec("rollback"); }
  });
  it.each(["reviewed-pos", "unclassified-expression"])("%s의 실제 발음 근거를 새 원문에 복사하고 활성화한다", async kind => {
    const f = structuredClone(fixture);
    const e = f.bundle.entries[0]!;
    const donor = e.pronunciation_donor!;
    // These transaction-local fake identities model the two already reviewed source cases.
    await db.exec("begin");
    try {
      if (kind === "reviewed-pos") {
        const old = f.old;
        await db.query("insert into private.reviewed_exam_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,$3,278,1112,'fake-pos-approval')", [old.fileHash, old.bundle.content_sha256, old.bundle.dataset.key]);
        const prior = await scalar<{ release_id: string }>("select private.import_reviewed_exam_bundle_v1($1) value", [old.text]);
        await db.query("select private.activate_reviewed_exam_release_v1($1,$2)", [prior.release_id, old.bundle.content_sha256]);
        donor.dataset_key = old.bundle.dataset.key;
        donor.entry_row_sha256 = old.bundle.entries[0]!.entry_row_sha256;
      }
      await db.query("update public.vocab_pronunciation_identities_v2 set lexical_pos='other' where identity_id=$1", [donor.identity_id]);
      await db.query("update public.vocab_entry_pronunciation_bindings_v2 set lexical_pos='other' where identity_id=$1", [donor.identity_id]);
      donor.identity_lexical_pos = "other";
      Object.assign(e, { pronunciation_classification_note: "가짜 기존 발음 근거의 검토된 품사 분리" });
      if (kind === "reviewed-pos") {
        const entryId = await scalar<number>("select e.id value from public.vocab_entries e join public.vocab_datasets d on d.id=e.dataset_id where d.dataset_key=$1 and e.source_row=1", [donor.dataset_key]);
        await db.query(`insert into private.entry_source_pronunciations_v1(vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,identity_id,identity_content_sha256,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work,identity_lexical_pos)
          values($1,$2,$3,'noun','identity',$4,$5,$6,$7,'교정','[{"text":"교정","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260913-01','other')`,
          [entryId,donor.entry_row_sha256,e.headword,donor.identity_id,donor.identity_content_sha256,donor.variant_id,donor.audio_key]);
        Object.assign(donor, { display_override: await scalar("select to_jsonb(s)-'vocab_entry_id' value from public.list_entry_source_pronunciations_v1(array[$1]::bigint[]) s", [entryId]) });
        e.pronunciation_ko = "교정";
      } else {
        for (const [index, row] of f.bundle.entries.entries()) {
          row.source_pos = index === 0 ? null : "동";
          f.source.entries[index]!.p = row.source_pos;
          row.lexical_pos = "verb";
          row.lexical_classification_note = index === 0 ? "학교 미기재 표현의 내부 동사 분류" : null;
          if (index > 0) { row.pronunciation_donor = null; row.pronunciation_ko = null; }
        }
        Object.assign(e, { grammatical_form: "verb_expression" });
      }
      reseal(f);
      await approve(f);
      const imported = await importSchool(f);
      await db.query("select private.activate_school_handout_reviewed_release_v1($1)", [imported.release_id]);
      expect(await scalar("select pronunciation_identity_id value from private.reviewed_exam_entries where release_id=$1 and source_row=1", [imported.release_id])).toBe(donor.identity_id);
      if (kind === "reviewed-pos") expect(await scalar("select s.display_ko value from private.reviewed_exam_entries e cross join lateral public.list_entry_source_pronunciations_v1(array[e.vocab_entry_id]) s where e.release_id=$1 and e.source_row=1", [imported.release_id])).toBe("교정");
    } finally { await db.exec("rollback"); }
  });

  const mutations: Array<[string, (f: SchoolFixture) => void]> = [
    ["학교 뜻", f => { f.bundle.entries[0]!.korean_meaning = "바뀐 뜻"; }],
    ["학교 정의", f => { f.bundle.entries[0]!.english_definition = "an invented definition"; }],
    ["학교 표제어", f => { f.bundle.entries[0]!.headword = "invented"; }],
    ["학교 미기재 품사", f => { f.bundle.entries[4]!.source_pos = "명"; }],
    ["학교 순서", f => { f.bundle.entries.reverse(); }],
    ["학교 원문 위치", f => { f.bundle.entries[0]!.jsonl_line = 999; }],
    ["학교 범위", f => { f.bundle.scope = { ...f.bundle.scope, semester: 1 }; }],
    ["NULL 내부 품사", f => { (f.bundle.entries[4] as unknown as Record<string, unknown>).lexical_pos = null; }],
    ["숫자 정의", f => { (f.bundle.entries[4] as unknown as Record<string, unknown>).english_definition = 123; }],
    ["기재 품사와 다른 내부 품사", f => { f.bundle.entries[0]!.lexical_pos = "verb"; }],
    ["정답 내용", f => { f.bundle.questions[0]!.choice_texts[0] = "wrong answer"; }],
    ["정답 번호", f => { f.bundle.questions[0]!.correct_choice_index = 1; }],
    ["중복 보기", f => { f.bundle.questions[0]!.choice_source_rows[1] = 1; }],
    ["존재하지 않는 다섯 번째 보기", f => { f.bundle.questions[0]!.choice_source_rows.push(999999); }],
    ["다른 행 해시", f => { f.bundle.questions[0]!.entry_row_sha256 = "f".repeat(64); }],
    ["발음 identity 해시", f => { f.bundle.entries[0]!.pronunciation_donor!.identity_content_sha256 = "e".repeat(64); }],
    ["발음 행 해시", f => { f.bundle.entries[0]!.pronunciation_donor!.entry_row_sha256 = "e".repeat(64); }],
    ["발음 표제어", f => { f.bundle.entries[0]!.pronunciation_donor!.identity_headword = "beta"; }],
    ["발음 품사", f => { f.bundle.entries[0]!.pronunciation_donor!.identity_lexical_pos = "verb"; }],
    ["발음 변형", f => { f.bundle.entries[0]!.pronunciation_donor!.variant_id = "fake-variant"; }],
  ];
  it.each(mutations)("%s 변조를 다시 해시해도 거절하고 부분 등록을 남기지 않는다", async (_name, mutate) => {
    const f = structuredClone(fixture);
    mutate(f);
    for (const e of f.bundle.entries) e.entry_row_sha256 = reviewedHash(Object.fromEntries(Object.entries(e).filter(([key]) => key !== "entry_row_sha256")));
    for (const q of f.bundle.questions) q.item_sha256 = reviewedHash(Object.fromEntries(Object.entries(q).filter(([key]) => key !== "item_sha256")));
    sealSchoolFixture(f);
    const before = await scalar("select count(*)::int value from public.vocab_datasets");
    await db.exec("begin");
    try {
      await approve(f);
      await expect(importSchool(f)).rejects.toThrow();
    } finally { await db.exec("rollback"); }
    expect(await scalar("select count(*)::int value from public.vocab_datasets")).toBe(before);
  });
  it.each(["project", "file"] as const)("%s 승인 경계를 검사한다", async which => {
    await db.exec("begin");
    try {
      await approve(fixture, which === "project" ? { project: "wrong-project" } : { file: "f".repeat(64) });
      await expect(importSchool(fixture)).rejects.toThrow("school_import_not_approved");
    } finally { await db.exec("rollback"); }
  });
  it("원문 파일의 공백까지 승인된 파일 해시로 검사한다", async () => {
    await db.exec("begin");
    try {
      await approve(fixture);
      await expect(db.query("select private.import_school_handout_reviewed_bundle_v1($1,$2)", [JSON.stringify(fixture.bundle), JSON.stringify(fixture.source) + " "])).rejects.toThrow("school_bundle_invalid");
    } finally { await db.exec("rollback"); }
  });
  it("73행과292문항을 등록하고 같은 파일 재실행은 같은 자료를 반환한다", async () => {
    await approve(fixture);
    const imported = await importSchool(fixture);
    expect(imported).toMatchObject({ entries: 73, questions: 292 });
    releaseId = imported.release_id; datasetId = imported.dataset_id;
    expect(await importSchool(fixture)).toMatchObject({ release_id: releaseId, dataset_id: datasetId, reused: true });
    expect(await scalar("select count(*)::int value from private.reviewed_exam_entries where release_id=$1 and predecessor_entry_id is null and pronunciation_identity_id is null", [releaseId])).toBe(69);
  });
  it.each([
    ["원문과 전체 묶음", `update private.reviewed_exam_releases set school_source=jsonb_set(school_source,'{scope,school}','"변경"'),school_source_text=jsonb_set(school_source,'{scope,school}','"변경"')::text where release_id=$1`],
    ["저장 entry payload", `update private.reviewed_exam_entries set payload=jsonb_set(payload,'{korean_meaning}','"변경"') where release_id=$1 and source_row=1`],
    ["저장 public entry", `update public.vocab_entries set primary_meaning='변경' where id in (select vocab_entry_id from private.reviewed_exam_entries where release_id=$1 and source_row=1)`],
    ["단원 이름", `update public.vocab_unit_catalog set display_name='변경' where unit_id in (select u.id from public.vocab_units u join private.reviewed_exam_releases r on r.dataset_id=u.dataset_id where r.release_id=$1)`],
    ["선택 목록 삭제", `delete from public.vocab_dataset_catalog where dataset_id=(select dataset_id from private.reviewed_exam_releases where release_id=$1)`],
    ["선택 목록 학기", `update public.vocab_dataset_catalog set metadata=jsonb_set(metadata,'{semester}','1') where dataset_id=(select dataset_id from private.reviewed_exam_releases where release_id=$1)`],
  ])("활성화 직전 %s 변경을 거절한다", async (_label, sql) => {
    await db.exec("begin");
    try {
      await db.query(sql, [releaseId]);
      await expect(db.query("select private.activate_school_handout_reviewed_release_v1($1)", [releaseId])).rejects.toThrow();
    } finally { await db.exec("rollback"); }
    expect(await scalar("select is_assignable value from public.vocab_dataset_catalog c join public.vocab_datasets d on d.id=c.dataset_id where d.dataset_key=$1", [fixture.old.voice.dataset_key])).toBe(true);
  });
  it("학교 자료는 기존 activator로 승인 검사를 우회하지 못한다", async () => {
    await expect(db.query("select private.activate_reviewed_exam_release_v1($1,$2)", [releaseId, fixture.bundle.content_sha256])).rejects.toThrow();
  });
  it("새 선택만 전환하고 구판 active·ready 및 원래 발음 연결을 보존한다", async () => {
    await db.query("select private.activate_school_handout_reviewed_release_v1($1)", [releaseId]);
    await db.query("select private.activate_school_handout_reviewed_release_v1($1)", [releaseId]);
    expect(await scalar("select status value from public.vocab_datasets where id=$1", [datasetId])).toBe("ready");
    expect(await scalar("select is_assignable value from public.vocab_dataset_catalog where dataset_id=$1", [datasetId])).toBe(true);
    expect(await scalar("select status value from public.vocab_datasets where dataset_key=$1", [fixture.old.voice.dataset_key])).toBe("ready");
    expect(await scalar("select status value from public.vocab_pronunciation_releases_v2 where release_id=$1", [fixture.old.voice.release_id])).toBe("active");
    const ids = (await db.query<{ id: number }>("select id from public.vocab_entries where dataset_id=$1 order by source_row", [datasetId])).rows.map(e => e.id);
    expect((await db.query("select * from public.list_active_vocab_pronunciation_bindings_v3($1::bigint[])", [ids])).rows).toHaveLength(4);
  });
  it("service_role의 일반 entry 수정은 유지하고 활성 학교 원문 수정은 차단한다", async () => {
    await db.exec("set role service_role");
    try {
      expect((await db.query("update public.vocab_entries set primary_meaning=primary_meaning where dataset_id=(select id from public.vocab_datasets where dataset_key=$1)", [fixture.old.voice.dataset_key])).affectedRows).toBe(278);
      await expect(db.query("update public.vocab_entries set primary_meaning='바꿈' where dataset_id=$1", [datasetId])).rejects.toThrow("school_active_content_immutable");
    } finally { await db.exec("reset role"); }
  });
  it.each(reviewedFixtureModes)("%s %s 학교 원문으로 배정·공부를 연결하고 정답 보기를 노출하지 않는다", async (mode, direction) => {
    const units = (await db.query<{ id: string }>("select id from public.vocab_units where dataset_id=$1", [datasetId])).rows.map(u => u.id);
    const rows = (await db.query<{ vocab_entry_id: number; item_id: string; item_sha256: string }>("select vocab_entry_id,item_id,item_sha256 from private.reviewed_exam_items where release_id=$1 and quiz_mode=$2 and direction=$3 order by vocab_entry_id limit 12", [releaseId, mode, direction])).rows;
    const questions = rows.map((r, i) => ({ vocab_entry_id: r.vocab_entry_id, base_order_index: i + 1, direction,
      reviewed_bank: { source: "reviewed_exam_v1", mode, release_id: releaseId, package_sha256: sha256Text(JSON.stringify(fixture.bundle)), question_item_id: r.item_id, question_item_sha256: r.item_sha256 } }));
    const assignment = await scalar<string>(`select private.create_assignment_with_delivery_v7('가짜 학교시험',$1::uuid,$2::uuid[],12,$3::smallint,300,80::smallint,'fixed',null,array['${id(2)}']::uuid[],'none',null,$4::jsonb) value`, [datasetId, units, direction === "english_to_korean" ? 100 : 0, JSON.stringify(questions)]);
    const study = await scalar<{ words: Record<string, unknown>[] }>("select public.get_student_assignment_study_v1($1,$2) value", [id(2), assignment]);
    expect(study.words).toHaveLength(12);
    expect(study.words.every(w => mode.includes("definition") ? typeof w.definition === "string" : w.definition === null)).toBe(true);
    expect(JSON.stringify(study)).not.toMatch(/choice_texts|correct_choice|item_sha256|choice_source_rows/);
  });
});
