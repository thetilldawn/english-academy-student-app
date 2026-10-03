import fs from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

let db: Awaited<ReturnType<typeof createFinalSchemaDatabase>>;
const migration = "supabase/migrations/20261004000000_bound_template_search_document_reads.sql";
const original = fs.readFileSync("supabase/migrations/20260921040000_query_vocabulary_library_on_demand.sql", "utf8")
  .replace(/\r\n/g, "\n").match(/create function private\.vocabulary_library_template_search_v1[\s\S]*?\$\$;/)![0]
  .replace("create function", "create or replace function");
const sql = () => fs.readFileSync(migration, "utf8").replace(/\r\n/g, "\n").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
const id = (n: number) => `a6130000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => n.toString(16).padStart(64, "0");
const signature = "private.vocabulary_library_template_search_v1(private.vocabulary_library_templates)";
beforeAll(async () => { db = await createFinalSchemaDatabase(); }, 120_000);
afterAll(async () => { await db?.close(); });

it("원형 검색의 포함 범위·최신판·문자열과 모든 함수 메타/자료를 보존하고 재적용한다", async () => {
  await db.exec("begin");
  try {
    await db.exec(original);
    await db.exec(`insert into auth.users(id)values('${id(1)}');
      insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status)
      values('${id(2)}','app13-fake','가짜 검색 자료','fake',repeat('A',64),7,'ready');
      insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values('${id(3)}','${id(2)}','가짜','fake','day',1,1,7);`);
    const kinds = ["mock", "csat", "textbook", "wordbook", "school", "unknown", "mock"];
    for (let n = 0; n < kinds.length; n++) {
      const classification = { kind: kinds[n], sourceGrade: `g${7 + n % 6}`, exam: { executionYear: 2020 + n, examMonth: 9,
        academicYear: 2021 + n, typeLabel: `유형${n}` }, day: n + 1, lesson: n + 2 };
      await db.query(`insert into private.vocabulary_library_scopes(id,scope_key,version,dataset_id,unit_id,source_kind,source_version,source_file_sha256,payload,review_references,import_file_sha256)
        values($1,$2,$3,$4,$5,'legacy_vocab',$3,$3,$6,'{}',$3)`,
      [id(10 + n), `fake-${n}`, key(n + 1), id(2), id(3), JSON.stringify({ classification })]);
      // Membership is defined by the fixed included key, not the scope row's current state.
      await db.query(`insert into private.vocabulary_library_scope_rows(scope_id,occurrence_key,source_row,row_sha256,state,resources)
        values($1,$2,1,$2,'excluded','{}')`, [id(10 + n), key(n + 1)]);
    }
    const metadata = { title: "ABC_% 가짜 제목", tags: ["가짜 태그"], school: "가짜 학교", targetGrade: "g12", schoolYear: 2026, semester: 2, assessment: "문장", purpose: "자유" };
    const scopes = kinds.map((_, n) => ({ id: id(10 + n), version: key(n + 1) }));
    for (let n = 0; n < 5; n++) {
      await db.query("insert into private.vocabulary_library_templates(id,metadata,created_by,template_kind) values($1,$2,$3,$4)", [id(30 + n), JSON.stringify(metadata), id(1), n % 2 ? null : "mock_exam"]);
      if (n === 4) continue; // No version also keeps metadata searchable.
      const recipe = { scopes: n === 3 ? [] : [...scopes, scopes[0], { id: id(10), version: key(99) }] };
      const fixed = { includedKeys: n === 1 ? [] : kinds.slice(0, 6).map((_, i) => key(i + 1)), unusedBody: "가짜 압축 본문".repeat(150_000) };
      await db.query(`insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,created_by)
        values($1,1,$2,$3,$4,$5)`, [id(30 + n), key(1), JSON.stringify(recipe), JSON.stringify(fixed), id(1)]);
      if (n === 2) await db.query(`insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,created_by)
        values($1,2,$2,$3,'{"includedKeys":[]}',$4)`, [id(30 + n), key(2), JSON.stringify(recipe), id(1)]);
    }
    const search = () => db.query<{ id: string; value: string }>("select id,private.vocabulary_library_template_search_v1(t) value from private.vocabulary_library_templates t order by id");
    const beforeSearch = await search();
    expect(beforeSearch.rows[0]!.value).toContain("abc_% 가짜 제목");
    expect(beforeSearch.rows[0]!.value).toContain("2020년 9월");
    expect(beforeSearch.rows[0]!.value).toContain("2022학년도");
    expect(beforeSearch.rows[0]!.value).toContain("분류 확인");
    expect(beforeSearch.rows[0]!.value).not.toContain("2026년");
    for (const row of beforeSearch.rows.slice(1)) expect(row.value).not.toContain("유형");
    const meta = () => db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid=$1::regprocedure", [signature]);
    const others = () => db.query("select to_jsonb(p) value from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>$1::regprocedure order by oid", [signature]);
    const rows = async () => {
      const tables = await db.query<{ name: string }>("select format('%I.%I',n.nspname,c.relname) name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1");
      return Promise.all(tables.rows.map(async ({ name }) => [name, (await db.query(`select count(*),md5(coalesce(string_agg(h,chr(10) order by h),'')) hash from (select md5(to_jsonb(t)::text) h from ${name} t)s`)).rows]));
    };
    const before = { meta: await meta(), others: await others(), rows: await rows() };
    await db.exec(sql());
    expect(await search()).toEqual(beforeSearch);
    expect(await meta()).toEqual(before.meta);
    expect(await others()).toEqual(before.others);
    expect(await rows()).toEqual(before.rows);
    await db.exec("drop table app13_search_meta");
    await db.exec(sql());
    expect(await search()).toEqual(beforeSearch);
    expect(await meta()).toEqual(before.meta);
  } finally { await db.exec("rollback"); }
}, 60_000);

it("예상하지 않은 기존 본문에는 덮어쓰지 않고 중단한다", async () => {
  await db.exec("begin");
  try {
    await db.exec(original.replace("select lower(concat_ws", "select upper(concat_ws"));
    await expect(db.exec(sql())).rejects.toThrow("unexpected_template_search_body");
  } finally { await db.exec("rollback"); }
});
