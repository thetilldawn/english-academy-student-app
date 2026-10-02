
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase/service",()=>({getServiceSupabaseClient:()=>({rpc:mocks.rpc})}));
import { directReviewAssignmentSchema } from "@/lib/admin/direct-review-assignment-request";
import { previewDirectMistakeAssignment, saveDirectMistakeAssignment } from "./direct-mistake-assignment";
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const input=directReviewAssignmentSchema.parse({planVersion:"meaning-episode-v1",idempotencyKey:id(1),studentId:id(2),datasetId:id(10),reviewLevels:[1,2],
  englishToKoreanRatio:0,totalQuestionCount:1,selectionFingerprint:"a".repeat(64),title:"가짜 직접",timeLimitSeconds:60,timingMode:"none",
  questionTimeLimitSeconds:null,passingScore:80,retryEnabled:false,retryPassingScore:null,questionOrderMode:"fixed",availableFrom:null,availableUntil:null});
const result=[{studentId:id(2),assignmentId:id(20),questionCount:1}];
beforeEach(()=>{vi.resetAllMocks();});
function installFrozenMistakeRpc(){
 const flags={changedBody:false,failAudio:false,receipt:false};
 const voice={displayKo:"저장 발음",variantId:"mw:"+"1".repeat(20),audioUrl:"https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3",available:true};
 const word={reasonLevel:1,key:"b".repeat(64),meaningKey:"b".repeat(64),wordKey:"word:collect",episodeId:id(32),stateVersion:"1",
  headword:"collect",primaryMeaning:"과거 뜻",selectedText:"The original English text ____.",testedField:"example",latestVocabEntryId:7,latestDatasetId:id(10),
  assignmentAvailable:true,choiceSafety:null,frozenOnly:true,sourceQuestionId:id(30),sourceAttemptId:id(31),sourcePhase:"initial",sourceContentHash:"c".repeat(64),
  frozenQuestion:{quizContentMode:"canonical_example_to_headword",direction:"korean_to_english",prompt:"The original English text ____.",choices:["travel","collect","patient","enormous"],correctChoiceIndex:1}};
 const source={sourceHash:"a".repeat(64),stateVersion:"1",student:{id:id(2),displayName:"가짜학생",gradeLabel:"고1",schoolName:"가짜학교"},
  datasets:[{id:id(10),label:"가짜책",gradeCode:"g10",available:true}],candidates:[],words:[word]};
 mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==="get_notebook_assignment_result_v1")return{data:flags.receipt?result:null,error:null};
  if(name==="prepare_book_mistake_assignment_source_v1")return{data:source,error:null};
  if(name==="list_pronunciation_audio_corrections_v1")return flags.failAudio?{data:null,error:{message:"private SQL token",code:"08006"}}:{data:[],error:null};
  if(name==="read_question_contents_v1")return{data:{schemaVersion:"question-content-read-v1",context:args.p_context,items:[{id:word.sourceQuestionId,
   prompt:flags.changedBody?"Changed text":word.frozenQuestion.prompt,choices:word.frozenQuestion.choices,
   assignment_question:{vocab_entry_id:7,choice_vocab_entry_ids:[8,7,9,10],headword_snapshot:"collect",primary_meaning_snapshot:"과거 뜻",
    provenance_status:"notebook_snapshot_v1",composition_pronunciation_snapshot:null,notebook_pronunciation_snapshot:{target:voice,choices:[voice,voice,voice,voice]},exam_use_snapshot:null}}]},error:null};
  if(name==="create_book_mistake_assignments_v1")return{data:result,error:null};
  throw new Error("Unexpected RPC: "+name);
 });
 return{flags,voice,word,source};
}

