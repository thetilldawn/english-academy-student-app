// Explicitly opt-in fake browser data. No remote credentials or persistent DB.
import {withLocalPracticeDatabase} from './local-practice-data.mjs';
import {STUDY_SECRET} from './local-student-study-data.mjs';
import {ACCESS_TOKEN,PUBLIC_KEY} from './local-admin-baseline-data.mjs';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const admin=uid(999),students=[uid(1),uid(2)],dataset=uid(3);
const names=new Set(['prepare_notebook_assignment_source_v1','get_notebook_assignment_result_v1','create_notebook_assignments_v1']);
const regularNames=new Set(['create_quiz_attempt_from_bank','answer_quiz_question_v4','resume_quiz_after_feedback_v2','start_quiz_retry_v2','expire_quiz_attempt','finalize_quiz_attempt_if_stale','materialize_ready_vocab_assignment_queue_v1','get_student_dashboard_initial_v3','list_student_dashboard_section_page_v3','list_student_dashboard_completed_page_v2','get_admin_history_initial_v1','list_admin_history_page_v1','get_admin_history_detail_v1','list_student_point_totals_v1','get_quiz_attempt_point_summary_v1']);
const tables=new Set(['assignments','assignment_students','quiz_attempts','quiz_questions']);
export async function prepareLocalNotebookAssignment(){
 await withLocalPracticeDatabase(async db=>{
  await db.exec(`begin;
   select set_config('request.jwt.claim.role','authenticated',true);
   select set_config('request.jwt.claim.sub','${uid(900)}',true);
   insert into auth.users(id) values('${admin}');
   insert into admin_profiles(user_id,display_name,is_active) values('${admin}','가짜 관리자',true);
   update students set display_name='가짜 학생 1',school_name='검사 학교',grade_label='고1' where id='${uid(1)}';
   insert into students(id,display_name,status,created_by,school_name,grade_label) values('${uid(2)}','가짜 학생 2','active','${admin}','검사 학교','고1');
   insert into vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code) values('${dataset}','가짜 고2 연습 단어장','high','wordbook','g11');
   insert into assignment_students(assignment_id,student_id,assigned_by) values('${uid(901)}','${uid(2)}','${admin}');
   insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values('${uid(904)}','${uid(2)}','${uid(901)}',1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',clock_timestamp(),25,240,80,'initial');
   insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index)
    select extensions.gen_random_uuid(),'${uid(904)}',vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index from quiz_questions where attempt_id='${uid(902)}';
   insert into student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
    select '${uid(2)}','${dataset}',vocab_entry_id,attempt_id,id,'initial',clock_timestamp() from quiz_questions where attempt_id='${uid(904)}' and order_index<=12;
   commit;`);
 });
}
export async function localNotebookAssignmentFixture({url,method,headers,body}){
 const target=new URL(url),name=target.pathname.split('/').at(-1);
 if(target.origin!=='http://127.0.0.1:3038'||!(method==='POST'&&(names.has(name)||regularNames.has(name))||method==='GET'&&tables.has(name)))return null;
 const service=headers.get('apikey')===STUDY_SECRET&&headers.get('authorization')==='Bearer '+STUDY_SECRET;
 const authenticated=headers.get('apikey')===PUBLIC_KEY&&headers.get('authorization')==='Bearer '+ACCESS_TOKEN;
 if(!service&&!authenticated||names.has(name)&&!service)return{status:403,body:{message:'Local actors only'},category:'notebook-rejected'};
 if(method==='GET'){
  try{return await localRegularRead(target,headers);}
  catch(error){return{status:400,body:{message:error.message,code:error.code},category:'notebook-regular-sql-error'};}
 }
 const input=JSON.parse(body||'{}');
 if(names.has(name)&&input.p_admin_id!==admin||input.p_student_id&&!students.includes(input.p_student_id)||Object.keys(input).some(k=>!/^p_[a-z_]+$/.test(k)))return{status:403,body:{message:'Fake admin/students only'},category:'notebook-rejected'};
 try{
  const result=await withLocalPracticeDatabase(db=>db.transaction(async tx=>{
   await tx.exec(`select set_config('request.jwt.claim.role','${authenticated?'authenticated':'service_role'}',true);select set_config('request.jwt.claim.sub','${admin}',true);`);
   if(names.has(name))await tx.exec('set local role service_role');
   const entries=Object.entries(input);
   const call=`public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')})`,args=entries.map(([,v])=>v);
   const meta=(await tx.query("select bool_or(proretset) as multiple from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname=$1",[name])).rows[0];
   const rows=(await tx.query(meta.multiple?`select to_jsonb(r) value from ${call} r`:`select ${call} value`,args)).rows;
   return meta.multiple?rows.map(r=>r.value):rows[0].value;
  }));
  return{status:200,body:result,category:'notebook-assignment-sql'};
 }catch(error){return{status:error.code==='42501'?403:400,body:{message:error.message,code:error.code},category:'notebook-assignment-sql-error'};}
}
async function localRegularRead(target,headers){
 const table=target.pathname.split('/').at(-1),args=[],where=[];
 for(const [key,value] of target.searchParams){
  if(['select','order','limit','offset'].includes(key))continue;
  if(!/^(?:id|assignment_id|student_id|attempt_id|status|deleted_at)$/.test(key))throw Error('Unsupported local filter');
  if(value==='is.null'){where.push(`t.${key} is null`);continue;}
  if(!value.startsWith('eq.'))throw Error('Unsupported local operator');
  args.push(value.slice(3));where.push(`t.${key}=$${args.length}`);
 }
 if(!where.length)throw Error('Unbounded local read');
 const rows=await withLocalPracticeDatabase(async db=>{
  const rows=(await db.query(`select to_jsonb(t) row from public.${table} t where ${where.join(' and ')}${table==='quiz_questions'?' order by order_index':''}`,args)).rows.map(r=>r.row);
  for(const row of rows){
   if(table==='quiz_questions'){
    row.assignment_question=row.assignment_question_id?(await db.query('select to_jsonb(q) row from assignment_questions q where id=$1',[row.assignment_question_id])).rows[0]?.row:null;
    if(row.assignment_question)row.assignment_question.exam_use_snapshot=null;
    row.vocab_entries=(await db.query('select headword,primary_meaning,pronunciation_ko from vocab_entries where id=$1',[row.vocab_entry_id])).rows[0]??null;
   }
   if(table==='quiz_attempts'){
    row.assignments=(await db.query('select title,quiz_content_mode,deleted_at from assignments where id=$1',[row.assignment_id])).rows[0]??null;
    row.students=(await db.query('select display_name,deleted_at from students where id=$1',[row.student_id])).rows[0]??null;
   }
  }
  return rows;
 });
 return{status:200,body:headers.get('accept')?.includes('application/vnd.pgrst.object')?rows[0]??null:rows,category:'notebook-regular-sql'};
}
export const isLocalNotebookAssignmentRequest=(pathname,method)=>
 method==='POST'&&['/api/admin/notebook-assignments','/api/admin/notebook-assignments/preview'].includes(pathname)||
 method==='POST'&&/^\/api\/student\/assignments\/[a-f0-9-]{36}\/attempts$/.test(pathname)||
 ['GET','POST'].includes(method)&&/^\/api\/student\/attempts\/[a-f0-9-]{36}(?:\/(?:answers|feedback|retry|timeouts|expire))?$/.test(pathname)||
 method==='GET'&&['/api/student/dashboard/completed','/api/student/dashboard/sections'].includes(pathname);
