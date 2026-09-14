import { describe, expect, it } from "vitest";
import { compositionExclusionPredicate, uniqueCompositionTargets, assertUniqueCompositionTargets } from "@/lib/assignment/composition-targets";
import { buildAssignmentQuestionPlan, calculateAssignmentQuestionRange } from "@/lib/assignment/question-planner";
import { resolveReviewCandidate } from "@/lib/admin/review-candidate";
const a='a'.repeat(64), b='b'.repeat(64);
const words=[1,2,3,4].map(id=>({id,headword:`fake${id}`,primaryMeaning:`가짜뜻${id}`,compositionTargetKey:id===1?a:undefined}));
const june=[...words.map(w=>({...w,id:w.id+4})),{id:9,headword:'fake1',primaryMeaning:'다른품사',compositionTargetKey:b}];
describe("scope first, reviewed identity second",()=>{
  it("excludes the same reviewed meaning under another source ID without excluding another POS or an unreviewed occurrence",()=>{
    const isExcluded = compositionExclusionPredicate([...words,...june],new Set([1,2]));
    expect([words[0]!,words[1]!,june[0]!].every(isExcluded)).toBe(true);
    expect(isExcluded(june[1]!)).toBe(false);
    expect(isExcluded(june[4]!)).toBe(false);
  });
  it("March, June, and both retain the word in the selected source",()=>{
    expect(uniqueCompositionTargets(words).map(w=>w.id)).toContain(1);
    expect(uniqueCompositionTargets(june).map(w=>w.id)).toContain(5);
    expect(uniqueCompositionTargets([...words,...june]).map(w=>w.id)).toEqual([1,2,3,4,6,7,8,9]);
  });
  it("keeps different POS/senses and unreviewed same-headword occurrences",()=>{
    expect(uniqueCompositionTargets([{...words[0]!,id:1},{...words[0]!,id:2,compositionTargetKey:b},{...words[0]!,id:3,compositionTargetKey:undefined}])).toHaveLength(3);
  });
  it("preserves required IDs and rejects duplicates in exact review instead of replacing IDs",()=>{
    expect(uniqueCompositionTargets(words,[june[0]!]).map(w=>w.id)).toEqual([2,3,4]);
    expect(()=>assertUniqueCompositionTargets([words[0]!,june[0]!])).toThrow('두 번');
    expect(()=>assertUniqueCompositionTargets(june)).not.toThrow();
  });
  it("uses the same reviewed target count in preview and save",()=>{
    const candidates=[...words,{...words[0]!,id:5}];
    const input={requiredTargets:[],primaryCandidates:candidates,allCandidates:candidates,englishToKoreanRatio:100 as const};
    expect(calculateAssignmentQuestionRange(input).maximumQuestionCount).toBe(4);
    const questions=buildAssignmentQuestionPlan({...input,questionCount:4,targetSelectionMode:'source_order'});
    expect(questions.map(q=>q.vocabEntryId)).toEqual([1,2,3,4]);
    expect(()=>buildAssignmentQuestionPlan({...input,questionCount:5})).toThrow();
  });
  it("retains a different reviewed meaning of a required headword in Korean prompts",()=>{
    const required={id:1,headword:'light',primaryMeaning:'빛',compositionTargetKey:a};
    const primary=[{id:2,headword:'light',primaryMeaning:'가벼운',compositionTargetKey:b},...words.slice(1).map(w=>({...w,id:w.id+1}))];
    const input={requiredTargets:[required],primaryCandidates:primary,allCandidates:[required,...primary],englishToKoreanRatio:0 as const};
    expect(calculateAssignmentQuestionRange(input).maximumQuestionCount).toBe(5);
    expect(new Set(buildAssignmentQuestionPlan({...input,questionCount:5,targetSelectionMode:'source_order'}).map(q=>q.vocabEntryId))).toEqual(new Set([1,2,3,4,5]));
  });
  it("never rebinds a review word to a different meaning merely because the dictionary matches",()=>{
    const candidates=[{id:1,headword:'light',primaryMeaning:'빛',compositionTargetKey:a,unitId:'march'},
      {id:2,headword:'light',primaryMeaning:'가벼운',compositionTargetKey:b,unitId:'june'}].map(c=>({...c,sourceRow:c.id,headwordNormalized:c.headword,canonicalLexemeId:null,canonicalDictionaryId:'word:light'}));
    const review={vocabEntryId:1,canonicalDictionaryId:'word:light',canonicalLexemeId:null};
    expect(resolveReviewCandidate(candidates,review,'selection',new Set(['june']))).toBeUndefined();
    expect(resolveReviewCandidate(candidates,review,'dataset',new Set())?.id).toBe(1);
    expect(resolveReviewCandidate(candidates.slice(1),review,'dataset',new Set())).toBeUndefined();
  });
});

