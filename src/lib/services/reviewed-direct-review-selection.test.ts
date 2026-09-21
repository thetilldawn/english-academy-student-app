import {describe,it,expect} from "vitest";
import {buildReviewedDirectReviewSelection, diagnoseReviewedDirectReviewSelection} from "./reviewed-direct-review-selection";
import type {DirectReviewCandidate} from "@/lib/admin/direct-review-candidate";
const input={studentId:"student",datasetId:"dataset",reviewLevels:[1,2] as (1|2)[],englishToKoreanRatio:50 as const};
const candidates:DirectReviewCandidate[]=[1,2,3].map(id=>({sourceQuestionId:`question-${id}`,datasetId:"dataset",vocabEntryId:id,canonicalDictionaryId:null,canonicalLexemeId:null,headwordNormalized:`fake-${id}`,reasonLevel:id===1?1:2,wrongCount:1,lastWrongAt:null}));
const rows=candidates.flatMap(c=>["english_to_korean","korean_to_english"].map(direction=>({vocab_entry_id:c.vocabEntryId,direction,choice_vocab_entry_ids:[c.vocabEntryId,101,102,103]})));
describe("reviewed direct wrong words",()=>{
  it("diagnoses missing and single-direction candidates without blocking the usable one", () => {
    const diagnosis = diagnoseReviewedDirectReviewSelection(input,candidates,rows.filter(row => row.vocab_entry_id===1 || (row.vocab_entry_id===2 && row.direction==="english_to_korean")));
    expect(diagnosis.eligibleCandidates.map(c=>c.vocabEntryId)).toEqual([1]);
    expect(diagnosis.unavailableItems.map(c=>c.reason)).toEqual(["direction_unavailable","target_unavailable"]);
  });
  it("rejects corrupt repeated source identities instead of treating them as exclusions", () => {
    expect(()=>diagnoseReviewedDirectReviewSelection(input,[candidates[0],candidates[0]],rows)).toThrow();
  });
  it.each([[100,"english_to_korean"],[0,"korean_to_english"]] as const)("accepts the only available direction at ratio %i",(ratio,direction)=>{
    const fixed=rows.filter(r=>r.direction===direction);
    const result=buildReviewedDirectReviewSelection({...input,englishToKoreanRatio:ratio},candidates,fixed);
    expect(result.questions).toHaveLength(3);expect(result.questions.every(q=>q.direction===direction)).toBe(true);
    expect(()=>buildReviewedDirectReviewSelection(input,candidates,fixed)).toThrow();
  });
  it("keeps all selected small-count source links and exact level totals",()=>{
    const result=buildReviewedDirectReviewSelection(input,candidates,rows);
    expect(result.sourceQuestionIds).toEqual(candidates.map(c=>c.sourceQuestionId));
    expect(result).toMatchObject({wrongLevel1Eligible:1,wrongLevel2Eligible:2});
    expect(result.questions).toHaveLength(3);
  });
  it("does not accept another dataset, duplicate word or missing stored direction",()=>{
    expect(()=>buildReviewedDirectReviewSelection(input,[{...candidates[0],datasetId:"other"}],rows)).toThrow();
    expect(()=>buildReviewedDirectReviewSelection(input,[candidates[0],{...candidates[1],headwordNormalized:candidates[0].headwordNormalized}],rows)).toThrow();
    expect(()=>buildReviewedDirectReviewSelection(input,candidates,rows.slice(1))).toThrow();
  });
});