describe("현재 뜻 기반 직접 오답시험",()=>{
 it("원문 뜻·소유자·발음을 준비부터 저장까지 전달한다",async()=>{
  const f=installFrozenMistakeRpc();const preview=await previewDirectMistakeAssignment(id(9),input);
  expect(preview).toMatchObject({wrongEligible:1,wrongLevel1Eligible:1,wrongLevel2Eligible:0,planVersion:"meaning-episode-v1",banks:[{questionCount:1,englishToKoreanRatio:0}]});
  expect(JSON.stringify(preview)).not.toContain("correctChoiceIndex");
  const value={...input,selectionFingerprint:preview.selectionFingerprint};
  expect(await saveDirectMistakeAssignment(id(9),value)).toEqual({kind:"mistake_batch",assignments:result});
  const batch=mocks.rpc.mock.calls.find(x=>x[0]==="create_book_mistake_assignments_v1")![1].p_batches[0];
  expect(batch).toMatchObject({studentId:id(2),selection:{mode:"direct",datasetId:id(10),reviewLevels:[1,2]},
    settings:{title:"가짜 직접",questionOrderMode:"fixed"},questions:[{meaningKey:f.word.meaningKey,sourcePhase:"initial",pronunciation:f.voice}]});
  f.flags.receipt=true;f.source.words=[];mocks.rpc.mockClear();
  expect(await saveDirectMistakeAssignment(id(9),value)).toEqual({kind:"mistake_batch",assignments:result});
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it("확인 뒤 뜻 상태가 바뀌면 저장을 거절한다",async()=>{
  const f=installFrozenMistakeRpc();const preview=await previewDirectMistakeAssignment(id(9),input);
  f.source.sourceHash="f".repeat(64);
  await expect(saveDirectMistakeAssignment(id(9),{...input,selectionFingerprint:preview.selectionFingerprint})).rejects.toMatchObject({status:409,code:"source_changed"});
  expect(mocks.rpc.mock.calls.some(x=>x[0]==="create_book_mistake_assignments_v1")).toBe(false);
 });
 it("같은 단어의 다른 뜻은 미리보기에서 별도 시험으로 표시하고 시간을 중복 배정하지 않는다",async()=>{
  const f=installFrozenMistakeRpc();f.source.words.push({...f.word,key:"d".repeat(64),meaningKey:"d".repeat(64),episodeId:id(33),sourceQuestionId:id(34)});
  const preview=await previewDirectMistakeAssignment(id(9),input);
  expect(preview.wrongEligible).toBe(2);expect(preview.banks.map(b=>b.questionCount)).toEqual([1,1]);
  await expect(saveDirectMistakeAssignment(id(9),{...input,totalQuestionCount:2,selectionFingerprint:preview.selectionFingerprint,timingMode:"total",timeLimitSeconds:30})).rejects.toMatchObject({status:422});
  expect(mocks.rpc.mock.calls.some(x=>x[0]==="read_question_contents_v1")).toBe(false);
 });
 it("새 경로 영수증도 학생·합계·배정 중복을 검사한다",async()=>{
  installFrozenMistakeRpc();mocks.rpc.mockResolvedValue({data:[{...result[0],studentId:id(99)}],error:null});
  await expect(saveDirectMistakeAssignment(id(9),input)).rejects.toMatchObject({status:503});
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(["source","write"])("%s 도중 이전 요청이 저장되면 같은 영수증을 돌려준다",async stage=>{
  const f=installFrozenMistakeRpc();const preview=await previewDirectMistakeAssignment(id(9),input);
  const original=mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name===(stage==="source"?"prepare_book_mistake_assignment_source_v1":"create_book_mistake_assignments_v1")){
    f.flags.receipt=true;return{data:null,error:{message:"connection interrupted",code:"08006"}};
   }
   return original(name,args);
  });
  expect(await saveDirectMistakeAssignment(id(9),{...input,selectionFingerprint:preview.selectionFingerprint})).toEqual({kind:"mistake_batch",assignments:result});
  expect(mocks.rpc.mock.calls.filter(x=>x[0]==="get_notebook_assignment_result_v1")).toHaveLength(2);
 });
});
