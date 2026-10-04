import { describe, expect, it } from "vitest";
import { quizTimeBar } from "./quiz-time-bar";

describe("문제·전체 시간 막대", () => {
  it.each([[8000,"green"],[5000,"yellow"],[2500,"orange"],[1000,"red"]] as const)("%dms 남으면 %s", (left,tone) => {
    expect(quizTimeBar(left,10000,null)).toMatchObject({ visible:true,ratio:left/10000,tone,feedback:false });
  });
  it("마지막 3초이면서 빨간 구간일 때만 점멸한다", () => {
    expect(quizTimeBar(3000,60000,null).urgent).toBe(true);
    expect(quizTimeBar(3001,60000,null).urgent).toBe(false);
    expect(quizTimeBar(2000,5000,null).urgent).toBe(false);
    expect(quizTimeBar(0,10000,null).urgent).toBe(false);
  });
  it("피드백은 시간제한과 관계없이 꽉 찬 초록 또는 빨강을 유지한다", () => {
    expect(quizTimeBar(100,10000,true)).toMatchObject({ratio:1,tone:"green",urgent:false,feedback:true});
    expect(quizTimeBar(Infinity,null,false)).toMatchObject({visible:true,ratio:1,tone:"red",urgent:false});
    expect(quizTimeBar(Infinity,null,null).visible).toBe(false);
  });
});
