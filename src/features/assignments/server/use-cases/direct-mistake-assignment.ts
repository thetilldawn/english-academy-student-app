import "server-only";
import { z } from "zod";
import { buildMistakePracticePlan, freezeMistakePracticeQuestions, mistakePracticeSourceSchema, practiceHash, PracticeError } from "@/features/quiz-player/public-server";
import type { DirectReviewAssignmentInput, DirectReviewPreviewInput } from "@/lib/admin/direct-review-assignment-request";
import { notebookAssignmentResultSchema } from "../../contracts/notebook-assignment";
import { splitMistakeAssignmentBanks } from "../../domain/mistake-assignment-banks";
import type { DirectReviewUnavailableItem } from "../../domain/direct-review-diagnosis";
import { NotebookAssignmentError, notebookAssignmentRpc } from "../persistence/notebook-assignment";

const sourceSchema=mistakePracticeSourceSchema.extend({
  words:z.array(mistakePracticeSourceSchema.shape.words.element.extend({
    reasonLevel:z.union([z.literal(1),z.literal(2)]),latestDatasetId:z.uuid(),assignmentAvailable:z.boolean(),
  })).max(10000),
  datasets:z.array(z.object({id:z.uuid(),available:z.boolean()})),
});
function selection(input:DirectReviewPreviewInput){return{mode:"direct",datasetId:input.datasetId,reviewLevels:[...input.reviewLevels].sort()};}
async function prepare(adminId:string,input:DirectReviewPreviewInput){
  const source=sourceSchema.parse(await notebookAssignmentRpc("prepare_book_mistake_assignment_source_v1",{
    p_admin_id:adminId,p_student_id:input.studentId,p_selection:selection(input),
  }));
  if(source.words.length>400)throw new NotebookAssignmentError(422,"한 번에 400문항까지 배정할 수 있습니다. 오답 단계나 단어장을 나누어 선택해 주세요.");
  const usable=new Set(source.datasets.filter(d=>d.available).map(d=>d.id));
  const unavailableItems:DirectReviewUnavailableItem[]=source.words.filter(w=>!usable.has(w.latestDatasetId)).map(w=>({
    sourceQuestionId:w.sourceQuestionId,vocabEntryId:w.latestVocabEntryId,headword:w.headword,primaryMeaning:w.selectedText,reason:"target_unavailable",
  }));
  const allowed={...source,words:source.words.filter(w=>usable.has(w.latestDatasetId))};
  const settings={questionCount:Math.max(1,allowed.words.length),englishToKoreanRatio:input.englishToKoreanRatio,
    timingMode:"none" as const,timeLimitSeconds:null,questionTimeLimitSeconds:null};
  const seed=practiceHash({sourceHash:source.sourceHash,selection:selection(input),ratio:input.englishToKoreanRatio});
  const diagnosis=buildMistakePracticePlan(allowed,settings,seed,{separateBanks:true});
  for(const omitted of diagnosis.excluded){
    const w=source.words.find(word=>word.key===omitted.key)!;
    unavailableItems.push({sourceQuestionId:w.sourceQuestionId,vocabEntryId:w.latestVocabEntryId,headword:w.headword,
      primaryMeaning:w.selectedText,reason:"direction_unavailable"});
  }
  const plan=buildMistakePracticePlan(allowed,{...settings,questionCount:Math.max(1,diagnosis.availableCount)},seed,{separateBanks:true});
  if(diagnosis.availableCount>0&&plan.error)throw new NotebookAssignmentError(422,plan.error);
  // Direction selection is seeded; the bank itself retains the source order.
  // Attempt creation applies ascending/descending/random once, from this order.
  const sourceOrder=new Map(source.words.map((word,index)=>[word.meaningKey,index]));
  const items=diagnosis.availableCount?[...plan.items].sort((a,b)=>sourceOrder.get(a.word.meaningKey)!-sourceOrder.get(b.word.meaningKey)!):[];
  const partition=splitMistakeAssignmentBanks(items,null);
  const counts=items.map(item=>source.words.find(w=>w.meaningKey===item.word.meaningKey)!.reasonLevel);
  const fingerprint=practiceHash({planVersion:"meaning-episode-v1",sourceHash:source.sourceHash,selection:selection(input),ratio:input.englishToKoreanRatio,items});
  return{source,plan:{...plan,items},banks:partition.banks,preview:{
    wrongEligible:items.length,wrongLevel1Eligible:counts.filter(v=>v===1).length,wrongLevel2Eligible:counts.filter(v=>v===2).length,
    candidateCount:source.words.length,unavailableCount:unavailableItems.length,unavailableItems,selectionFingerprint:fingerprint,
    banks:partition.banks.map(bank=>({questionCount:bank.questionCount,quizContentMode:bank.quizContentMode,englishToKoreanRatio:bank.englishToKoreanRatio})),
    planVersion:"meaning-episode-v1" as const,
  }};
}
export async function previewDirectMistakeAssignment(adminId:string,input:DirectReviewPreviewInput){return(await prepare(adminId,input)).preview;}
function result(value:unknown,input:DirectReviewAssignmentInput){
  const assignments=notebookAssignmentResultSchema.parse(value);
  if(assignments.some(a=>a.studentId!==input.studentId)||new Set(assignments.map(a=>a.assignmentId)).size!==assignments.length
    ||assignments.reduce((n,a)=>n+a.questionCount,0)!==input.totalQuestionCount)throw new NotebookAssignmentError(503,"배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
  return{kind:"mistake_batch" as const,assignments};
}
export async function saveDirectMistakeAssignment(adminId:string,input:DirectReviewAssignmentInput){
  const hash=practiceHash({operation:"direct-mistake-assignment-v1",input});
  const previous=await notebookAssignmentRpc("get_notebook_assignment_result_v1",{p_admin_id:adminId,p_request_key:input.idempotencyKey,p_request_hash:hash});
  if(previous!==null)return result(previous,input);
  try {
  const prepared=await prepare(adminId,input);
  if(prepared.preview.selectionFingerprint!==input.selectionFingerprint||prepared.preview.wrongEligible!==input.totalQuestionCount)
    throw new NotebookAssignmentError(409,"현재 오답 목록이 바뀌었습니다. 다시 확인해 주세요.","source_changed");
  if(prepared.preview.unavailableCount&&!input.excludeUnavailableConfirmed)throw new NotebookAssignmentError(422,"제외할 문항을 확인해 주세요.");
  const timingMode=input.timingMode??"total";
  const partition=splitMistakeAssignmentBanks(prepared.plan.items,timingMode==="total"?input.timeLimitSeconds:null);
  if(partition.error)throw new NotebookAssignmentError(422,partition.error);
  let questions:Awaited<ReturnType<typeof freezeMistakePracticeQuestions>>;
  try{questions=await freezeMistakePracticeQuestions(input.studentId,prepared,{kind:"admin",adminId});}
  catch(error){if(error instanceof PracticeError)throw new NotebookAssignmentError(error.status,error.message,error.code);throw error;}
  const bankIndex=new Map(partition.banks.flatMap(bank=>bank.items.map(item=>[item.word.meaningKey,bank.index] as const)));
  const settings={questionCount:input.totalQuestionCount,englishToKoreanRatio:input.englishToKoreanRatio,timingMode,
    timeLimitSeconds:timingMode==="total"?input.timeLimitSeconds:null,questionTimeLimitSeconds:timingMode==="per_question"?input.questionTimeLimitSeconds:null,
    passingScore:input.passingScore,retryEnabled:input.retryEnabled,retryPassingScore:input.retryPassingScore,title:input.title,
    questionOrderMode:input.questionOrderMode,availableFrom:input.availableFrom,availableUntil:input.availableUntil};
  if(input.availableUntil&&Date.parse(input.availableUntil)<=Date.now())throw new NotebookAssignmentError(422,"응시 마감은 현재보다 뒤로 정해 주세요.");
  return result(await notebookAssignmentRpc("create_book_mistake_assignments_v1",{
    p_admin_id:adminId,p_request_key:input.idempotencyKey,p_request_hash:hash,p_batches:[{
      studentId:input.studentId,selection:selection(input),sourceHash:prepared.source.sourceHash,settings,audienceMode:"single",gradeConfirmed:false,
      questions:questions.map(q=>({...q,bankIndex:bankIndex.get(q.meaningKey)})),
      banks:partition.banks.map(({index,questionCount,quizContentMode,englishToKoreanRatio,timeLimitSeconds})=>({index,questionCount,quizContentMode,englishToKoreanRatio,timeLimitSeconds})),
    }],
  }),input);
  } catch(error) {
    const saved=await notebookAssignmentRpc("get_notebook_assignment_result_v1",{p_admin_id:adminId,p_request_key:input.idempotencyKey,p_request_hash:hash});
    if(saved!==null)return result(saved,input);
    throw error;
  }
}

