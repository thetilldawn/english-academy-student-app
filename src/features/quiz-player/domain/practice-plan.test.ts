import { describe, expect, it } from "vitest";
import { buildPracticePlan, type PracticeSource } from "./practice-plan";
import { practicePreviewInputSchema, practiceSettingsSchema, type PracticeSettings } from "../contracts/practice";
const dataset="00000000-0000-4000-8000-000000000001";
const settings=(questionCount=4,englishToKoreanRatio:0|50|100=50):PracticeSettings=>({questionCount,englishToKoreanRatio,timingMode:"none",timeLimitSeconds:null,questionTimeLimitSeconds:null});
const source=(count=4):PracticeSource=>({sourceHash:"a".repeat(64),words:Array.from({length:count},(_,i)=>({key:`word:${i}`,latestVocabEntryId:i+1,headword:`word${String.fromCharCode(97+Math.floor(i/26),97+i%26)}`,primaryMeaning:`검사 의미 ${i}`,wrongCount:i+1,choiceSafety:null})),
  candidates:Array.from({length:Math.max(4,count)},(_,i)=>({entryId:i+1,datasetId:dataset,headword:`word${String.fromCharCode(97+Math.floor(i/26),97+i%26)}`,primaryMeaning:`검사 의미 ${i}`,displayKo:null,eligibleDirections:["english_to_korean","korean_to_english"],choiceSafety:null}))});
describe("자율연습 출제 계획",()=>{
  it.each([0,501,-1,1.5])("잘못된 문항수 %s는 조용히 잘라내지 않고 거절한다",count=>{
    expect(()=>buildPracticePlan(source(),settings(count),"seed")).toThrow();
  });
  it.each([1,3,4,500])("%s문항은 고정 원문·4개 보기·같은 미리보기를 만든다",count=>{
    const input=source(count),first=buildPracticePlan(input,settings(count),"seed");
    expect(first.error).toBeNull();expect(first.questions).toHaveLength(count);
    expect(first.questions.filter(q=>q.direction==="english_to_korean")).toHaveLength(Math.round(count/2));
    expect(first.questions.every(q=>new Set(q.choices).size===4)).toBe(true);
    expect(buildPracticePlan(input,settings(count),"seed").questions).toEqual(first.questions);
  });
  it("화면 첫10개가 아닌 전체 조건 후보를 사용한다",()=>{
    const plan=buildPracticePlan(source(25),settings(25),"seed");expect(plan.questions).toHaveLength(25);expect(plan.totalCount).toBe(25);
  });
  it("과거 뜻을 현재 후보의 다른 뜻으로 바꾸지 않는다",()=>{
    const input=source(1);input.words[0].primaryMeaning="과거 원뜻";
    const plan=buildPracticePlan(input,settings(1,100),"seed"),question=plan.questions[0];
    expect(question.choices[question.correctChoiceIndex]).toBe("과거 원뜻");
  });
  it("0개와 검토된 방향 없음·다른 보기 부족을 구별한다",()=>{
    expect(buildPracticePlan(source(0),settings(1),"seed").error).toBe("조건에 맞는 단어가 없습니다.");
    const input=source(1);input.candidates=[];
    expect(buildPracticePlan(input,settings(1),"seed").excluded[0].reason).toContain("출제 방향");
    input.candidates=source(1).candidates.slice(0,2);
    expect(buildPracticePlan(input,settings(1),"seed").excluded[0].reason).toContain("보기");
  });
  it("과거 뜻과 다른 현재 검토 정책을 삭제해서 출제하지 않는다",()=>{
    const input=source(1);input.words[0].choiceSafety={version:"reviewed-choice-conflicts-v1",evidenceSha256:"b".repeat(64),
      target:{headword:input.words[0].headword,primaryMeaning:"현재 다른 뜻"},exclusions:[]};
    const plan=buildPracticePlan(input,settings(1),"seed");expect(plan.excluded[0].reason).toContain("과거 뜻");expect(plan.questions).toEqual([]);
  });
  it("방향 부족 때문에 요청 비율을 만들 수 없으면 이유를 표시한다",()=>{
    const input=source();input.candidates.forEach(entry=>{entry.eligibleDirections=["english_to_korean"];});
    expect(buildPracticePlan(input,settings(4,50),"seed").error).not.toBeNull();
    expect(buildPracticePlan(input,settings(4,100),"seed").questions).toHaveLength(4);
  });
  it("학생ID·정답·중복키와 비정상 시간 설정을 입력에서 거절한다",()=>{
    expect(practicePreviewInputSchema.safeParse({requestKey:dataset,selection:{mode:"selected",keys:["a","a"]},settings:settings()}).success).toBe(false);
    expect(practicePreviewInputSchema.safeParse({requestKey:dataset,selection:{mode:"filtered",filters:{}},settings:settings(),studentId:dataset}).success).toBe(false);
    expect(practiceSettingsSchema.safeParse({...settings(),timingMode:"total"}).success).toBe(false);
    expect(practiceSettingsSchema.safeParse({...settings(),timingMode:"per_question",questionTimeLimitSeconds:4}).success).toBe(false);
  });
});
