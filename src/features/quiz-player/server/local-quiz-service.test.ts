import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({rpc:vi.fn(),queue:vi.fn(),study:vi.fn(),access:vi.fn(),pack:vi.fn(),start:vi.fn(),prepare:vi.fn(),hydrate:vi.fn()}));
vi.mock("@/lib/supabase/service",()=>({getServiceSupabaseClient:()=>({rpc:m.rpc})}));
vi.mock("@/lib/services/vocab-assignment-queue-command",()=>({materializeReadyVocabAssignmentQueue:m.queue}));
vi.mock("@/lib/services/quiz/attempt-start",()=>({resolveStudentAttemptInput:m.start}));
vi.mock("./attempt-preparation",()=>({getQuizPreparation:m.prepare}));
vi.mock("@/features/student-dashboard/public-server",()=>({getAssignmentStudy:m.study,getAssignmentStudyAccess:m.access,packAssignmentStudy:m.pack}));
vi.mock("@/lib/services/quiz/attempt-query",()=>({hydrateQuizQuestions:m.hydrate}));
import { handleLocalQuizCommand } from "./local-quiz-service";
import { localFixture, localId, receiptFor } from "../test-support/local-quiz-fixtures";
import { recordLocalAnswer } from "../domain/local-quiz";
beforeEach(()=>{vi.resetAllMocks();m.queue.mockResolvedValue([]);m.start.mockResolvedValue({kind:"bank"});});
describe("기기 시험 서버 연결",()=>{
  it.each(["bank","legacy","existing"])("%s 준비는 준비 RPC를 한 번만 실행한다",async kind=>{
    const questions=[{vocab_entry_id:1,order_index:1,direction:"english_to_korean",prompt:"fake",choices:["a","b","c","d"],correct_choice_index:0}];
    m.start.mockResolvedValue(kind==="legacy"?{kind,questions}:kind==="existing"?{kind,attemptId:localId(8)}:{kind});
    m.rpc.mockResolvedValue({data:{protocol:"local_batch_v1",resumeId:localId(8)},error:null});
    const result=await handleLocalQuizCommand(localId(1),{action:"prepare",assignmentId:localId(4),device:"a".repeat(64),knownKeys:[]});
    expect(result).toMatchObject({studentId:localId(1),resumeId:localId(8)});
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("prepare_local_quiz_v1",expect.objectContaining({p_student_id:localId(1),p_assignment_id:localId(4),...(kind==="legacy"?{p_questions:questions}:{})}));
    if(kind!=="legacy")expect(m.rpc.mock.calls[0][1]).not.toHaveProperty("p_questions");
  });
  it("학습 본문은 한 번 읽으며 전후 배정판이 바뀌면 캐시에 넣을 응답을 거절한다",async()=>{
    const access={studentId:localId(1),assignmentId:localId(4),title:"가짜",mode:"book_meaning_choice",revision:"a".repeat(32)};
    const study={assignmentId:localId(4),words:[]};m.study.mockResolvedValue(study);m.pack.mockResolvedValue({manifest:{assignmentId:localId(4)},atoms:[]});
    m.access.mockResolvedValue(access);
    const request={action:"study" as const,assignmentId:localId(4),knownKeys:[]};
    expect(await handleLocalQuizCommand(localId(1),request)).toMatchObject({access});expect(m.study).toHaveBeenCalledTimes(1);expect(m.access).toHaveBeenCalledTimes(2);
    m.access.mockResolvedValueOnce(access).mockResolvedValueOnce({...access,revision:"b".repeat(32)});
    await expect(handleLocalQuizCommand(localId(1),request)).rejects.toMatchObject({code:"study_changed",status:409});
  });
  it("새 시작 중지는 준비 만료나 접수 실패와 구별해 안내한다",async()=>{
    const {run}=await localFixture();
    m.rpc.mockResolvedValue({data:null,error:{code:"55000",message:"quiz_new_attempts_paused"}});
    await expect(handleLocalQuizCommand(run.studentId,{action:"begin",device:run.device,preparationId:localId(4),planHash:"a".repeat(64)}))
      .rejects.toMatchObject({code:"quiz_new_attempts_paused",status:503,message:expect.stringContaining("점검 중")});
    expect(m.queue).not.toHaveBeenCalled();
  });
  it.each([true,false])("공식 접수 후 다음 예약 시험 준비를 이어간다: 완료=%s",async finalized=>{
    let {run}=await localFixture();for(let i=0;i<3;i++)run=recordLocalAnswer(run,i,i*300+50,Date.now(),localId(90));
    const receipt=await receiptFor(run.batch!,finalized);m.rpc.mockResolvedValue({data:receipt,error:null});
    expect(await handleLocalQuizCommand(run.studentId,{action:"submit",device:run.device,batch:run.batch!})).toEqual(receipt);
    expect(m.rpc).toHaveBeenCalledWith("submit_local_quiz_phase_v1",expect.objectContaining({p_student_id:run.studentId,p_device_hash:createHash("sha256").update(run.device).digest("hex"),p_submission_id:run.batch!.submissionId}));
    expect(m.queue).toHaveBeenCalledExactlyOnceWith(run.studentId);
    expect(m.rpc.mock.invocationCallOrder[0]).toBeLessThan(m.queue.mock.invocationCallOrder[0]);
  });
  it("거절된 접수는 다음 배정이나 성공 처리를 하지 않는다",async()=>{
    let {run}=await localFixture(1);run=recordLocalAnswer(run,0,50,Date.now(),localId(90));
    m.rpc.mockResolvedValue({data:null,error:{code:"PT409",message:"local_quiz_submission_conflict"}});
    await expect(handleLocalQuizCommand(run.studentId,{action:"submit",device:run.device,batch:run.batch!})).rejects.toMatchObject({status:409});expect(m.queue).not.toHaveBeenCalled();
  });
  it("원천형 미리받기는 권한 있는 공용 표시만 읽고 시험을 시작하지 않는다",async()=>{
    m.rpc.mockResolvedValue({data:null,error:null});m.study.mockResolvedValue({title:"fake"});m.pack.mockResolvedValue({atoms:[{key:"fake"}]});
    expect(await handleLocalQuizCommand(localId(3),{action:"prefetch",assignmentId:localId(4),knownKeys:[]})).toEqual({contents:[],atoms:[{key:"fake"}]});
    expect(m.study).toHaveBeenCalledWith({studentId:localId(3)},localId(4),true);expect(m.start).not.toHaveBeenCalled();expect(m.queue).not.toHaveBeenCalled();
  });
  it("미리받기에서 배정이 잠겼으면 본문을 반환하지 않는다",async()=>{
    m.rpc.mockResolvedValue({data:null,error:null});m.study.mockResolvedValue({release:{locked:true}});
    expect(await handleLocalQuizCommand(localId(3),{action:"prefetch",assignmentId:localId(4),knownKeys:[]})).toEqual({contents:[],atoms:[]});expect(m.pack).not.toHaveBeenCalled();
  });
});
