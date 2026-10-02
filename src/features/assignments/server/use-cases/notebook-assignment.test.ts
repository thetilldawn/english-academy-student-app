import {NotebookAssignmentError} from "../persistence/notebook-assignment";
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),hydrate:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getServiceSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/features/students/public-server',()=>({hydratePronunciationRows:mocks.hydrate}));
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

const mistakeInput=notebookAssignmentInputSchema.parse({...input,selectionVersion:2,audienceMode:"single",settings:{...input.settings,englishToKoreanRatio:0}});
function installFrozenMistakeRpc(){
 const flags={changedBody:false,failAudio:false};
 const voice={displayKo:"저장 발음",variantId:"mw:"+"1".repeat(20),audioUrl:"https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3",available:true};
 const word={key:"b".repeat(64),meaningKey:"b".repeat(64),wordKey:"word:collect",episodeId:id(32),stateVersion:"1",
  headword:"collect",primaryMeaning:"과거 뜻",selectedText:"The original English text ____.",testedField:"example",latestVocabEntryId:7,latestDatasetId:id(10),
  assignmentAvailable:true,choiceSafety:null,frozenOnly:true,sourceQuestionId:id(30),sourceAttemptId:id(31),sourcePhase:"initial",sourceContentHash:"c".repeat(64),
  frozenQuestion:{quizContentMode:"canonical_example_to_headword",direction:"korean_to_english",prompt:"The original English text ____.",choices:["travel","collect","patient","enormous"],correctChoiceIndex:1}};
 const source={sourceHash:"a".repeat(64),stateVersion:"1",student:{id:id(2),displayName:"가짜학생",gradeLabel:"고1",schoolName:"가짜학교"},
  datasets:[{id:id(10),label:"가짜책",gradeCode:"g10",available:true}],candidates:[],words:[word]};
 mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==="get_notebook_assignment_result_v1")return{data:null,error:null};
  if(name==="prepare_notebook_assignment_source_v2")return{data:source,error:null};
  if(name==="list_pronunciation_audio_corrections_v1")return flags.failAudio?{data:null,error:{message:"private SQL token",code:"08006"}}:{data:[],error:null};
  if(name==="read_question_contents_v1")return{data:{schemaVersion:"question-content-read-v1",context:args.p_context,items:[{id:word.sourceQuestionId,
   prompt:flags.changedBody?"Changed text":word.frozenQuestion.prompt,choices:word.frozenQuestion.choices,
   assignment_question:{vocab_entry_id:7,choice_vocab_entry_ids:[8,7,9,10],headword_snapshot:"collect",primary_meaning_snapshot:"과거 뜻",
    provenance_status:"notebook_snapshot_v1",composition_pronunciation_snapshot:null,notebook_pronunciation_snapshot:{target:voice,choices:[voice,voice,voice,voice]},exam_use_snapshot:null}}]},error:null};
  if(name==="create_notebook_assignments_v2")return{data:result,error:null};
  throw new Error("Unexpected RPC: "+name);
 });
 return{flags,voice,word};
}
it("관리자 원문 배정은 미응답 문항의 고정 발음을 보존한다",async()=>{
 const f=installFrozenMistakeRpc(),preview=await previewNotebookAssignment(id(9),mistakeInput);
 expect(JSON.stringify(preview)).not.toContain("correctChoiceIndex");
 await saveNotebookAssignment(id(9),{...mistakeInput,confirmation:preview.confirmation!,gradeConfirmedStudentIds:[]});
 expect(mocks.rpc).toHaveBeenCalledWith("read_question_contents_v1",{p_context:"admin_attempt",p_actor_id:id(9),p_context_id:id(31),p_question_ids:[id(30)]});
 const saved=mocks.rpc.mock.calls.find(call=>call[0]==="create_notebook_assignments_v2")![1].p_batches[0].questions[0];
 expect(saved).toMatchObject({prompt:f.word.frozenQuestion.prompt,correctChoiceIndex:1,choiceSources:[],bankIndex:0,pronunciation:f.voice,
  choicePronunciations:[f.voice,f.voice,f.voice,f.voice]});
 expect(mocks.hydrate).not.toHaveBeenCalled();
});
it("원문 변경은 HTTP가 구분하는 배정 오류 409로 변환한다",async()=>{
 const f=installFrozenMistakeRpc(),preview=await previewNotebookAssignment(id(9),mistakeInput);f.flags.changedBody=true;
 const failure=saveNotebookAssignment(id(9),{...mistakeInput,confirmation:preview.confirmation!,gradeConfirmedStudentIds:[]});
 await expect(failure).rejects.toBeInstanceOf(NotebookAssignmentError);await expect(failure).rejects.toMatchObject({status:409,code:"source_changed"});
 expect(mocks.rpc.mock.calls.some(call=>call[0]==="create_notebook_assignments_v2")).toBe(false);
});
it("음성 조회 장애는 저장하지 않고 같은 요청으로 다시 시도한다",async()=>{
 const f=installFrozenMistakeRpc(),preview=await previewNotebookAssignment(id(9),mistakeInput);
 const value={...mistakeInput,confirmation:preview.confirmation!,gradeConfirmedStudentIds:[]};f.flags.failAudio=true;
 await expect(saveNotebookAssignment(id(9),value)).rejects.toThrow("발음 정보를 불러오지 못했습니다");
 expect(mocks.rpc.mock.calls.some(call=>call[0]==="create_notebook_assignments_v2")).toBe(false);
 f.flags.failAudio=false;await expect(saveNotebookAssignment(id(9),value)).resolves.toEqual(result);
});
