import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { schoolHandoutFixture, sealSchoolFixture } from "@/test-support/school-handout-fixtures";
import { reviewedHash, sha256Text } from "@/test-support/reviewed-exam-fixtures";

type Obj=Record<string,unknown>;
const without=(o:Obj,...keys:string[])=>Object.fromEntries(Object.entries(o).filter(([k])=>!keys.includes(k)));
const seal=<T extends Obj>(o:T)=>Object.assign(o,{content_sha256:reviewedHash(without(o,"content_sha256"))});
const project="wojxpruvbjzbhrpmsbuy";
describe.sequential("검토한 누락 발음과 앞 공백 처리본의 제한된 교체",()=>{
  let db:PGlite, baseId:string, datasetId:string, previousId:string;
  let old:ReturnType<typeof resources>;
  const school=schoolHandoutFixture();
  const scalar=async<T>(sql:string,args:unknown[]=[]) => (await db.query<{value:T}>(sql,args)).rows[0]!.value;
  function identity(index:number, tag:string, pos="noun"){
    const request=reviewedHash(tag);
    const i={...school.old.voice.identities[0]!, headword:school.bundle.entries[index]!.headword,
      headword_normalized:school.bundle.entries[index]!.headword.toLowerCase(),lexical_pos:pos,
      identity_id:"pron:v3:"+reviewedHash("identity-"+tag),pronunciation_variant_id:"synthetic:"+request,
      audio_provider:"google_cloud_text_to_speech",official_audio_url:null,sound_audio:null,mw_notation:null,
      storage_bucket:"vocab-pronunciation-audio",storage_object_key:"pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/"+request+".mp3",
      audio_sha256:reviewedHash("audio-"+tag),byte_count:1500,profile_id:"profile:1a77d56d47e26013",
      request_sha256:request,model:"chirp3-hd",voice:"en-US-Chirp3-HD-Despina",identity_content_sha256:""};
    i.identity_content_sha256=reviewedHash(without(i,"identity_content_sha256")).toUpperCase();return i;
  }
  const oldIdentity=identity(0,"old","other");
  const audioKey=(i:ReturnType<typeof identity>)=>"/storage/v1/object/public/"+i.storage_bucket+"/"+i.storage_object_key;
  function resources(){return {schema_version:"reviewed_entry_resources_v1",release_key:"fake-audio-old",approval_id:"fake-audio-old",
    dataset_key:school.bundle.dataset.key,base_content_sha256:school.bundle.content_sha256,inputs:[{path:"fake-audio-review",sha256:"a".repeat(64)}],dictionary_scopes:[],
    review:{reviewer:"fake-independent",evidence_sha256:"a".repeat(64)},content_sha256:"",
    entries:school.bundle.entries.map(e=>({source_row:e.source_row,entry_sha256:e.entry_row_sha256,headword:e.headword,
      selection:{meaning:e.korean_meaning,source_pos:e.source_pos,source_code:e.source_code},
      availability:{dictionary:false,pronunciation:false,definition:true,example:false},
      dictionary:{status:"unavailable",dictionary_id:null,occurrence_id:null,reason:"가짜 자료에 없음"},
      pronunciation:{status:"unavailable",donor:null,reason:"가짜 음원 없음"} as Obj,
      definition:{status:"linked",kind:"school_definition",value:e.school_english_definition},
      example:{status:"unavailable",value:null,reason:"미제공"}}))};}
  async function approveResources(b:ReturnType<typeof resources>,ref=project){
    seal(b);const text=JSON.stringify(b);
    await db.query(`insert into private.reviewed_entry_resource_approvals_v1
      (approval_id,target_project_ref,dataset_key,base_content_sha256,bundle_file_sha256,content_sha256,review_sha256,entry_count,expected_link_counts)
      values($1,$2,$3,$4,$5,$6,$7,73,$8)`,[b.approval_id,ref,b.dataset_key,b.base_content_sha256,sha256Text(text),b.content_sha256,reviewedHash(b.review),
        JSON.stringify({dictionary:0,pronunciation:b.entries.filter(e=>e.availability.pronunciation).length,definition:73,example:0})]);return text;
  }
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({ref:project})]);
    const prior=await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status) values($1,'가짜자료','fake',$2,278,'ready') returning id value",[school.old.voice.dataset_key,school.old.voice.dataset_source_sha256]);
    await db.query(`insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,metadata)
      values($1,'가짜자료','high','textbook','g11','{"school":"검사고","semester":2,"schoolYear":2026}')`,[prior]);
    school.bundle.dataset.key="fake-audio-school";school.bundle.dataset.hide_dataset_keys=[];
    school.bundle.questions=school.bundle.questions.filter(q=>q.mode==="book_meaning_choice");
    school.bundle.entries.forEach(e=>{e.pronunciation_donor=null;e.pronunciation_ko=null;e.entry_row_sha256=reviewedHash(without(e,"entry_row_sha256"));});
    school.bundle.questions.forEach(q=>{q.entry_row_sha256=school.bundle.entries[q.source_row-1]!.entry_row_sha256;q.item_sha256=reviewedHash(without(q,"item_sha256"));});
    sealSchoolFixture(school);const b=school.bundle;
    await db.query(`insert into private.school_handout_import_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,source_file_sha256,scope_sha256,inputs_sha256,reviews_sha256,source_layout,entry_count,question_count,catalog_template_key,hide_dataset_keys)
      values('fake-audio-school',$1,$2,$3,$4,$5,$6,$7,$8,'school_compact_v1',73,146,$9,'{}')`,
      [project,b.dataset.key,sha256Text(JSON.stringify(b)),b.content_sha256,b.source_file_sha256,reviewedHash(school.source.scope),reviewedHash(school.source.inputs),reviewedHash(b.reviews),b.dataset.catalog_template_key]);
    const imported=await scalar<{release_id:string;dataset_id:string}>("select private.import_school_handout_reviewed_bundle_v1($1,$2) value",[JSON.stringify(b),JSON.stringify(school.source)]);
    baseId=imported.release_id;datasetId=imported.dataset_id;await db.query("select private.activate_school_handout_reviewed_release_v1($1)",[baseId]);
    const asset={...Object.fromEntries(["request_sha256","audio_sha256","byte_count","storage_bucket","storage_object_key","profile_id","model","voice"].map(k=>[k,(oldIdentity as Obj)[k]])),storage_verified:true};
    await db.query("select private.register_vocab_pronunciation_tts_asset_batch_v2($1)",[JSON.stringify([asset])]);
    await db.query("insert into public.vocab_pronunciation_identities_v2 select x.* from jsonb_populate_record(null::public.vocab_pronunciation_identities_v2,$1::jsonb||jsonb_build_object('imported_at',now())) x",[JSON.stringify(oldIdentity)]);
    old=resources();old.entries[0]!.availability.pronunciation=true;
    old.entries[0]!.pronunciation={status:"linked",display_ko:oldIdentity.display_pronunciation_ko,lexical_pos:"noun",classification_note:"가짜 기존 분류 근거 보존",grammatical_form:"verb_expression",
      donor:{identity_id:oldIdentity.identity_id,identity_content_sha256:oldIdentity.identity_content_sha256.toLowerCase(),identity_headword:oldIdentity.headword,identity_lexical_pos:"other",variant_id:oldIdentity.pronunciation_variant_id,audio_key:audioKey(oldIdentity),display_override:null}};
    await approveResources(old);
    previousId=await scalar<string>("insert into private.reviewed_entry_resource_releases_v1(release_key,approval_id,base_release_id,content_sha256,bundle,status) values($1,$1,$2,$3,$4,'active') returning release_id value",[old.approval_id,baseId,old.content_sha256,JSON.stringify(old)]);
    await db.query(`insert into private.reviewed_entry_resources_v1
      select $1,e.id,x->>'entry_sha256',case when (x->>'source_row')::int=1 then $3 else null end,x
      from jsonb_array_elements($2::jsonb) x join public.vocab_entries e on e.dataset_id=$4 and e.source_row=(x->>'source_row')::int`,[previousId,JSON.stringify(old.entries),oldIdentity.identity_id,datasetId]);
  },60_000);
  afterAll(async()=>{await db?.close();});
  function candidate(){
    const b=structuredClone(old);b.approval_id="fake-audio-new";b.release_key=b.approval_id;
    const trimmed=identity(0,"trim","other");
    const assets={schema_version:"reviewed_pronunciation_assets_v1",approval_id:b.approval_id,review:{reviewer:"fake-review",evidence_sha256:"b".repeat(64)},content_sha256:"",
      entries:[trimmed,identity(1,"fill")].map((i,n)=>({source_row:n+1,entry_sha256:b.entries[n]!.entry_sha256,headword:b.entries[n]!.headword,
        kind:n===0?"trim_existing":"fill_missing",identity:i,prior_identity_id:n===0?oldIdentity.identity_id:null,
        resource_lexical_pos:"noun",display_ko:i.display_pronunciation_ko,display_override:null as Obj|null,
        source:{evidence_sha256:"c".repeat(64),review_reason:"가짜 음원 원천 및 내용 검토"},
        quality:{processing_version:"leading-silence-guard-v1",status:"passed",raw_sha256:n===0?oldIdentity.audio_sha256:reviewedHash("raw"),audio_sha256:i.audio_sha256,byte_count:i.byte_count,
          min_frequency_hz:150,threshold_dbfs:-60,frame_ms:20,hop_ms:10,consecutive_frames:2,analysis_only_filter:true,keep_ms:80,end_trim_ms:0,max_leading_ms:160,
          before:{leading_ms:400 as number|null},after:{leading_ms:130 as number|null},trim_start_ms:320},asset_sha256:""}))};
    function bind(){for(const x of assets.entries){
      x.identity.identity_content_sha256=reviewedHash(without(x.identity,"identity_content_sha256")).toUpperCase();
      x.asset_sha256=reviewedHash(without(x,"asset_sha256"));
      const e=b.entries[x.source_row-1]!;e.availability.pronunciation=true;
      e.pronunciation={...(x.kind==="trim_existing"?old.entries[0]!.pronunciation:{status:"linked",display_ko:x.display_ko,lexical_pos:"noun",classification_note:null,grammatical_form:null}),
        donor:{kind:"reviewed_asset",approval_id:b.approval_id,asset_source_row:x.source_row,asset_sha256:x.asset_sha256,
          identity_id:x.identity.identity_id,identity_content_sha256:x.identity.identity_content_sha256.toLowerCase(),identity_headword:x.identity.headword,identity_lexical_pos:x.identity.lexical_pos,
          variant_id:x.identity.pronunciation_variant_id,audio_key:audioKey(x.identity),display_override:x.display_override}};
    }seal(assets);seal(b);}
    bind();return {b,assets,bind};
  }
  async function approve(c:ReturnType<typeof candidate>,ref=project){
    const text=await approveResources(c.b,ref);seal(c.assets);const audio=JSON.stringify(c.assets);
    await db.query(`insert into private.reviewed_pronunciation_asset_approvals_v1 values($1,$2,$3,$4,2,1,1)`,[c.b.approval_id,old.content_sha256,sha256Text(audio),c.assets.content_sha256]);return [text,audio];
  }
  const apply=(args:string[])=>scalar<Obj>("select private.replace_reviewed_entry_resources_with_assets_v1($1,$2) value",args);
  const fingerprint=()=>scalar<string>(`select md5(jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by id) from public.vocab_entries e),
    'questions',(select jsonb_agg(to_jsonb(q) order by item_id) from private.reviewed_exam_items q),
    'source',(select jsonb_agg(to_jsonb(e) order by release_id,source_row) from private.reviewed_exam_entries e),
    'oldIdentity',(select to_jsonb(i) from public.vocab_pronunciation_identities_v2 i where identity_id=$1))::text) value`,[oldIdentity.identity_id]);
  it("공백 처리와 누락 보완을 원문·기존 품사·표기 보존 후 함께 적용하고 재실행한다",async()=>{
    await db.exec("begin");try{
      const before=await fingerprint();const c=candidate();const args=await approve(c);
      const result=await apply(args);expect(result).toMatchObject({entries:73,changed:2,reused:false});
      expect(await apply(args)).toMatchObject({reused:true,release_id:result.release_id});
      const ids=(await db.query<{id:number}>("select id from public.vocab_entries where dataset_id=$1 order by source_row limit 2",[datasetId])).rows.map(x=>x.id);
      const bindings=(await db.query<{identity_id:string}>("select * from public.list_active_vocab_pronunciation_bindings_v3($1)",[ids])).rows;
      expect(bindings.map(x=>x.identity_id).sort()).toEqual(c.assets.entries.map(x=>x.identity.identity_id).sort());
      expect(await fingerprint()).toBe(before);
      expect(await scalar("select status value from private.reviewed_entry_resource_releases_v1 where release_id=$1",[previousId])).toBe("retired");
    }finally{await db.exec("rollback");}
  });
  it.each(["project","file","row","headword","fill-pos","trim-pos","raw","display","quality-null","quality-missing","quality-high","quality-cut","override-old","override-text","resource-meaning","resource-classification","asset-ref","unapproved-change","count"])("%s 오류에서 기존 판과 원문을 보존한다",async kind=>{
    const c=candidate();const x=c.assets.entries[0]!;
    if(kind==="row")x.entry_sha256="0".repeat(64);
    if(kind==="headword")c.assets.entries[1]!.identity.headword="different";
    if(kind==="fill-pos")c.assets.entries[1]!.identity.lexical_pos="verb";
    if(kind==="trim-pos")x.identity.lexical_pos="noun";
    if(kind==="raw")x.quality.raw_sha256="0".repeat(64);
    if(kind==="display")x.display_ko="다른 표기";
    if(kind==="quality-null")x.quality.after.leading_ms=null;
    if(kind==="quality-missing")delete (x.quality.before as Obj).leading_ms;
    if(kind==="quality-high")x.quality.after.leading_ms=170;
    if(kind==="quality-cut")x.quality.trim_start_ms=400;
    if(kind.startsWith("override"))x.display_override={variant_id:oldIdentity.pronunciation_variant_id,audio_key:audioKey(oldIdentity),display_ko:kind==="override-text"?"다름":x.display_ko,segments:x.identity.segments,source_file_sha256:"d".repeat(64),manifest_sha256:"e".repeat(64)};
    c.bind();
    if(kind==="resource-meaning")c.b.entries[0]!.selection.meaning="다른 뜻";
    if(kind==="resource-classification")c.b.entries[0]!.pronunciation.classification_note="근거 변경";
    if(kind==="asset-ref")(c.b.entries[0]!.pronunciation.donor as Obj).asset_sha256="0".repeat(64);
    if(kind==="unapproved-change")c.b.entries[2]!.example.reason="승인 밖 변경";
    await db.exec("begin");try{
      const before=await fingerprint();const args=await approve(c,kind==="project"?"other":project);
      if(kind==="file")args[1]+=" ";
      if(kind==="count")await db.query("update private.reviewed_pronunciation_asset_approvals_v1 set missing_entry_count=2,trimmed_entry_count=0 where approval_id=$1",[c.b.approval_id]);
      await db.exec("savepoint apply_attempt");await expect(apply(args)).rejects.toThrow();await db.exec("rollback to apply_attempt");
      expect(await fingerprint()).toBe(before);
      expect(await scalar("select status value from private.reviewed_entry_resource_releases_v1 where release_id=$1",[previousId])).toBe("active");
      expect(await scalar("select count(*)::int value from private.reviewed_pronunciation_assets_v1")).toBe(0);
    }finally{await db.exec("rollback");}
  });
  it.each(["anon","authenticated","service_role"])("%s는 검토 원고 및 승인 경로에 접근할 수 없다",async role=>{
    await db.exec("set role "+role);try{
      await expect(db.query("select * from private.reviewed_pronunciation_assets_v1")).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.replace_reviewed_entry_resources_with_assets_v1('{}','{}')")).rejects.toThrow(/permission denied/);
    }finally{await db.exec("reset role");}
  });
});
