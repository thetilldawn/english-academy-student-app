import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const id=(n:number)=>`92000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const student=id(2),assignment=id(10);
describe.sequential("preparation before the first exam clock",()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    // Supabase supplies these auth-schema privileges outside application migrations.
    await db.exec("grant usage on schema auth,extensions to service_role; alter role service_role bypassrls");
    await db.exec(`begin;
      select set_config('request.jwt.claim.sub','${id(1)}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claims','{"role":"authenticated"}',true);
      insert into auth.users(id) values('${id(1)}');
      insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','Fake admin',true);
      insert into students(id,display_name,status,created_by) values('${student}','Fake ready student','active','${id(1)}'),('${id(3)}','Other fake student','active','${id(1)}');
      insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(4)}','ready-fake','Fake ready set','Fake',repeat('A',64),4,'ready','${id(1)}');
      insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
      insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,timing_mode,
        question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
        values('${assignment}','Fake ready exam','${id(4)}',1,4,4,100,240,'per_question',5,80,'active','${id(1)}',true);
      insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${assignment}','${id(4)}','${id(100)}',1,true);
      insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${assignment}','${student}','${id(1)}',clock_timestamp()-interval '1 day');
      insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${id(4)}',n,'fake'||n,'fake'||n,array['Fake meaning'||n],'Fake meaning'||n,repeat('B',63)||n::text,'${id(100)}',n,'word' from generate_series(1,4)n;
      commit;`);
  },120_000);
  beforeEach(async()=>{await db.exec("begin; select set_config('request.jwt.claim.role','service_role',true)");});
  afterEach(async()=>{await db.exec("rollback;reset role");});
  afterAll(async()=>{await db?.close();});
  async function rpc<T>(name:string,args:unknown[]){
    await db.exec("set local role service_role");
    return (await db.query<{v:T}>(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")}) v`,args)).rows[0].v;
  }
  async function owner(query:string,args:unknown[]=[]){await db.exec("reset role");return db.query<Record<string,unknown>>(query,args);}
  async function questions(){return (await owner(`select jsonb_agg(jsonb_build_object('vocab_entry_id',id,'order_index',source_row,'direction','english_to_korean',
    'prompt',headword,'choices',jsonb_build_array('Fake meaning1','Fake meaning2','Fake meaning3','Fake meaning4'),'correct_choice_index',source_row-1) order by source_row) plan
    from vocab_entries where dataset_id=$1`,[id(4)])).rows[0].plan;}
  async function prepare(){return rpc<string>("prepare_quiz_attempt_v1",[student,assignment,await questions()]);}
  async function begin(p:string){return rpc<string>("begin_prepared_quiz_v1",[student,p]);}
  async function fails(action:()=>Promise<unknown>,message:string){
    await db.exec("savepoint expected_failure");
    try{await expect(action()).rejects.toThrow(message);}finally{await db.exec("rollback to expected_failure;release expected_failure");}
  }
  async function snapshot(){
    const names=["quiz_attempts","quiz_questions","student_vocab_wrong_events","student_point_events"];
    const result=[];
    for(const name of names) result.push((await owner(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from public.${name} t`)).rows);
    return result;
  }
  it("preparing changes no attempts, answers, wrong records or points; repeated preparation reuses its plan",async()=>{
    const before=await snapshot(),p=await prepare();
    expect(await prepare()).toBe(p);expect(await snapshot()).toEqual(before);
    const raw=await rpc<{plan:Array<{id:string}>;kind:string}>("get_quiz_preparation_v1",[student,p]);
    expect(raw.kind).toBe("initial");expect(raw.plan).toHaveLength(4);
    expect(await rpc("get_quiz_preparation_v1",[id(3),p])).toBeNull();
  });
  it.each([5,8,10])("only begins the %s-second clock after a slow preparation; exact IDs/order and duplicate receipt remain",async seconds=>{
    await owner("update assignments set question_time_limit_seconds=$1 where id=$2",[seconds,assignment]);
    const p=await prepare();
    await owner("update private.quiz_attempt_preparations set created_at=clock_timestamp()-interval '5 minutes' where id=$1",[p]);
    const plan=(await owner("select plan from private.quiz_attempt_preparations where id=$1",[p])).rows[0].plan as Array<{id:string;prompt:string}>;
    const before=Date.now();expect(await begin(p)).toBe(p);
    const state=(await owner("select * from quiz_attempts where id=$1",[p])).rows[0];
    expect(Date.parse(String(state.started_at))).toBeGreaterThanOrEqual(before-1000);
    const rows=(await owner("select id,prompt from quiz_questions where attempt_id=$1 order by order_index",[p])).rows;
    expect(rows).toEqual(plan.map(q=>({id:q.id,prompt:q.prompt})));
    expect(await begin(p)).toBe(p);
    expect((await owner("select started_at,current_question_started_at,deadline_at from quiz_attempts where id=$1",[p])).rows[0])
      .toEqual({started_at:state.started_at,current_question_started_at:state.current_question_started_at,deadline_at:state.deadline_at});
    expect(Number((await owner("select extract(epoch from(deadline_at-started_at)) budget from quiz_attempts where id=$1",[p])).rows[0].budget)).toBe(240);
  });
  it("rejects modified settings/source, expired preparation, cancellation and blocked students before any attempt",async()=>{
    const p=await prepare();
    await owner("update assignments set title='Changed' where id=$1",[assignment]);
    await fails(()=>begin(p),"preparation_changed");
    await owner("update assignments set title='Fake ready exam' where id=$1",[assignment]);
    const fresh=await prepare();
    await owner("update private.quiz_attempt_preparations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[fresh]);
    await fails(()=>begin(fresh),"preparation_expired");
    const next=await prepare();
    await owner("update assignment_students set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='Fake cancellation' where assignment_id=$1",[assignment,id(1)]);
    await fails(()=>begin(next),"assignment_not_owned");
    await owner("update students set status='blocked' where id=$1",[student]);
    await fails(()=>begin(next),"student_not_found");
    expect((await owner("select count(*)::integer n from quiz_attempts")).rows[0].n).toBe(0);
  });
  it("keeps an attempt begun by another tab instead of creating or retiming a second attempt",async()=>{
    const q=await questions(),p=await prepare();
    const other=await rpc<string>("create_quiz_attempt",[student,assignment,q]);
    const before=(await owner("select started_at,deadline_at from quiz_attempts where id=$1",[other])).rows;
    expect(await begin(p)).toBe(other);
    expect((await owner("select started_at,deadline_at from quiz_attempts where id=$1",[other])).rows).toEqual(before);
    expect((await owner("select count(*)::integer n from quiz_attempts")).rows[0].n).toBe(1);
  });
  it("bank preparation copies the confirmed plan without randomizing again at begin",async()=>{
    await owner("update assignments set range_basis='units',question_bank_version=1,question_order_mode='descending' where id=$1",[assignment]);
    await owner(`insert into assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index)
      select $1,id,source_row,'english_to_korean',headword,jsonb_build_array('Fake meaning1','Fake meaning2','Fake meaning3','Fake meaning4'),(source_row-1)::smallint
      from vocab_entries where dataset_id=$2`,[assignment,id(4)]);
    const p=await rpc<string>("prepare_quiz_attempt_v1",[student,assignment]);
    await begin(p);
    expect((await owner("select prompt from quiz_questions where attempt_id=$1 order by order_index",[p])).rows.map(q=>q.prompt))
      .toEqual(["fake4","fake3","fake2","fake1"]);
  });
  it("does not expose preparatory tables or RPCs to browser roles, and rejects another student at begin",async()=>{
    const p=await prepare();
    await fails(()=>rpc("begin_prepared_quiz_v1",[id(3),p]),"preparation_not_found");
    for(const role of ["anon","authenticated"]){
      await db.exec("reset role;savepoint role_failure;set local role "+role);
      try{await expect(db.query("select public.get_quiz_preparation_v1($1,$2)",[student,p])).rejects.toThrow("permission denied");}
      finally{await db.exec("rollback to role_failure;release role_failure");}
    }
  });
  it("legacy plans cannot substitute another prompt or an out-of-range entry",async()=>{
    const plan=await questions() as Array<Record<string,unknown>>;
    await fails(()=>rpc("prepare_quiz_attempt_v1",[student,assignment,[{...plan[0],prompt:"wrong"},...plan.slice(1)]]),"invalid_question_payload");
    await fails(()=>rpc("prepare_quiz_attempt_v1",[student,assignment,[{...plan[0],vocab_entry_id:999999},...plan.slice(1)]]),"invalid_question_payload");
  });
  it("uses begin wall-clock time rather than the earlier transaction start",async()=>{
    const p=await prepare();
    await new Promise(resolve=>setTimeout(resolve,1100));
    const justBefore=Date.now();
    await begin(p);
    const value=(await owner("select extract(epoch from started_at)*1000 started from quiz_attempts where id=$1",[p])).rows[0];
    expect(Number(value.started)).toBeGreaterThanOrEqual(justBefore-20);
  });
});

