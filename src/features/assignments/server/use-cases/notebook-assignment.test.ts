import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),hydrate:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getServiceSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/features/students/public-server',()=>({hydrateNotebookRows:mocks.hydrate}));
import {notebookAssignmentInputSchema,type NotebookAssignmentInput} from '../../contracts/notebook-assignment';
import {previewNotebookAssignment,saveNotebookAssignment} from './notebook-assignment';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input:NotebookAssignmentInput=notebookAssignmentInputSchema.parse({requestKey:id(1),studentIds:[id(2)],audienceMode:'bulk',filters:{},settings:{questionCount:1,englishToKoreanRatio:100,timingMode:'none',timeLimitSeconds:null,questionTimeLimitSeconds:null,passingScore:80,retryEnabled:false,retryPassingScore:null}});
function source(studentId=id(2),hash='a'.repeat(64)){
 const candidates=['collect','travel','patient','enormous'].map((headword,n)=>({entryId:n+1,datasetId:id(10),headword,primaryMeaning:['모으다','여행하다','참을성 있는','거대한'][n],displayKo:null,eligibleDirections:['english_to_korean','korean_to_english'],choiceSafety:null}));
 return{sourceHash:hash,student:{id:studentId,displayName:'가짜학생',gradeLabel:'고1',schoolName:'가짜학교'},datasets:[{id:id(10),label:'가짜책',gradeCode:'g11',available:true}],candidates,
  words:[{key:`${studentId}:word`,headword:'collect',primaryMeaning:'과거 뜻',wrongCount:2,latestVocabEntryId:1,latestDatasetId:id(10),choiceSafety:null}]};
}
const result=[{studentId:id(2),assignmentId:id(20),questionCount:1}];
beforeEach(()=>{
 vi.resetAllMocks();mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='get_notebook_assignment_result_v1'?null:name==='create_notebook_assignments_v1'?result:source(String(args.p_student_id)),error:null}));
 mocks.hydrate.mockImplementation(async(rows:unknown[])=>rows.map(()=>({pronunciation:{displayKo:'기존발음',variantId:null,audioUrl:null,available:false}})));
});
describe('개인 오답 배정 조합',()=>{
 it('실제 학생/원책 학년·과거 뜻을 미리보기하고 문항 정답은 노출하지 않는다',async()=>{
  const preview=await previewNotebookAssignment(id(9),input);expect(preview.confirmation).toHaveLength(64);
  expect(preview.students[0]).toMatchObject({studentId:id(2),totalCount:1,availableCount:1,words:[{primaryMeaning:'과거 뜻'}],mismatchingSources:[{id:id(10)}]});
  expect(JSON.stringify(preview)).not.toContain('correctChoiceIndex');expect(mocks.hydrate).not.toHaveBeenCalled();
 });
 it('명시적 단일 학년 차이는 허용하고 일괄 1명은 확인해야 한다',async()=>{
  const preview=await previewNotebookAssignment(id(9),input);
  await expect(saveNotebookAssignment(id(9),{...input,confirmation:preview.confirmation!,gradeConfirmedStudentIds:[]})).rejects.toMatchObject({status:422});
  const single={...input,audienceMode:'single' as const},singlePreview=await previewNotebookAssignment(id(9),single);
  expect(singlePreview.students[0].mismatchingSources).toEqual([]);
  await expect(saveNotebookAssignment(id(9),{...single,confirmation:singlePreview.confirmation!,gradeConfirmedStudentIds:[]})).resolves.toEqual(result);
 });
 it('확인한 배정은 실제 단어와 고정 발음을 저장한다',async()=>{
  const preview=await previewNotebookAssignment(id(9),input);
  expect(await saveNotebookAssignment(id(9),{...input,confirmation:preview.confirmation!,gradeConfirmedStudentIds:input.studentIds})).toEqual(result);
  const args=mocks.rpc.mock.calls.find(c=>c[0]==='create_notebook_assignments_v1')![1];
  expect(args.p_batches[0]).toMatchObject({studentId:id(2),audienceMode:'bulk',gradeConfirmed:true,questions:[{prompt:'collect',pronunciation:{displayKo:'기존발음'}}]});
  expect(args.p_batches[0].questions[0].choices).toContain('과거 뜻');
 });
 it('완료 영수증은 원천/발음 재조회 없이 반환한다',async()=>{
  mocks.rpc.mockResolvedValue({data:result,error:null});
  expect(await saveNotebookAssignment(id(9),{...input,confirmation:'b'.repeat(64),gradeConfirmedStudentIds:input.studentIds})).toEqual(result);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.hydrate).not.toHaveBeenCalled();
 });
 it('조회/조건/학생/책 학년 변경은 저장 확인을 무효화한다',async()=>{
  const preview=await previewNotebookAssignment(id(9),input);
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='get_notebook_assignment_result_v1'?null:{...source(),sourceHash:'b'.repeat(64)},error:null}));
  await expect(saveNotebookAssignment(id(9),{...input,confirmation:preview.confirmation!,gradeConfirmedStudentIds:input.studentIds})).rejects.toMatchObject({status:409,code:'source_changed'});
  expect(mocks.hydrate).not.toHaveBeenCalled();expect(mocks.rpc.mock.calls.some(c=>c[0]==='create_notebook_assignments_v1')).toBe(false);
 });
 it('없는 프로필은 학생별 오류, 통신 장애는 정상 0개로 바꾸지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'notebook_student_profile_required',code:'22023'}});
  expect(await previewNotebookAssignment(id(9),input)).toMatchObject({confirmation:null,students:[{error:'학생의 학교와 학년을 먼저 입력해 주세요.'}]});
  mocks.rpc.mockResolvedValue({data:null,error:{message:'connection failed'}});
  await expect(previewNotebookAssignment(id(9),input)).rejects.toMatchObject({status:503});
 });
 it('같은 원단어의 중복·이용 불가 책을 제외 이유와 함께 반환한다',async()=>{
  const raw=source();raw.words.push({...raw.words[0],key:'same-entry-second-key'});
  mocks.rpc.mockResolvedValue({data:raw,error:null});let preview=await previewNotebookAssignment(id(9),input);
  expect(preview.students[0]).toMatchObject({totalCount:2,availableCount:1,excludedCount:1});
  raw.datasets[0].available=false;preview=await previewNotebookAssignment(id(9),input);
  expect(preview.confirmation).toBeNull();expect(preview.students[0]).toMatchObject({availableCount:0,excludedCount:2});
 });
 it('책의 학년 미상은 학년 차이로 추정하지 않는다',async()=>{
  const raw=source();raw.datasets[0].gradeCode='미상';mocks.rpc.mockResolvedValue({data:raw,error:null});
  expect((await previewNotebookAssignment(id(9),input)).students[0].mismatchingSources).toEqual([]);
 });
 it('학생별 조회는 4개 이하로 병렬 실행한다',async()=>{
  let active=0,max=0;mocks.rpc.mockImplementation(async(_name:string,args:Record<string,unknown>)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return{data:source(String(args.p_student_id)),error:null};});
  const many={...input,studentIds:Array.from({length:10},(_,i)=>id(i+100))};
  expect((await previewNotebookAssignment(id(9),many)).students).toHaveLength(10);expect(max).toBe(4);
 });
 it('최대 학생/문항, 중복 대상과 수치 공백은 입력 단계에서 거절한다',()=>{
  for(const bad of [{...input,studentIds:[]},{...input,studentIds:[id(2),id(2)]},{...input,studentIds:Array.from({length:211},(_,n)=>id(n+200))},
   {...input,studentIds:Array.from({length:21},(_,n)=>id(n+200)),settings:{...input.settings,questionCount:500}},
   {...input,settings:{...input.settings,questionCount:NaN}},{...input,settings:{...input.settings,retryEnabled:true,retryPassingScore:null}}])expect(notebookAssignmentInputSchema.safeParse(bad).success).toBe(false);
 });
});
