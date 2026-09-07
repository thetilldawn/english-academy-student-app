import "server-only";
import { z } from "zod";
import type { QuizContentMode } from "@/lib/quiz/question-content-mode";
import { selectReviewedQuestionPlans } from "@/lib/assignment/reviewed-question-planner";
import { reviewedChoicePlanRowSchema } from "./reviewed-direct-review-selection";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AssignmentReplacementError } from "./assignment-replacement-errors";

export async function reviewedReplacementMode(datasetId:string,sourceDatasetId:string,sourceMode?:QuizContentMode):Promise<QuizContentMode|null>{
  if(datasetId===sourceDatasetId) return sourceMode??null;
  const client=await createServerSupabaseClient();
  const {data,error}=await client.from("vocab_datasets").select("metadata").eq("id",datasetId).maybeSingle();
  if(error || !data) throw new AssignmentReplacementError("database");
  if(data.metadata?.questionBankKind==="reviewed_exam_v1") return sourceMode??"book_meaning_choice";
  if(sourceMode && sourceMode!=="book_meaning_choice") throw new AssignmentReplacementError("invalid_selection","선택한 단어장에는 이 방향으로 검토된 문제가 없습니다. 다른 단어장을 선택해 주세요.");
  return null;
}

export async function loadReviewedReplacementPlan(input:{datasetId:string;primaryUnitIds:readonly string[];englishToKoreanRatio:0|50|100;questionCount?:number},mode:QuizContentMode){
  if((mode==="canonical_definition_to_headword" && input.englishToKoreanRatio!==0) || (mode==="canonical_headword_to_definition" && input.englishToKoreanRatio!==100)) throw new AssignmentReplacementError("invalid_selection","이 출제 자료에 맞는 시험 방향을 유지해 주세요.");
  const client=await createServerSupabaseClient();
  const entries:{id:number;unit_id:string;source_row:number}[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await client.from("vocab_entries").select("id,unit_id,source_row").eq("dataset_id",input.datasetId).in("unit_id",[...input.primaryUnitIds]).order("source_row").range(offset,offset+999);
    if(error || !Array.isArray(data)) throw new AssignmentReplacementError("database");
    entries.push(...data); if(data.length<1000) break;
  }
  const rank=new Map(input.primaryUnitIds.map((id,i)=>[id,i]));
  entries.sort((a,b)=>(rank.get(a.unit_id)??Infinity)-(rank.get(b.unit_id)??Infinity)||a.source_row-b.source_row);
  const plans:z.infer<typeof reviewedChoicePlanRowSchema>[]=[];
  for(let offset=0;offset<entries.length;offset+=500){
    const {data,error}=await client.rpc("list_reviewed_exam_review_choices_v1",{p_dataset_id:input.datasetId,p_vocab_entry_ids:entries.slice(offset,offset+500).map(e=>e.id),p_quiz_mode:mode});
    const parsed=z.array(reviewedChoicePlanRowSchema).safeParse(data);
    if(error || !parsed.success) throw new AssignmentReplacementError("database");
    plans.push(...parsed.data);
  }
  const directions=input.englishToKoreanRatio===100?["english_to_korean"]:input.englishToKoreanRatio===0?["korean_to_english"]:["english_to_korean","korean_to_english"];
  const keys=new Set(plans.map(p=>`${p.vocab_entry_id}:${p.direction}`));
  const eligible=entries.filter(e=>directions.every(d=>keys.has(`${e.id}:${d}`)));
  const maximum=Math.min(500,eligible.length);
  if(maximum<4 || (input.questionCount!==undefined && (input.questionCount<4 || input.questionCount>maximum))) throw new AssignmentReplacementError("invalid_selection",`이 범위는 선택한 출제 자료로 최대 ${maximum}개까지 배정할 수 있습니다.`);
  const questions=selectReviewedQuestionPlans(eligible.slice(0,input.questionCount??maximum).map(e=>e.id),plans,input.englishToKoreanRatio,`${input.datasetId}:${mode}:${input.primaryUnitIds.join(":")}`);
  return {maximum,questions};
}
