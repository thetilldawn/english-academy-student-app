import { beforeAll, afterAll, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
let db: Awaited<ReturnType<typeof createFinalSchemaDatabase>>;
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const snapshot="2026-09-29T01:00:00.000Z";
type Node={assignmentId:string;effectiveAt:string;dashboardSection:string;sortBucket:number;sortAt:string;secondarySortAt:string;item:Record<string,unknown>};
type Initial={current_items:Node[];completed_items:Node[];open_count:number;scheduled_count:number;needs_attention_count:number;completed_count:number;deadline_closed_count:number};
beforeAll(async()=>{
  db=await createFinalSchemaDatabase();
  await db.exec(`
    begin;
    select set_config('request.jwt.claim.sub','${id(1)}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    select set_config('request.jwt.claims','{"role":"authenticated"}',false);
    insert into auth.users(id) values('${id(1)}');
    insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','가짜 관리자',true);
    insert into students(id,display_name,status,created_by) values('${id(2)}','가짜 학생','active','${id(1)}'),('${id(3)}','다른 가짜 학생','active','${id(1)}');
    insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by) values('${id(4)}','fake-dashboard-pages','가짜 검사','가상',repeat('A',64),4,'ready','${id(1)}');
    insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values('${id(5)}','${id(4)}','DAY 1','day 1','day',1,1,4);
  `);
  for (const base of [100,200,300,400,500]) {
    for(let n=0;n<21;n++){
      const key=base+n;
      await db.query(`insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,passing_score,status,created_by,retake_allowed,available_from,available_until)
        values($1,$2,$3,1,4,4,300,80,'active',$4,true,$5,$6)`,
        [id(key),`가짜 ${key}`,id(4),id(1),base===200?"2026-10-01T00:00:00Z":null,base===500?"2026-09-28T00:00:00Z":null]);
      await db.query("insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)",[id(key),id(4),id(5)]);
      await db.query("insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values($1,$2,$3,$4)",[id(key),id(2),id(1),"2026-09-01T00:00:00Z"]);
      if(base===300||base===400){
        await db.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
          values($1,$2,$3,1,'2026-09-01','2026-09-30',4,300,80,'initial')`,[id(key+1000),id(2),id(key)]);
        // Pairs share exact finish time, and one pair differs by a microsecond.
        const finish=`2026-09-${String(10+Math.floor(n/2)).padStart(2,"0")}T00:00:00.${n===20?"000001":"000000"}Z`;
        await db.query(`update quiz_attempts set status=$2,phase=$3,initial_completed_at=$4,completed_at=$5,
          initial_correct_count=$6,retry_correct_count=0,unresolved_wrong_count=$7,initial_score=$8,final_score=$9,passed=$10,elapsed_seconds=1 where id=$1`,
          [id(key+1000),base===300&&n%2===0?"in_progress":"completed",base===300&&n%2===0?"review":"completed",
           finish,base===300&&n%2===0?null:finish,base===400?4:2,base===400?0:2,base===400?100:50,
           base===300&&n%2===0?null:base===400?100:50,base===300&&n%2===0?null:base===400]);
      }
    }
  }
  await db.exec("commit;");
},120000);
afterAll(async()=>{await db?.close();});
async function initial(student=id(2)) {return (await db.query<Initial>("select * from get_student_dashboard_initial_v3($1,$2)",[student,snapshot])).rows[0]!;}
async function next(node:Node,student=id(2)){
  return (await db.query<{assignment_id:string;effective_at:Date;dashboard_section:string;sort_bucket:number;sort_at:Date|number;secondary_sort_at:Date|number;item:Record<string,unknown>}>(`
    select * from list_student_dashboard_section_page_v3($1,$2,$3,$4,$5,$6,$7,$8)`,
    [student,snapshot,node.dashboardSection,node.sortBucket,node.sortAt,node.secondarySortAt,node.effectiveAt,node.assignmentId])).rows;
}
it("다섯 구역 각각 첫11행만 읽고 실제 전체21개를 센다",async()=>{
  const row=await initial();
  expect(row.current_items).toHaveLength(44);expect(row.completed_items).toHaveLength(11);
  for(const count of [row.open_count,row.scheduled_count,row.needs_attention_count,row.completed_count,row.deadline_closed_count]) expect(Number(count)).toBe(21);
});
it.each(["open","scheduled","needs_attention","deadline_closed"])("%s: 10+10+1, 같은 시각/미래공개/마이크로초 경계를 보존한다",async section=>{
  const first=(await initial()).current_items.filter(n=>n.dashboardSection===section).slice(0,10);
  const second=await next(first.at(-1)!);
  expect(second).toHaveLength(11);
  const last=second[9]!;
  // Preserve exact database text for the next cursor, not JS Date milliseconds.
  const key=(await db.query<Node>(`select assignment_id as "assignmentId",effective_at::text as "effectiveAt",dashboard_section as "dashboardSection",sort_bucket as "sortBucket",sort_at::text as "sortAt",secondary_sort_at::text as "secondarySortAt",item from private.student_dashboard_ordered_rows_v3($1,$2) where assignment_id=$3`,[id(2),snapshot,last.assignment_id])).rows[0]!;
  const third=await next(key);
  expect(third).toHaveLength(1);
  const ids=[...first.map(n=>n.assignmentId),...second.slice(0,10).map(n=>n.assignment_id),...third.map(n=>n.assignment_id)];
  expect(new Set(ids).size).toBe(21);
  const expected=(await db.query<{assignment_id:string}>(`select assignment_id from private.student_dashboard_ordered_rows_v3($1,$2) where dashboard_section=$3 order by sort_bucket,sort_at,secondary_sort_at,effective_at desc,assignment_id`,[id(2),snapshot,section])).rows.map(n=>n.assignment_id);
  expect(ids).toEqual(expected);
});
it("미통과와 복습대기를 마감보다 최근 종료순으로 섞어서 표시한다",async()=>{
  const rows=(await initial()).current_items.filter(n=>n.dashboardSection==="needs_attention");
  expect(rows.map(n=>n.assignmentId)).toEqual([320,318,319,316,317,314,315,312,313,310,311].map(id));
});
it("다른 학생은 빈 목록이며 다른 학생 커서로도 자료를 읽지 않는다",async()=>{
  expect((await initial(id(3))).current_items).toHaveLength(0);
  expect(await next((await initial()).current_items[0]!,id(3))).toHaveLength(0);
});
it("service_role만 새 읽기 함수 호출권한이 있다",async()=>{
  for (const role of ["anon","authenticated","service_role"]){
    const rows=await db.query<{allowed:boolean}>(`select has_function_privilege($1,p.oid,'execute') as allowed from pg_proc p where p.proname in ('student_dashboard_ordered_rows_v3','get_student_dashboard_initial_v3','list_student_dashboard_section_page_v3')`,[role]);
    expect(rows.rows).toHaveLength(3); expect(rows.rows.every(row=>row.allowed===(role==="service_role"))).toBe(true);
  }
});
it("잘못된 구역·미래스냅샷을 거절하고 조회는 학생 기록을 쓰지 않는다",async()=>{
  const before=await db.query("select (select count(*) from quiz_attempts) attempts,(select count(*) from student_point_events) points,(select count(*) from assignment_students) recipients");
  await initial();await next((await initial()).current_items[0]!);
  expect((await db.query("select (select count(*) from quiz_attempts) attempts,(select count(*) from student_point_events) points,(select count(*) from assignment_students) recipients")).rows).toEqual(before.rows);
  await expect(db.query("select * from get_student_dashboard_initial_v3($1,'2100-01-01')",[id(2)])).rejects.toThrow();
  await expect(db.query("select * from list_student_dashboard_section_page_v3($1,$2,'bad',0,'infinity','-infinity',$2,$1)",[id(2),snapshot])).rejects.toThrow();
});
