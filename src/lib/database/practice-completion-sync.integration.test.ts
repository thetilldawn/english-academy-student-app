import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const migration = readFileSync("supabase/migrations/20261003235900_sync_practice_completion_confirmation.sql", "utf8")
  .replace(/\r\n/g, "\n").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
const signature = "private.word_practice_read_v1(private.student_word_practice_runs)";
const finalBodyHash = "fa14f11cc322f2da9e300997b4cb20fdb687e051630a5453cf04192b0f91a7fb";

describe.sequential("M11 누락 환경을 후속 수정 보존으로 동기화", () => {
  let db: PGlite;
  let finalDefinition: string;
  let missingDefinition: string;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    finalDefinition = (await details()).definition;
    // The old M11 predecessor, with exactly the later M02 and M03 changes seen in Preview.
    const old = readFileSync("supabase/migrations/20260930034455_add_student_word_practice.sql", "utf8").replace(/\r\n/g, "\n");
    const start = old.indexOf("create function private.word_practice_read_v1(");
    if (start < 0) throw new Error("reader fixture not found");
    missingDefinition = old.slice(start, old.indexOf("\n$$;", start) + 4)
      .replace("create function", "create or replace function")
      .replace("from private.student_word_practice_questions q where", "from private.practice_question_contents_v2 q where")
      .replace("end) order by q.ordinal),'[]')",
        "end) || case when q.body ? 'quizContentMode' then jsonb_build_object('quizContentMode',q.body->>'quizContentMode') else '{}'::jsonb end order by q.ordinal),'[]')");
  }, 120000);
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });
  afterAll(async () => { await db?.close(); });

  async function details() {
    return (await db.query<{ definition: string; body_hash: string; meta: unknown; xmin: string }>(`
      select pg_get_functiondef(oid) definition,
        encode(extensions.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex') body_hash,
        to_jsonb(p)-'prosrc' meta, xmin::text xmin
      from pg_proc p where oid=$1::regprocedure`, [signature])).rows[0];
  }
  async function read(status = "in_progress") {
    return (await db.query<{ value: { completionConfirmed?: boolean; attempt: { status: string; phase: string } } }>(`
      select private.word_practice_read_v1(jsonb_populate_record(null::private.student_word_practice_runs,
        jsonb_build_object('id','af110000-0000-4000-8000-000000000001','status',$1::text,
        'deadline_at',(clock_timestamp()-interval '1 second')::text,
        'current_starts_at',(clock_timestamp()-interval '2 seconds')::text,
        'settings',jsonb_build_object('timingMode','total','timeLimitSeconds',240)))) value`, [status])).rows[0].value;
  }

  it("정상 시간순 적용과 재적용은 함수 행조차 바꾸지 않는다", async () => {
    const before = await details();
    expect(before.body_hash).toBe(finalBodyHash);
    await db.exec(migration);
    expect(await details()).toEqual(before);
  });

  it("실제 검토 누락 본문을 재현하고 M02/M03과 함수 메타를 보존한다", async () => {
    await db.exec(missingDefinition);
    const before = await details();
    expect(before.body_hash).toBe("08cee42443814f3ad5a6999f1f939ef2cc66060a9d1f476063b0cd7bb15faf77");
    expect(await read()).toMatchObject({ attempt: { status: "expired", phase: "completed" } });
    await db.exec(migration);
    const after = await details();
    expect(after.meta).toEqual(before.meta);
    expect(after.definition).toBe(finalDefinition);
    expect(after.body_hash).toBe(finalBodyHash);
    expect(after.definition).toContain("private.practice_question_contents_v2 q");
    expect(after.definition).toContain("case when q.body ? 'quizContentMode'");
    expect(await read()).toMatchObject({ completionConfirmed: false, attempt: { status: "in_progress", phase: "initial" } });
    for (const status of ["completed", "expired"]) {
      expect(await read(status)).toMatchObject({ completionConfirmed: true, attempt: { status, phase: "completed" } });
    }
  });

  it("예상 밖 본문은 전체 취소하고 자동 덮어쓰지 않는다", async () => {
    await db.exec(finalDefinition.replace("declare at_time", "-- unexpected external change\ndeclare at_time"));
    const before = await details();
    await db.exec("savepoint rejected");
    await expect(db.exec(migration)).rejects.toThrow("m11_sync_unexpected_reader");
    await db.exec("rollback to rejected; release rejected");
    expect(await details()).toEqual(before);
  });

  it("기존 직접 실행 금지와 다른 함수·학생 표를 보존한다", async () => {
    await db.exec(missingDefinition);
    const snapshot = async () => ({
      functions: (await db.query("select oid,to_jsonb(p) value from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>$1::regprocedure order by oid", [signature])).rows,
      rows: (await db.query("select 'runs' kind,to_jsonb(r) value from private.student_word_practice_runs r union all select 'questions',to_jsonb(q) from private.student_word_practice_questions q union all select 'students',to_jsonb(s) from public.students s")).rows,
    });
    const before = await snapshot();
    await db.exec(migration);
    expect(await snapshot()).toEqual(before);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege(r,$1::regprocedure,'execute') allowed from unnest(array['anon','authenticated','service_role']) r", [signature])).rows.map(r => r.allowed)).toEqual([false, false, false]);
  });
});
