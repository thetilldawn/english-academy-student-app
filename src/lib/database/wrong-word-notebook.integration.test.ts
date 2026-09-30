import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { wrongWordNotebookItemSchema } from "@/features/students/contracts/wrong-word-notebook";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student = uuid(1), otherStudent = uuid(2), dataset = uuid(3), otherDataset = uuid(4);
const oldSql = fs.readFileSync(path.resolve("supabase/migrations/20260921020000_page_student_wrong_words.sql"), "utf8");
const sql = fs.readFileSync(path.resolve("supabase/migrations/20260929140225_share_wrong_word_notebook_reads.sql"), "utf8");
type Row = { key: string; wrongCount: number; lastWrongAt: string; [key: string]: unknown };
type Page = { items: Row[]; totalCount: number | null; summary: Record<string, number> | null; eventUpperId: string; [key: string]: unknown };
type Args = { student?: string; dataset?: string; level?: string; query?: string; upper?: string; at?: string; key?: string; min?: number; max?: number };
describe.sequential("누적 오답 공통 조회 SQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create function private.is_active_admin() returns boolean language sql as $$ select coalesce(current_setting('app.admin',true),'')='yes' $$;
      create table public.students(id uuid primary key,deleted_at timestamptz,status text default 'active');
      create table public.vocab_datasets(id uuid primary key,title text,edition text);
      create table public.vocab_entries(id bigint primary key,dataset_id uuid,headword text,headword_normalized text,primary_meaning text);
      create table public.assignments(id uuid primary key,dataset_id uuid,status text,title text);
      create table public.assignment_students(assignment_id uuid,student_id uuid,assigned_at timestamptz,cancelled_at timestamptz,missed_at timestamptz);
      create table public.assignment_questions(id uuid primary key,assignment_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_lexeme_id_snapshot uuid,headword_normalized_snapshot text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text);
      create table public.assignment_question_exam_use_snapshot(assignment_question_id uuid primary key,dictionary_id text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text);
      create table public.quiz_attempts(id uuid primary key,assignment_id uuid,student_id uuid,status text);
      create table public.quiz_questions(id uuid primary key,vocab_entry_id bigint,assignment_question_id uuid,initial_is_correct boolean,retry_is_correct boolean);
      create table public.student_vocab_wrong_events(id bigint primary key,student_id uuid,quiz_attempt_id uuid,quiz_question_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,wrong_stage text,wrong_at timestamptz);
      create table public.student_vocab_state(student_id uuid,vocab_entry_id bigint,unresolved_wrong_count integer,resolved_at timestamptz,last_evaluated_at timestamptz,primary key(student_id,vocab_entry_id));
      create table public.student_vocab_review_queue_read_v1(id uuid,student_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,source_question_id uuid,reason_level smallint,queued_at timestamptz,active_review_draft_id uuid,status text);

      create table public.student_point_events(id integer,points integer);
      insert into public.student_point_events values(1,7);
      insert into public.students(id) values('${student}'),('${otherStudent}');
      insert into public.vocab_datasets values('${dataset}','검사 책',null),('${otherDataset}','다른 책',null);
      set app.admin='yes';
    `);
    await db.exec(oldSql);
    await db.exec(sql);
    let eventId = 0;
    for (let n = 1; n <= 25; n++) {
      const count = (n - 1) % 5 + 1;
      await db.query("insert into public.vocab_entries values($1,$2,$3,$3,$4)", [n, dataset, "Word " + n, "원뜻 " + n]);
      for (let k = 0; k < count; k++) {
        eventId++;
        const q = uuid(1000 + eventId), a = uuid(2000 + eventId);
        await db.query("insert into public.assignment_questions(id,headword_snapshot,primary_meaning_snapshot,provenance_status) values($1,$2,$3,'verified_v2')", [a, "Word " + n, "검증 뜻 " + n]);
        await db.query("insert into public.quiz_questions values($1,$2,$3,false,$4)", [q, n, a, n === 2 ? true : null]);
        await db.query("insert into public.student_vocab_wrong_events values($1,$2,$3,$4,$5,$6,$7,null,'initial','2026-09-29T10:00:00.123456Z')",
          [eventId, student, uuid(900), q, dataset, n, "word-" + n]);
      }
    }
    await db.exec(`
      insert into public.vocab_entries values(26,'${otherDataset}','Another source','Another source','다른 뜻');
      insert into public.assignment_questions(id,headword_snapshot,primary_meaning_snapshot,provenance_status) values('${uuid(5000)}','사용하면 안 되는 현재값','잘못된 뜻','verified_v2');
      insert into public.assignment_question_exam_use_snapshot values('${uuid(5000)}','word-1','Exam source','학교 뜻','reviewed_for_preview_v1');
      insert into public.quiz_questions values('${uuid(3000)}',26,'${uuid(5000)}',false,null);
      insert into public.student_vocab_wrong_events values(76,'${student}','${uuid(900)}','${uuid(3000)}','${otherDataset}',26,'word-1',null,'initial','2026-09-29T10:00:00.123456Z');
      insert into public.student_vocab_wrong_events select 77,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'retry',wrong_at from public.student_vocab_wrong_events where id=1;
      insert into public.student_vocab_wrong_events select 78,'${otherStudent}',quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial',wrong_at from public.student_vocab_wrong_events where id=1;
      grant usage on schema private,public to service_role;
      grant select on all tables in schema public to service_role;
    `);
  }, 30000);
  afterAll(async () => { await db.close(); });
  async function page(kind: "admin" | "student" | "old" = "admin", args: Args = {}) {
    const fn = kind === "admin" ? "get_admin_student_wrong_word_page_v2" : kind === "student" ? "get_student_wrong_word_notebook_page_v1" : "get_admin_student_wrong_word_page_v1";
    const values: (string | number | null)[] = [args.student ?? student, args.dataset ?? null, args.level ?? "all", args.query ?? "", args.upper ?? null, args.at ?? null, args.key ?? null];
    if (kind !== "old") values.push(args.min ?? null, args.max ?? null);
    const result = await db.query<{ page: Page | null }>(`select public.${fn}(${values.map((_, n) => "$" + (n + 1)).join(",")}) as page`, values);
    return result.rows[0].page;
  }
  it.each(["all", "once", "repeated"])("기존 %s 조회 결과와 v2가 같다", async level => {
    expect(await page("admin", { level })).toEqual(await page("old", { level }));
  });
  it("정확횟수/이상/범위를 전체 집계 뒤 적용한다", async () => {
    expect(await page("admin", { min: 1, max: 1 })).toEqual(await page("admin", { level: "once" }));
    expect(await page("admin", { min: 2 })).toEqual(await page("admin", { level: "repeated" }));
    expect((await page("admin", { min: 3, max: 3 }))?.totalCount).toBe(5);
    expect((await page("admin", { min: 2, max: 4 }))?.totalCount).toBe(16);
    expect((await page("admin", { min: 5 }))?.totalCount).toBe(5);
    expect((await page("admin", { min: 6 }))?.totalCount).toBe(0);
    const cross = await page("admin", { dataset: otherDataset, min: 2, max: 2 });
    expect(cross?.totalCount).toBe(1);
    expect(cross?.items[0]).toMatchObject({ key: "dictionary:word-1", wrongCount: 2, headword: "Exam source", primaryMeaning: "학교 뜻" });
    expect(cross?.items[0].occurrences).toHaveLength(2);
  });
  it("학생과 교사는 같은 단어/횟수를 보고 전체/미해결 요약을 혼용하지 않는다", async () => {
    const admin = (await page())!, own = (await page("student"))!;
    expect(own.items).toEqual(admin.items.map(item => wrongWordNotebookItemSchema.parse(item)));
    expect(own.summary).toEqual({ wordCount: 25, wrongEventCount: 76, repeatedWordCount: 21 });
    expect(admin.summary?.uniqueWordCount).toBe(24);
    for (const name of ["latestQuestionId", "latestAttemptId", "activeAssignment", "reviewDrafts", "scheduling", "correctOption"]) {
      expect(JSON.stringify(own)).not.toContain(name);
    }
    expect((await page("student", { student: otherStudent }))?.totalCount).toBe(1);
    expect((await page("student", { query: "not found" }))?.items).toEqual([]);
    expect((await page("student", { query: "not found" }))?.totalCount).toBe(0);
  });
  it("해결·대기·배정된 단어를 넣어도 v1 의미와 누적 단어 수가 보존된다", async () => {
    await db.exec("begin");
    try {
      await db.exec(`
        insert into public.student_vocab_state values('${student}',5,0,'2026-09-29T12:00:00Z','2026-09-29T12:00:00Z');
        insert into public.student_vocab_review_queue_read_v1 values('${uuid(7001)}','${student}','${dataset}',6,'word-6',null,'${uuid(1016)}',1,'2026-09-29T12:00:00Z',null,'pending');
        insert into public.assignments values('${uuid(7002)}','${dataset}','open','가짜 오답 배정');
        insert into public.assignment_students values('${uuid(7002)}','${student}','2026-09-29T12:00:00Z',null,null);
        insert into public.assignment_questions(id,assignment_id,dataset_id,vocab_entry_id,headword_normalized_snapshot) values('${uuid(7003)}','${uuid(7002)}','${dataset}',7,'Word 7');
        insert into public.assignment_question_exam_use_snapshot(assignment_question_id,dictionary_id) values('${uuid(7003)}','word-7');
      `);
      for (const query of ["Word 5", "Word 6", "Word 7"]) {
        expect(await page("admin", { query })).toEqual(await page("old", { query }));
      }
      expect((await page("admin", { query: "Word 5" }))?.items[0]).toMatchObject({ resolution: "resolved", wrongCount: 5 });
      expect((await page("admin", { query: "Word 6" }))?.items[0]).toMatchObject({ scheduling: "queued" });
      expect((await page("admin", { query: "Word 7" }))?.items[0]).toMatchObject({ scheduling: "assigned" });
      expect((await page("student"))?.summary?.wordCount).toBe(25);
    } finally { await db.exec("rollback"); }
  });
  it("21개 조건결과를10+10+1로 읽는다", async () => {
    const first = (await page("student", { min: 2 }))!;
    const next = async (from: Page) => page("student", { min: 2, upper: first.eventUpperId, at: from.items[9].lastWrongAt, key: from.items[9].key });
    const second = (await next(first))!, third = (await next(second))!;
    expect(first.totalCount).toBe(21);
    expect(first.items).toHaveLength(11); expect(second.items).toHaveLength(11); expect(third.items).toHaveLength(1);
    expect(new Set([...first.items.slice(0, 10), ...second.items.slice(0, 10), ...third.items].map(item => item.key)).size).toBe(21);
  });
  it("동일 시각에도10개씩25개를누락/중복없이읽고새오답은현재페이지에끼우지않는다", async () => {
    const first = (await page("student"))!;
    const words = [...first.items.slice(0, 10)];
    expect(first.items).toHaveLength(11);
    await db.exec("begin");
    try {
      await db.exec(`insert into public.student_vocab_wrong_events select 100,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial','2026-09-30T00:00:00Z' from public.student_vocab_wrong_events where id=1`);
      let current = first;
      while (current.items.length === 11) {
        const last = current.items[9];
        current = (await page("student", { upper: first.eventUpperId, at: last.lastWrongAt, key: last.key }))!;
        expect(current.summary).toBeNull(); expect(current.totalCount).toBeNull();
        words.push(...current.items.slice(0, 10));
      }
      expect(words).toHaveLength(25); expect(new Set(words.map(x => x.key)).size).toBe(25);
      expect(await page("student", { upper: first.eventUpperId })).toEqual(first);
    } finally { await db.exec("rollback"); }
  });
  it.each([{ min: 0 }, { min: 3, max: 1 }, { level: "once", min: 1 }, { at: "2026-09-29T00:00:00Z" }])("잘못된SQL조건을거절한다: %j", async args => {
    await expect(page("admin", args)).rejects.toMatchObject({ code: "22023" });
  });
  it("학생 읽기는 service_role만, 관리자 읽기는 유효 관리자만 호출한다", async () => {
    const signature = "(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer)";
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') as allowed", [role, "public.get_student_wrong_word_notebook_page_v1" + signature]);
      expect(result.rows[0].allowed).toBe(false);
    }
    await db.exec("set role authenticated; set app.admin='no'");
    try { await expect(page("admin")).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.exec("reset role; set app.admin='yes'"); }
    await db.exec("set role service_role");
    try { expect((await page("student"))?.totalCount).toBe(25); await expect(page("admin")).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.exec("reset role"); }
  });
  it("조회가정규자료를쓰지않고삭제/차단학생은학생DTO를받지않는다", async () => {
    async function snapshot() {
      const names = ["students", "student_vocab_wrong_events", "student_vocab_state", "assignments", "assignment_students", "quiz_questions", "assignment_questions", "vocab_entries", "student_point_events"];
      const result: unknown[] = [];
      for (const name of names) result.push((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as value from public.${name} t`)).rows);
      return result;
    }
    const before = await snapshot(); await page(); await page("student"); await page("old");
    expect(await snapshot()).toEqual(before);
    await db.exec("begin");
    try {
      await db.query("update public.students set status='blocked' where id=$1", [student]);
      expect(await page("student")).toBeNull();
      await db.query("update public.students set status='active',deleted_at=now() where id=$1", [student]);
      expect(await page("student")).toBeNull(); expect(await page()).toBeNull();
    } finally { await db.exec("rollback"); }
  });
});

it("현재 최종 스키마에서도 새 읽기와 기존관리자v1호환·서비스권한을 확인한다", async () => {
  const db = await createFinalSchemaDatabase();
  try {
    await db.exec(`
      select set_config('request.jwt.claim.sub','${uuid(10)}',false);
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claims','{"role":"authenticated"}',false);
      insert into auth.users(id) values('${uuid(10)}');
      insert into admin_profiles(user_id,display_name,is_active) values('${uuid(10)}','가짜관리자',true);
      insert into students(id,display_name,status,created_by) values('${student}','가짜학생','active','${uuid(10)}');
    `);
    const read = async (fn: string) => (await db.query<{value: Page}>(`select public.${fn}($1) as value`, [student])).rows[0].value;
    expect(await read("get_admin_student_wrong_word_page_v2")).toEqual(await read("get_admin_student_wrong_word_page_v1"));
    const studentPage = await read("get_student_wrong_word_notebook_page_v1");
    expect(studentPage).toMatchObject({ items: [], totalCount: 0, summary: { wordCount: 0, wrongEventCount: 0, repeatedWordCount: 0 } });
    // Match Supabase's service role RLS behavior without broadening any table grants.
    await db.exec("alter role service_role bypassrls; set role service_role;");
    expect(await read("get_student_wrong_word_notebook_page_v1")).toEqual(studentPage);
    await expect(read("get_admin_student_wrong_word_page_v2")).rejects.toMatchObject({ code: "42501" });
  } finally { await db.close(); }
}, 120000);

