import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = fs.readFileSync(path.resolve("supabase/migrations/20260905051013_add_student_assignment_study.sql"), "utf8");
const example = "She collected the letters.";
const hash = createHash("sha256").update(example).digest("hex");
describe.sequential("배정 단어장 SQL 권한·학습 범위", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema word_index; create schema extensions;
      create extension pgcrypto with schema extensions;
      create table students(id uuid primary key,status text,deleted_at timestamptz);
      create table assignments(id uuid primary key,title text,quiz_content_mode text,status text,deleted_at timestamptz);
      create table assignment_students(assignment_id uuid,student_id uuid,cancelled_at timestamptz,assigned_at timestamptz);
      create table vocab_entries(id bigint primary key,dataset_id uuid,source_row int,headword text,primary_meaning text,pronunciation_ko text);
      create table assignment_questions(id uuid primary key,assignment_id uuid,vocab_entry_id bigint,headword_snapshot text,primary_meaning_snapshot text,eligibility_quiz_mode text,prompt text,canonical_question_release_id_snapshot uuid,canonical_question_item_id_snapshot text,canonical_question_item_sha256_snapshot text,choices jsonb,correct_choice_index int,base_order_index int,provenance_status text default 'verified_v2');
      create table assignment_question_exam_use_snapshot(assignment_question_id uuid,provenance_status text,headword_snapshot text,primary_meaning_snapshot text,display_pronunciation_ko_snapshot text,pronunciation_snapshot jsonb,dictionary_id text,release_id uuid);
      create table word_index.app_canonical_question_preview_release(release_id uuid primary key,exam_use_release_id uuid);
      create table word_index.app_canonical_question_preview_item(release_id uuid,vocab_entry_id bigint,quiz_mode text,question_item_id text,question_item_sha256 text,source_example_content_hash text,primary key(release_id,vocab_entry_id,quiz_mode));
      insert into students values('${id(1)}','active',null),('${id(2)}','active',null);
      insert into vocab_entries values(1,'${id(50)}',20,'collect','변경된 뜻','컬렉트'),(2,'${id(50)}',10,'letter','편지','레터'),(3,'${id(50)}',30,'unassigned','미배정',null);
      insert into word_index.app_canonical_question_preview_release values('${id(60)}','${id(61)}');
    `);
    await db.exec(migration);
    for (const [n, mode] of [[10, "book_meaning_choice"], [20, "canonical_definition_to_headword"], [30, "canonical_example_to_headword"]] as const) {
      await db.query("insert into assignments values($1,'배정 시험',$2,'active',null)", [id(n), mode]);
      await db.query("insert into assignment_students values($1,$2,null,now()-interval '1 day')", [id(n),id(1)]);
      for (const entry of [1,2]) {
        await db.query("insert into assignment_questions values($1,$2,$3,$4,'고정된 뜻',$5,$6,$7,$8,'item-hash','[\"secret-choice\"]',3,$9,'verified_v2')", [id(n+entry+100), id(n), entry, entry === 1 ? "collect" : "letter", mode, mode.includes("example") ? "She _____ the letters." : "to gather things", id(60), `item-${entry}`, entry]);
        if (mode.includes("canonical")) await db.query("insert into word_index.app_canonical_question_preview_item values($1,$2,$3,$4,'item-hash',$5)", [id(60),entry,mode,`item-${entry}`,hash]);
      }
    }
    await db.query("insert into private.assignment_study_examples_v1(release_id,vocab_entry_id,question_item_id,question_item_sha256,source_example_sha256,example_en) values($1,1,'item-1','item-hash',$2,$3),($1,2,'item-2','item-hash',$2,$3)", [id(60),hash,example]);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  const read = async (assignment: number, student = 1) => (await db.query<{result: { words: Array<Record<string, unknown>> } | null}>("select public.get_student_assignment_study_v1($1,$2) result",[id(student),id(assignment)])).rows[0]!.result;
  it("service_role만 조회하고 두 브라우저 역할과 원문 표 직접 읽기를 차단한다", async () => {
    for (const role of ["anon","authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(read(10)).rejects.toThrow(/permission denied/u);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await read(10))?.words).toHaveLength(2);
    await expect(db.query("select * from private.assignment_study_examples_v1")).rejects.toThrow(/permission denied/u);
    await db.exec("reset role");
  });
  it("미배정 단어·문항 순서·선택지·정답 위치를 내보내지 않고 고정된 뜻을 쓴다", async () => {
    const result = await read(10);
    expect(result?.words.map(x=>x.entryId)).toEqual([2,1]);
    expect(result?.words.every(x=>x.meaning === "고정된 뜻")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/unassigned|"choices"|"base_order_index"|correct_choice|변경된 뜻/u);
  });
  it("영영풀이와 원형이 아닌 완성 예문을 정확하게 반환한다", async () => {
    expect((await read(20))?.words[0]).toMatchObject({ definition: "to gather things", example: null });
    expect((await read(30))?.words[0]).toMatchObject({ example, definition: null });
  });
  it("검증되지 않은 legacy 스냅샷은 기존 결과 화면처럼 현재 대상 단어 뜻을 쓴다", async () => {
    await db.exec("begin; update assignment_questions set provenance_status='legacy_backfill'");
    expect((await read(10))?.words[1]?.meaning).toBe("변경된 뜻");
    await db.exec("rollback");
  });
  it("다른 학생·없는 배정·취소·삭제·차단 학생·초안을 동일하게 숨긴다", async () => {
    expect(await read(10,2)).toBeNull(); expect(await read(99)).toBeNull();
    for (const sql of ["update assignment_students set cancelled_at=now()", "update assignments set deleted_at=now()", "update assignments set status='draft'", "update students set status='blocked'"]) {
      await db.exec(`begin; ${sql}`); expect(await read(10)).toBeNull(); await db.exec("rollback");
    }
  });
  it("문항 해시가 다른 원문을 끼워 넣지 않는다", async () => {
    await db.exec("begin; update assignment_questions set canonical_question_item_sha256_snapshot='other'");
    expect((await read(30))?.words.every(x=>x.example === null)).toBe(true);
    await db.exec("rollback");
  });
  it("원문 SHA가 다르거나 빈칸이 남아 있으면 저장을 거부한다", async () => {
    await expect(db.query("update private.assignment_study_examples_v1 set example_en='She _____ them.'")).rejects.toThrow(/check constraint/u);
    await expect(db.query("update private.assignment_study_examples_v1 set example_en='Changed sentence.'")).rejects.toThrow(/check constraint/u);
  });
  it("조회 반복으로 배정·문항·수신 연결을 바꾸지 않는다", async () => {
    const snapshot = () => db.query("select (select jsonb_agg(a) from assignments a) a,(select jsonb_agg(q) from assignment_questions q) q,(select jsonb_agg(s) from assignment_students s) s");
    const before = await snapshot();
    for (const n of [10,20,30,10]) await read(n);
    expect((await snapshot()).rows).toEqual(before.rows);
  });
});
