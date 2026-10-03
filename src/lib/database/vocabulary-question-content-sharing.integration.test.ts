import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema, type LibraryTemplate } from "@/features/wordbook-compositions/contracts/library";
import { compositionQuestionInputSchema, compositionStepSchema } from "@/features/wordbook-compositions/contracts/library-materialization";
const adminId="a2060000-0000-4000-8000-000000000001", project="wojxpruvbjzbhrpmsbuy";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
describe.sequential("50 frozen questions shared by 100 separate real assignments",()=>{
  let db:PGlite, template:LibraryTemplate, source:string;
  let command:{action:string;requestId:string;templateId:string;versionId:string;contentHash:string};
  const scalar=async<T>(sql:string,args:unknown[]=[]) => (await db.query<{value:T}>(sql,args)).rows[0].value;
  const owner=()=>db.exec("reset role");
  const admin=()=>db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service=()=>db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자'); select set_config('request.jwt.claims','{"ref":"${project}"}',false)`);
    source = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active) values('fake-m02-sharing-source','가짜 50행','fake',repeat('A',64),50,'ready',true) returning id value");
    const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'DAY 1','day1','day',1,1,50) returning id value", [source]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 자료','high','wordbook')", [source]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'sample'||n,'sample'||n,array['가짜 뜻 '||n],'가짜 뜻 '||n,upper(encode(extensions.digest('bounded:'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,50)n`, [source, unit]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select id,dataset_id,'book_meaning_en_to_ko','eligible',row_sha256,'fake',now() from public.vocab_entries where dataset_id=$1`, [source]);
    const rows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [source])).rows;
    const selected = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("catalog"), linksHash: sha("links"), referenceCatalogHash: sha("refs"), scopes: [{
      key: "bounded-50", name: "가짜 50행", sourceTitle: "가짜 자료", source: { datasetId: source, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: sha("file"), locator: "fake.json" },
      classification: { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: sha(`row:${r.source_row}`), selected } })),
    }] };
    const text = JSON.stringify(bundle), hash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [text]);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,$3,1,'fake-m02-sharing')", [project, sha(text), hash]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [text]); await admin();
    const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
    template = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(), metadata: { title: "가짜 50행", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null }, recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    command = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: template.versions[0]!.id, contentHash: template.versions[0]!.contentHash };
  }, 60000);
  afterAll(async()=>{await db?.close();});
  it("runs the approved import, materialization, public assignment and prepared start paths with 50 common bodies",async()=>{
    for(let n=0;n<5;n++){
      const state=compositionStepSchema.parse(await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value",[command]));
      if(state.stage==="prepared")break;
      if(n===4)throw Error("fake preparation did not finish");
    }
    const prep=compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value",[command]));
    expect(prep.entries).toHaveLength(50);
    const questions=prep.entries.map((e,i)=>{
      const choices=Array.from({length:4},(_,j)=>prep.entries[(i+j)%50]);
      return {vocabEntryId:e.id,direction:"english_to_korean",prompt:e.headword,choices:choices.map(c=>c.primaryMeaning),choiceVocabEntryIds:choices.map(c=>c.id),correctChoiceIndex:0};
    });
    await service();
    let done=false;
    for(let n=0;n<6;n++){
      const step=compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value",[command.versionId,command.contentHash,n===0?questions:null]));
      if(step.state==="ready"){done=true;break;}
    }
    expect(done).toBe(true);
    const units=[...new Set(prep.entries.map(e=>e.unitId))];
    await admin();
    const items=(await db.query<{vocab_entry_id:number;question_item_id:string;question_item_sha256:string}>("select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')",[prep.datasetId,units])).rows;
    expect(items).toHaveLength(50);
    const plan=items.map((q,index)=>({vocab_entry_id:q.vocab_entry_id,base_order_index:index+1,direction:"english_to_korean",
      composition_bank:{mode:"book_meaning_choice",version_id:command.versionId,content_sha256:command.contentHash,question_item_id:q.question_item_id,question_item_sha256:q.question_item_sha256}}));
    await owner();
    const students=(await db.query<{id:string}>(`insert into public.students(display_name,created_by,school_name,grade_label)
      select 'Fake sharing '||n,$1,'Fake school','고2' from generate_series(1,100)n returning id`,[adminId])).rows;
    await db.exec(`create temp table observed_assignment_writes(operation text, reference_only boolean);
      create function pg_temp.observe_assignment_write() returns trigger language plpgsql as $$begin
        insert into pg_temp.observed_assignment_writes values(tg_op,
          new.content_version_id is not null and new.prompt is null and new.choices is null);
        return new;
      end$$;
      create trigger observe_assignment_write after insert or update on public.assignment_questions
        for each row execute function pg_temp.observe_assignment_write();`);
    for(const student of students){
      await admin();
      const assignment=await scalar<string>("select public.create_assignment_with_delivery_v7('가짜 공유 검사',$1::uuid,$2::uuid[],50,100::smallint,300,80::smallint,false,null,'fixed',null,array[$3::uuid],'none',null,$4::jsonb) value",[prep.datasetId,units,student.id,plan]);
      await service();
      const prepared=await scalar<string>("select public.prepare_quiz_attempt_v1($1,$2,null) value",[student.id,assignment]);
      await scalar("select public.begin_prepared_quiz_v1($1,$2) value",[student.id,prepared]);
    }
    await owner();
    const result=await scalar<Record<string,number>>(`select jsonb_build_object(
      'assignments',(select count(*) from public.assignments),'bankLinks',(select count(*) from public.assignment_questions),
      'quizLinks',(select count(*) from public.quiz_questions),'sourceBodies',(select count(*) from private.vocabulary_composition_items),
      'commonBodies',(select count(*) from private.vocabulary_question_content_versions),
      'inlineBankBodies',(select count(*) from public.assignment_questions where content_version_id is null or prompt is not null or choices is not null),
      'inlineQuizBodies',(select count(*) from public.quiz_questions where content_version_id is null or prompt is not null or choices is not null),
      'duplicatedCommonBodies',(select count(*) from private.vocabulary_question_content_versions where payload ?| array['prompt','choices','composition_pronunciation_snapshot']),
      'preparedBodies',(select count(*) from private.quiz_attempt_preparations p cross join lateral jsonb_array_elements(p.plan->'questions') q where q ?| array['prompt','choices']),
      'minReuse',(select min(n) from(select count(*) n from public.assignment_questions group by content_version_id)x),
      'maxReuse',(select max(n) from(select count(*) n from public.assignment_questions group by content_version_id)x)) value`);
    expect(result).toEqual({assignments:100,bankLinks:5000,quizLinks:5000,sourceBodies:50,commonBodies:50,inlineBankBodies:0,inlineQuizBodies:0,duplicatedCommonBodies:0,preparedBodies:0,minReuse:100,maxReuse:100});
    const writes = await scalar(`select jsonb_build_object(
      'inserted',(select count(*) from pg_temp.observed_assignment_writes where operation='INSERT'),
      'updated',(select count(*) from pg_temp.observed_assignment_writes where operation='UPDATE'),
      'inlineAtInsert',(select count(*) from pg_temp.observed_assignment_writes where not reference_only),
      'frozenMeanings',(select count(*) from private.assignment_vocabulary_meaning_refs)) value`);
    expect(writes).toEqual({inserted:5000,updated:0,inlineAtInsert:0,frozenMeanings:5000});
    const mismatch=await scalar<number>(`select count(*)::int value from private.quiz_question_contents_v1 q
      join private.assignment_question_contents_v1 b on b.id=q.assignment_question_id
      where (q.prompt,q.choices,q.direction,q.correct_choice_index) is distinct from (b.prompt,b.choices,b.direction,b.correct_choice_index)`);
    expect(mismatch).toBe(0);
    const sizes=await scalar<{physicalRows:number;expandedRows:number;commonContent:number}>(`select jsonb_build_object(
      'physicalRows',(select sum(pg_column_size(to_jsonb(q))) from public.assignment_questions q),
      'expandedRows',(select sum(pg_column_size(to_jsonb(q)-'content_version_id')) from private.assignment_question_contents_v1 q),
      'commonContent',(select sum(pg_column_size(to_jsonb(v))) from private.vocabulary_question_content_versions v)) value`);
    expect(sizes.physicalRows+sizes.commonContent).toBeLessThan(sizes.expandedRows);
    process.stdout.write(JSON.stringify({scenario:"50 questions x 100 separate assignments; sequential, not concurrent capacity",...result,writes,rowRepresentationBytes:sizes})+"\n");
  },120000);
});
