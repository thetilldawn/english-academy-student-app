import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { schoolHandoutFixture, sealSchoolFixture } from "@/test-support/school-handout-fixtures";
import { reviewedHash, sha256Text } from "@/test-support/reviewed-exam-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

describe.sequential("불변 학교 원고의 검토된 사전·발음 연결", () => {
  let db: PGlite;
  const fixture = schoolHandoutFixture();
  const school = structuredClone(fixture);
  let dictionarySource: typeof school;
  let baseId: string, datasetId: string, entryIds: number[];
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{value:T}>(sql,args)).rows[0]!.value;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec("select set_config('request.jwt.claims','{\"ref\":\"wojxpruvbjzbhrpmsbuy\"}',false)");
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
    school.bundle.dataset.key = "fake-school-resources";
    school.bundle.dataset.hide_dataset_keys = [];
    school.bundle.questions = school.bundle.questions.filter(q => q.mode === "book_meaning_choice");
    school.bundle.entries.forEach(e => {
      Object.assign(e,{source_group:"fake-school-group"});
      e.pronunciation_donor = null; e.pronunciation_ko = null;
      e.entry_row_sha256 = reviewedHash(Object.fromEntries(Object.entries(e).filter(([k]) => k !== "entry_row_sha256")));
    });
    school.bundle.questions.forEach(q => {
      q.entry_row_sha256 = school.bundle.entries[q.source_row-1]!.entry_row_sha256;
      q.item_sha256 = reviewedHash(Object.fromEntries(Object.entries(q).filter(([k])=>k!=="item_sha256")));
    });
    sealSchoolFixture(school);
    dictionarySource=structuredClone(school);
    dictionarySource.bundle.dataset.key="fake-dictionary-source";
    dictionarySource.bundle.entries.forEach(e=>{
      Object.assign(e,{dictionary_id:"word:fake-"+e.source_row,occurrence_id:"occ:fake-"+e.source_row});
      e.entry_row_sha256=reviewedHash(Object.fromEntries(Object.entries(e).filter(([k])=>k!=="entry_row_sha256")));
    });
    dictionarySource.bundle.questions.forEach(q=>{
      q.entry_row_sha256=dictionarySource.bundle.entries[q.source_row-1]!.entry_row_sha256;
      q.item_sha256=reviewedHash(Object.fromEntries(Object.entries(q).filter(([k])=>k!=="item_sha256")));
    });
    sealSchoolFixture(dictionarySource);
    const sourceBundle=dictionarySource.bundle;
    await db.query(`insert into private.school_handout_import_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,source_file_sha256,scope_sha256,inputs_sha256,reviews_sha256,source_layout,entry_count,question_count,catalog_template_key,hide_dataset_keys)
      values('fake-resource-dictionary','wojxpruvbjzbhrpmsbuy',$1,$2,$3,$4,$5,$6,$7,'school_compact_v1',73,146,$8,'{}')`,
      [sourceBundle.dataset.key,sha256Text(JSON.stringify(sourceBundle)),sourceBundle.content_sha256,sourceBundle.source_file_sha256,reviewedHash(dictionarySource.source.scope),reviewedHash(dictionarySource.source.inputs),reviewedHash(sourceBundle.reviews),sourceBundle.dataset.catalog_template_key]);
    const dictionaryImported=await scalar<{release_id:string}>("select private.import_school_handout_reviewed_bundle_v1($1,$2) value",[JSON.stringify(sourceBundle),JSON.stringify(dictionarySource.source)]);
    await db.query("select private.activate_school_handout_reviewed_release_v1($1)",[dictionaryImported.release_id]);
    const b = school.bundle;
    await db.query(`insert into private.school_handout_import_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,source_file_sha256,scope_sha256,inputs_sha256,reviews_sha256,source_layout,entry_count,question_count,catalog_template_key,hide_dataset_keys)
      values('fake-resource-school','wojxpruvbjzbhrpmsbuy',$1,$2,$3,$4,$5,$6,$7,'school_compact_v1',73,146,$8,'{}')`,
      [b.dataset.key,sha256Text(JSON.stringify(b)),b.content_sha256,b.source_file_sha256,reviewedHash(school.source.scope),reviewedHash(school.source.inputs),reviewedHash(b.reviews),b.dataset.catalog_template_key]);
    const imported = await scalar<{release_id:string;dataset_id:string}>("select private.import_school_handout_reviewed_bundle_v1($1,$2) value",[JSON.stringify(b),JSON.stringify(school.source)]);
    baseId=imported.release_id; datasetId=imported.dataset_id;
    await db.query("select private.activate_school_handout_reviewed_release_v1($1)",[baseId]);
    entryIds=(await db.query<{id:number}>("select id from public.vocab_entries where dataset_id=$1 order by source_row",[datasetId])).rows.map(r=>r.id);
  }, 60_000);
  afterAll(async()=>{await db?.close();});
  function resources() {
    const b = {
      schema_version:"reviewed_entry_resources_v1",release_key:"fake-resources",approval_id:"fake-resources",
      dataset_key:school.bundle.dataset.key,base_content_sha256:school.bundle.content_sha256,
      inputs:[{path:"fake-reviewed-examples",sha256:"e".repeat(64)}],
      dictionary_scopes:[{dataset_key:"fake-dictionary-source",source_group:"fake-school-group"}],
      review:{reviewer:"fake-independent-review",evidence_sha256:"f".repeat(64)},
      entries:school.bundle.entries.map((e,index) => {
        const original=fixture.bundle.entries[index]!;
        return {
          source_row:e.source_row,entry_sha256:e.entry_row_sha256,headword:e.headword,
          selection:{meaning:e.korean_meaning,source_pos:e.source_pos,source_code:e.source_code},
          availability:{dictionary:true,pronunciation:!!original.pronunciation_donor,definition:true,example:index===0},
          dictionary:{status:"linked",kind:"reviewed_entry",dataset_key:"fake-dictionary-source",
            source_row:e.source_row,entry_sha256:dictionarySource.bundle.entries[index]!.entry_row_sha256,
            dictionary_id:"word:fake-"+e.source_row,occurrence_id:"occ:fake-"+e.source_row,sense_id:null,
            usage:"headword_reference_school_meaning",selection:{meaning:e.korean_meaning,source_pos:e.source_pos,source_code:e.source_code},
            review_reason:"가짜 동일 학교 원천의 실제 표제어 참조"},
          pronunciation:original.pronunciation_donor ? {
            status:"linked",donor:structuredClone(original.pronunciation_donor),display_ko:original.pronunciation_ko,
            lexical_pos:original.lexical_pos,classification_note:null,grammatical_form:null
          } : {status:"unavailable",donor:null,reason:"가짜 원천에 기존 음원이 없다."},
          definition:{status:"linked",kind:"school_definition",value:e.school_english_definition},
          example:index===0 ? {status:"linked",kind:"supplied_example",value:"A fake complete example.",source:{
            path:"fake-reviewed-examples",sha256:"e".repeat(64),locator:"fake-1",value_sha256:sha256Text("A fake complete example.")
          }} : {status:"unavailable",value:null,reason:"가짜 예문 미제공"}
        };
      }),content_sha256:""
    };
    return b;
  }
  type Bundle=ReturnType<typeof resources>;
  function seal(b:Bundle){b.content_sha256=reviewedHash(Object.fromEntries(Object.entries(b).filter(([k])=>k!=="content_sha256")));return JSON.stringify(b);}
  async function approve(b:Bundle,project="wojxpruvbjzbhrpmsbuy"){
    const text=seal(b);
    await db.query(`insert into private.reviewed_entry_resource_approvals_v1
      (approval_id,target_project_ref,dataset_key,base_content_sha256,bundle_file_sha256,content_sha256,review_sha256,entry_count,expected_link_counts)
      values($1,$2,$3,$4,$5,$6,$7,$8,'{"dictionary":73,"pronunciation":4,"definition":73,"example":1}')`,[b.approval_id,project,b.dataset_key,b.base_content_sha256,sha256Text(text),b.content_sha256,reviewedHash(b.review),b.entries.length]);
    return text;
  }
  const importResources=(text:string)=>scalar<{release_id:string;reused:boolean;entries:number}>("select private.import_reviewed_entry_resources_v1($1) value",[text]);
  async function coreFingerprint(){
    return scalar("select md5(jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by e.id) from public.vocab_entries e),'questions',(select jsonb_agg(to_jsonb(q) order by q.item_id) from private.reviewed_exam_items q),'reviewed',(select jsonb_agg(to_jsonb(e) order by e.source_row) from private.reviewed_exam_entries e),'students',(select jsonb_agg(to_jsonb(s) order by s.id) from public.students s),'assignments',(select jsonb_agg(to_jsonb(a) order by a.id) from public.assignments a))::text) value");
  }
  it("활성 연결을 기존 발음 조회가 사용하며 같은 원고와 문항을 보존하고 재실행한다",async()=>{
    await db.exec("begin");
    try{
      const before=await coreFingerprint();
      const text=await approve(resources());
      const result=await importResources(text);
      expect(result).toMatchObject({reused:false,entries:73});
      expect(await importResources(text)).toMatchObject({reused:true,release_id:result.release_id});
      const bindings=(await db.query<{identity_id:string;release_id:string}>("select * from public.list_active_vocab_pronunciation_bindings_v3($1)",[entryIds])).rows;
      expect(bindings).toHaveLength(4);
      expect(bindings.every(b=>b.release_id==="reviewed-resources:"+result.release_id)).toBe(true);
      expect(bindings.map(b=>b.identity_id).sort()).toEqual(fixture.bundle.entries.slice(0,4).map(e=>e.pronunciation_donor!.identity_id).sort());
      const linked=(await db.query<{resources:Bundle["entries"][number]}>("select * from public.list_reviewed_entry_resources_v1($1)",[entryIds])).rows;
      expect(linked).toHaveLength(73);
      expect(linked[0]!.resources.selection.meaning).toBe(school.bundle.entries[0]!.korean_meaning);
      expect(linked[0]!.resources.example.value).toBe("A fake complete example.");
      expect(linked[0]!.resources.dictionary.dictionary_id).toBe("word:fake-1");
      expect(await coreFingerprint()).toBe(before);
      await expect(db.query("update private.reviewed_entry_resources_v1 set payload='{}'")).rejects.toThrow("reviewed_resources_immutable");
    } finally{await db.exec("rollback");}
  });
  it.each(["project","unapproved","file","hash","row","meaning","source-pos","source-code","duplicate-row","availability","dictionary","pos","headword","variant","audio","display","definition","example-hash","example-input","blank-example","null-status","omitted-definition","omitted-pronunciation","omitted-dictionary","dictionary-scope","dictionary-selection","dictionary-sense"])("%s 오류는 쓰기 전에 거절한다",async kind=>{
    const b=resources();
    const e=b.entries[0]!;
    // Deliberately malformed JSON exercises the database boundary.
    const raw=e as unknown as Record<string, Record<string, unknown>>;
    if(kind==="row") e.entry_sha256="0".repeat(64);
    if(kind==="meaning") e.selection.meaning="다른 뜻";
    if(kind==="source-pos") e.selection.source_pos="동";
    if(kind==="source-code") e.selection.source_code="other";
    if(kind==="duplicate-row") b.entries[1]=structuredClone(e);
    if(kind==="availability") e.availability.pronunciation=false;
    if(kind==="dictionary"){e.availability.dictionary=true; Object.assign(e.dictionary,{status:"linked",kind:"exam_occurrence",dataset_key:"fake",source_row:1,entry_sha256:"0".repeat(64),dictionary_id:"fake-id",occurrence_id:"fake-occ"});}
    if(kind==="pos") e.pronunciation.lexical_pos="verb";
    if(kind==="headword") e.pronunciation.donor!.identity_headword="wrong";
    if(kind==="variant") e.pronunciation.donor!.variant_id="wrong";
    if(kind==="audio") e.pronunciation.donor!.audio_key="https://invalid.test/audio.mp3";
    if(kind==="display") e.pronunciation.display_ko="틀림";
    if(kind==="definition") e.definition.value="not the school definition";
    if(kind==="example-hash") e.example.source!.value_sha256="0".repeat(64);
    if(kind==="example-input") e.example.source!.path="wrong";
    if(kind==="blank-example") {e.example.value="A ___ example.";e.example.source!.value_sha256=sha256Text(e.example.value);}
    if(kind==="null-status") raw.dictionary!.status=null;
    if(kind==="omitted-definition"){Object.assign(e.definition,{status:"unavailable",value:null,reason:"없다고 주장"});e.availability.definition=false;}
    if(kind==="omitted-pronunciation"){Object.assign(e.pronunciation,{status:"unavailable",donor:null,reason:"없다고 주장"});e.availability.pronunciation=false;}
    if(kind==="omitted-dictionary"){Object.assign(e.dictionary,{status:"unavailable",dictionary_id:null,occurrence_id:null,reason:"없다고 주장"});e.availability.dictionary=false;}
    if(kind==="dictionary-scope") b.dictionary_scopes[0]!.source_group="wrong";
    if(kind==="dictionary-selection") e.dictionary.selection.meaning="다른 학교 뜻";
    if(kind==="dictionary-sense") Object.assign(e.dictionary,{sense_id:"made-up-sense"});
    await db.exec("begin");
    try {
      const text=kind==="unapproved"?seal(b):await approve(b,kind==="project"?"wrong":undefined);
      const actual=kind==="file"?text+" ":kind==="hash"?text.replace(b.content_sha256,"0".repeat(64)):text;
      await expect(importResources(actual)).rejects.toThrow();
    } finally{await db.exec("rollback");}
  });
  it.each(["anon","authenticated","service_role"])("%s는 승인·등록·원고에 직접 접근할 수 없다",async role=>{
    await db.exec("set role "+role);
    try{
      await expect(db.query("select * from private.reviewed_entry_resources_v1")).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.import_reviewed_entry_resources_v1('{}')")).rejects.toThrow(/permission denied/);
      if(role!=="service_role") await expect(db.query("select * from public.list_reviewed_entry_resources_v1('{}')")).rejects.toThrow(/permission denied/);
    }finally{await db.exec("reset role");}
  });
  it("서비스 조회의 수량·빈값 경계를 기존대로 제한한다",async()=>{
    await db.exec("set role service_role");
    try {
      expect((await db.query("select * from public.list_reviewed_entry_resources_v1('{}')")).rows).toEqual([]);
      await expect(db.query("select * from public.list_reviewed_entry_resources_v1(null)")).rejects.toThrow("reviewed_resources_input_invalid");
      await expect(db.query("select * from public.list_active_vocab_pronunciation_bindings_v3($1)",[Array.from({length:401},(_,i)=>i+1)])).rejects.toThrow();
    } finally{await db.exec("reset role");}
  });
  it("연결판 비활성화는 원문 변경 없이 발음 연결만 해제한다",async()=>{
    await db.exec("begin");
    try{
      const before=await coreFingerprint();
      const result=await importResources(await approve(resources()));
      await db.query("update private.reviewed_entry_resource_releases_v1 set status='retired' where release_id=$1",[result.release_id]);
      expect((await db.query("select * from public.list_active_vocab_pronunciation_bindings_v3($1)",[entryIds])).rows).toEqual([]);
      expect(await coreFingerprint()).toBe(before);
    }finally{await db.exec("rollback");}
  });
});
