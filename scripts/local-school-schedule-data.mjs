// Local synthetic data only. Never import this module from application code.
export const LOCAL_SCHOOL_KEY = 'T00:0000001';
const edits = new Map();
const receipts = new Map();
let revision = 0;
function sourceEvents() {
  const event = (id, grade, kind, title, startDate, endDate) => ({ id, grade, kind, round: kind === 'written' ? 1 : null,
    title, subject: kind === 'written' ? null : '영어', startDate, endDate, precision: startDate ? 'range' : 'unknown',
    status: startDate ? 'confirmed' : 'unknown', dateText: '', maxPoints: kind === 'written' ? null : 25,
    applicability: 'grade', sourceUrl: 'https://school.example.invalid/notice' });
  return [event('fake-written',1,'written','2학기 1차 시험','2026-10-12','2026-10-16'),
    event('fake-september',1,'performance','9월 가상 어휘 평가','2026-09-15','2026-09-15'),
    event('fake-performance',1,'performance','가상 글쓰기 평가',null,null),
    event('fake-overlap',1,'performance','같은 주 영어 발표','2026-10-14','2026-10-14'),
    event('fake-senior',3,'written','고3 1차 시험','2026-10-12','2026-10-16')];
}
function events(semester) {
  const combined = new Map((semester === 2 ? sourceEvents() : []).map(event => [event.id,event]));
  for(const { semester: term, event } of edits.values()) if(term === semester) combined.set(event.id,event);
  return [...combined.values()];
}
export function localSchoolSchedulePayload(students, ids = null) {
  const selected=students.filter(student=>ids==null || ids.includes(student.id));
  return { students:selected.map(student=>({id:student.id,schoolKey:student.schoolKey===undefined?LOCAL_SCHOOL_KEY:student.schoolKey,schoolName:student.schoolName,gradeLabel:student.gradeLabel})),
    bundles:[1,2].filter(semester=>events(semester).length).map(semester=>({schoolKey:LOCAL_SCHOOL_KEY,schoolName:'검사 학교',schoolLevel:'고',academicYear:2026,semester,
      versionId:semester===2?'local-fake-2026-2':'manual-local',sourceHash:'a'.repeat(64),checkedOn:'2026-09-14',events:events(semester)})) };
}
export function localSchoolScheduleEdit(students,rpc,input) {
  const deny={status:403,body:{code:'42501',message:'forbidden'}};
  if(rpc==='get_admin_school_schedule_edit_result_v1')return {status:200,body:receipts.get(input.p_request_id)?.receipt ?? null};
  const command=input.p_input;
  const key=command?.schoolKey??input.p_school_key;
  const semester=command?.semester??input.p_semester;
  const academicYear=command?.academicYear??input.p_academic_year;
  if(key!==LOCAL_SCHOOL_KEY||academicYear!==2026||![1,2].includes(semester))return deny;
  const version=semester===2?'local-fake-2026-2':null;
  if(rpc==='save_admin_school_schedule_event_v1') {
    const existing=receipts.get(command.requestId);
    if(existing)return JSON.stringify(existing.command)===JSON.stringify(command)?{status:200,body:existing.receipt}:{status:400,body:{code:'22023'}};
    if(command.sourceVersionId!==version||command.manualRevision!==revision)return {status:409,body:{code:'40001'}};
    revision++;edits.set(semester+':'+command.event.id,{semester,event:command.event});
    const receipt={requestId:command.requestId,eventId:command.event.id,revision,schoolKey:key,academicYear,semester};
    receipts.set(command.requestId,{receipt,command});return {status:200,body:receipt};
  }
  const grouped=new Map();
  for(const student of students){
    const grade=Number(student.gradeLabel.replace(/\D/g,''));
    const group=grouped.get(grade);
    if(group)group.studentCount++;
    else grouped.set(grade,{schoolKey:key,schoolName:student.schoolName,schoolLevel:'고',grade,gradeLabel:student.gradeLabel,studentCount:1});
  }
  return {status:200,body:{schoolKey:key,academicYear,semester,sourceVersionId:version,manualRevision:revision,groups:[...grouped.values()],events:events(semester),sourceChangedEventIds:[]}};
}
