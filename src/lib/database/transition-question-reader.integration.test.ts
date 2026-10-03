import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const name = "read_m10_transition_question_contents_v1";
const id = "b4040000-0000-4000-8000-000000000001";
describe.sequential("기존 운영 구조에 전환 조회만 선설치", () => {
  let db: PGlite;
  let previous: unknown;
  async function snapshot(database: PGlite) {
    return (await database.query(`select
      (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.proname <> '${name}') functions,
      (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and c.relkind='r') tables`)).rows;
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, migration) => {
      if (migration === "20261004001500_add_transition_question_reader.sql") previous = await snapshot(database);
    } });
  }, 120_000);
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });
  async function call(context: string | null) {
    return db.query(`select public.${name}($1,$2,$3,$4) value`, [context, id, id, [id]]);
  }
  async function fails(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint rejected_call");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to rejected_call; release rejected_call"); }
  }
  it("M02 미설치에서도 설치되며 기존 함수·표 메타를 바꾸지 않는다", async () => {
    expect(await snapshot(db)).toEqual(previous);
    const rows = (await db.query(`select to_regprocedure('public.read_question_contents_v1(text,uuid,uuid,uuid[])') canonical,
      p.prosecdef,p.proconfig from pg_proc p where p.oid='public.${name}(text,uuid,uuid,uuid[])'::regprocedure`)).rows;
    expect(rows).toEqual([{ canonical: null, prosecdef: false, proconfig: ['search_path=""'] }]);
    await db.exec("set local role service_role");
    await fails(() => call("student_assignment"), "does not exist");
  });
  it.each(["anon", "authenticated"])("%s는 위임 함수를 실행할 수 없다", async role => {
    await db.exec(`set local role ${role}`);
    await fails(() => call("student_assignment"), "permission denied");
  });
  it("허용 문맥 외에는 목표 함수 조회에 도달하지 않는다", async () => {
    await db.exec("set local role service_role");
    for (const context of [null, "admin_attempt", "student_attempt", "student_assignment'; select 1; --"])
      await fails(() => call(context), "transition_content_context_invalid");
  });
  it("위임 자체는 서비스 역할과 네 인수를 그대로 전달한다", async () => {
    // This stub proves forwarding only. Canonical authorization is checked by the full transition suite.
    await db.exec(`create function public.read_question_contents_v1(text,uuid,uuid,uuid[]) returns jsonb
      language sql security invoker set search_path='' as $$
      select jsonb_build_object('role',current_user,'context',$1,'actor',$2,'scope',$3,'ids',$4) $$;
      revoke all on function public.read_question_contents_v1(text,uuid,uuid,uuid[]) from public;
      grant execute on function public.read_question_contents_v1(text,uuid,uuid,uuid[]) to service_role;
      set local role service_role`);
    for (const context of ["student_assignment", "student_preparation"])
      expect((await call(context)).rows).toEqual([{ value: { role: "service_role", context, actor: id, scope: id, ids: [id] } }]);
  });
});
