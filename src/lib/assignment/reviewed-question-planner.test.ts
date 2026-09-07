import {describe,it,expect} from "vitest";
import {selectReviewedQuestionPlans,type ReviewedChoicePlan} from "./reviewed-question-planner";
const plans:ReviewedChoicePlan[]=[1,2,3,4,5].flatMap(id=>(["english_to_korean","korean_to_english"] as const).map(direction=>({vocab_entry_id:id,direction,choice_vocab_entry_ids:[id,101,102,103]})));
describe("reviewed question reuse",()=>{
  it.each([0,50,100] as const)("ratio %i preserves source order, choices and repeatability",ratio=>{
    const ids=[5,3,1];const result=selectReviewedQuestionPlans(ids,plans,ratio,"same");
    expect(result).toEqual(selectReviewedQuestionPlans(ids,plans,ratio,"same"));
    expect(result.map(x=>x.vocab_entry_id)).toEqual(ids);
    expect(result.map(x=>x.base_order_index)).toEqual([1,2,3]);
    expect(result.filter(x=>x.direction==="english_to_korean")).toHaveLength(Math.round(3*ratio/100));
    expect(result.every(x=>x.choice_vocab_entry_ids.join()===`${x.vocab_entry_id},101,102,103`)).toBe(true);
  });
  it("rejects missing, duplicate, and changed choice bindings",()=>{
    expect(()=>selectReviewedQuestionPlans([1,1],plans,100,"x")).toThrow();
    expect(()=>selectReviewedQuestionPlans([1],plans.slice(1),100,"x")).toThrow();
    expect(()=>selectReviewedQuestionPlans([1],[...plans,plans[0]],100,"x")).toThrow();
    expect(()=>selectReviewedQuestionPlans([1],[{...plans[0],choice_vocab_entry_ids:[101,102,103,104]}],100,"x")).toThrow();
  });
});
