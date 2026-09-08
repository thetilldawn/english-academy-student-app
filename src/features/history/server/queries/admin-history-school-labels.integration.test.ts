import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
const patch = fs.readFileSync("supabase/migrations/20260907235924_admin_history_school_labels.sql", "utf8");
const original = fs.readFileSync("supabase/migrations/20260829153000_add_admin_history_read_model.sql", "utf8");
describe("history school labels projection", () => {
  it("실제 목록 anchor가 하나이며 기존 조회 열만 사용한다", () => {
    expect(original.split("case when p_payload = 'list' then jsonb_build_object(")).toHaveLength(2);
    expect(original).toContain("classified.school_name");
    expect(original).toContain("classified.grade_label");
    expect(patch).not.toMatch(/update public\.students|grant|security definer/i);
  });
  it("학교/학년의 삭제 마스킹과 함수 권한을 보존하고 중복 적용을 차단한다", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create schema private;
        create role authenticated;
        create table public.fixture(student_deleted boolean, school_name text, grade_label text);
        insert into public.fixture values(false,'검사 학교','고1'),(true,'숨김 학교','숨김 학년');
        create function private.admin_history_read_rows_v1(
          p_snapshot_at timestamptz,p_student_id uuid,p_assignment_id uuid,p_attempt_id uuid,p_payload text
        ) returns setof jsonb language sql stable security invoker set search_path = '' as $f$
          select case when p_payload = 'list' then jsonb_build_object(
            'name',case when classified.student_deleted then '삭제됨' else '가짜 학생' end
          ) else null end from public.fixture as classified;
        $f$;
        revoke all on function private.admin_history_read_rows_v1(timestamptz,uuid,uuid,uuid,text) from public;
        grant execute on function private.admin_history_read_rows_v1(timestamptz,uuid,uuid,uuid,text) to authenticated;
      `);
      const before = (await db.query("select proacl::text, prosecdef, proconfig::text,proowner from pg_proc where proname='admin_history_read_rows_v1'")).rows;
      await db.exec(patch);
      const result = await db.query<{ item: { schoolName: string | null; gradeLabel: string | null } }>("select private.admin_history_read_rows_v1(now(),null,null,null,'list') as item");
      expect(result.rows.map(r => r.item)).toEqual([
        { name: "가짜 학생", schoolName: "검사 학교", gradeLabel: "고1" },
        { name: "삭제됨", schoolName: null, gradeLabel: null },
      ]);
      expect((await db.query("select proacl::text, prosecdef, proconfig::text,proowner from pg_proc where proname='admin_history_read_rows_v1'")).rows).toEqual(before);
      await expect(db.exec(patch)).rejects.toThrow("admin_history_school_labels_contract_changed");
      await db.exec("rollback");
    } finally { await db.close(); }
  }, 20000);
});
