import { beforeEach, expect, it, vi } from "vitest";
import type { DirectReviewAssignmentInput } from "@/lib/admin/direct-review-assignment-request";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
const mocks=vi.hoisted(()=>({candidates:vi.fn(),pool:vi.fn(),label:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("./direct-review-candidate-service",async original=>({...await original<typeof import("./direct-review-candidate-service")>(),listStudentDirectReviewCandidates:mocks.candidates}));
vi.mock("./eligible-vocabulary-service",()=>({loadEligibleVocabularyDataset:mocks.pool}));
vi.mock("./dataset-catalog-service",()=>({loadDatasetDisplayLabel:mocks.label}));
import { calculateDirectReviewPreview, prepareDirectReviewAssignmentBatch } from "./direct-review-preparation-service";
const studentId="11111111-1111-4111-8111-111111111111",datasetId="22222222-2222-4222-8222-222222222222";
const input={studentId,datasetId,reviewLevels:[1,2] as (1|2)[],englishToKoreanRatio:50 as const};
const pool:EligibleVocabularyEntry[]=Array.from({length:6},(_,index)=>({id:index+1,unitId:"fake-unit",sourceRow:index+1,headword:`word-${index}`,headwordNormalized:`word-${index}`,primaryMeaning:`뜻${index}`,canonicalDictionaryId:`dictionary-${index}`,canonicalLexemeId:`lexeme-${index}`,canonicalKey:`dictionary-${index}`,recordType:"word",eligibleDirections:index===1?["english_to_korean"]:["english_to_korean","korean_to_english"]}));
const candidates=pool.slice(0,2).map((e,index)=>({sourceQuestionId:`33333333-3333-4333-8333-${String(index+1).padStart(12,"0")}`,datasetId,vocabEntryId:e.id,canonicalDictionaryId:e.canonicalDictionaryId,canonicalLexemeId:e.canonicalLexemeId,headwordNormalized:e.headwordNormalized,reasonLevel:1,wrongCount:1,lastWrongAt:"2026-09-21T00:00:00Z"}));
const student={id:studentId,status:"active",display_name:"가짜 학생",school_name:"가짜고",grade_label:"고2"};
const dataset={id:datasetId,title:"가짜 단어장",edition:null,status:"ready",is_active:true};
let material:string;
function client(errorCode?:string) {
  const rpc=vi.fn().mockImplementation(async()=>({data:errorCode?null:material,error:errorCode?{code:errorCode}:null}));
  return {rpc,from:(table:string)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==="students"?student:dataset,error:null})})})})} as unknown as NonNullable<Parameters<typeof calculateDirectReviewPreview>[2]>;
}
const admin={userId:"44444444-4444-4444-8444-444444444444"} as NonNullable<Parameters<typeof calculateDirectReviewPreview>[1]>;
function assignment(fingerprint:string):DirectReviewAssignmentInput {
  return {...input,title:"가짜 오답",totalQuestionCount:1,selectionFingerprint:fingerprint,excludeUnavailableConfirmed:true,
    idempotencyKey:"55555555-5555-4555-8555-555555555555",passingScore:80,retryEnabled:true,retryPassingScore:80,questionOrderMode:"ascending",timeLimitSeconds:300,timingMode:"total",questionTimeLimitSeconds:null,availableFrom:null,availableUntil:null};
}
beforeEach(()=>{material="a".repeat(64);mocks.candidates.mockResolvedValue(candidates);mocks.pool.mockResolvedValue(pool);mocks.label.mockResolvedValue("가짜 단어장");});
it("diagnoses the mixed preview and rejects an unconfirmed partial save",async()=>{
  const supabase=client();
  const preview=await calculateDirectReviewPreview(input,admin,supabase);
  expect(preview).toMatchObject({candidateCount:2,wrongEligible:1,unavailableCount:1,wrongLevel1Eligible:1});
  expect(preview.unavailableItems[0]).toMatchObject({vocabEntryId:2,reason:"direction_unavailable"});
  await expect(prepareDirectReviewAssignmentBatch({...assignment(preview.selectionFingerprint),excludeUnavailableConfirmed:false},admin,supabase)).rejects.toMatchObject({reason:"invalid_selection",fieldPath:"preview"});
  const prepared=await prepareDirectReviewAssignmentBatch(assignment(preview.selectionFingerprint),admin,supabase);
  expect(prepared.sourceQuestionIds).toEqual([candidates[0].sourceQuestionId]);
  expect(prepared.expectedSourceQuestionIds).toEqual(candidates.map(c=>c.sourceQuestionId));
  expect(prepared.excludedSourceQuestionIds).toEqual([candidates[1].sourceQuestionId]);
  expect(supabase.rpc).toHaveBeenCalledWith("get_current_wrong_review_material_fingerprint_v1",expect.objectContaining({p_source_question_ids:candidates.map(c=>c.sourceQuestionId)}));
});
it("rejects the same-count preview after either sources or material change",async()=>{
  const supabase=client();const preview=await calculateDirectReviewPreview(input,admin,supabase);
  material="b".repeat(64);
  await expect(prepareDirectReviewAssignmentBatch(assignment(preview.selectionFingerprint),admin,supabase)).rejects.toMatchObject({reason:"conflict"});
  material="a".repeat(64);
  mocks.candidates.mockResolvedValue([{...candidates[0],sourceQuestionId:"33333333-3333-4333-8333-000000000099"},candidates[1]]);
  await expect(prepareDirectReviewAssignmentBatch(assignment(preview.selectionFingerprint),admin,supabase)).rejects.toMatchObject({reason:"conflict"});
});
it("keeps all-unavailable distinct from no candidates and preserves permission failures",async()=>{
  mocks.candidates.mockResolvedValue([candidates[1]]);
  const preview=await calculateDirectReviewPreview(input,admin,client());
  expect(preview).toMatchObject({candidateCount:1,wrongEligible:0,unavailableCount:1});
  await expect(calculateDirectReviewPreview(input,admin,client("42501"))).rejects.toMatchObject({reason:"forbidden"});
});
