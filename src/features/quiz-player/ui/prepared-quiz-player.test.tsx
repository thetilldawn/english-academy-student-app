// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act,cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { PreparedQuizPlayer } from "./prepared-quiz-player";
import type { PreparedQuiz } from "../contracts/preparation";
const mocks=vi.hoisted(()=>({replace:vi.fn(),read:vi.fn(),answer:vi.fn(),feedback:vi.fn(),expire:vi.fn(),fetch:vi.fn()}));
const router={replace:mocks.replace};
vi.mock("next/navigation",()=>({useRouter:()=>router}));
vi.mock("../api/quiz-transport",()=>({
  regularQuizTransport:{read:mocks.read,answer:mocks.answer,feedback:mocks.feedback,expire:mocks.expire,resultHref:(id:string)=>"/student/result/"+id},
  practiceQuizTransport:{read:mocks.read,answer:mocks.answer,feedback:mocks.feedback,expire:mocks.expire,resultHref:(id:string)=>"/student/practice/"+id+"/result"},
}));
vi.mock("../controller/use-quiz-audio",()=>({useQuizAudio:()=>({playAudio:()=>{},stopAudio:()=>{}})}));
const voice={displayKo:null,audioUrl:null,available:false,variantId:null};
const preparation:PreparedQuiz={id:"prepared-1",kind:"initial",assignmentTitle:"Fake prepared exam",quizContentMode:"book_meaning_choice",phase:"initial",
  timingMode:"per_question",questionTimeLimitSeconds:5,currentQuestionId:"q1",questions:[{id:"q1",orderIndex:1,direction:"english_to_korean",prompt:"apple",
    choices:["사과","배","포도","오렌지"],pronunciation:voice,choicePronunciations:[voice,voice,voice,voice],initialChoiceIndex:null,initialIsCorrect:null,
    retryChoiceIndex:null,retryIsCorrect:null,initialTimedOut:false,retryTimedOut:false,priorWrongLevel:0,revealedCorrectChoiceIndex:null}]};
const clock={id:"prepared-1",phase:"initial",status:"in_progress",startedAt:"2099-01-01T00:00:00Z",deadlineAt:"2099-01-01T00:04:00Z",
  timerDeadlineAt:"2099-01-01T00:00:05Z",currentQuestionId:"q1",questionIds:["q1"],timerRemainingMilliseconds:5000};
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();vi.stubGlobal("fetch",mocks.fetch);
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({width:620,height:620,x:0,y:0,top:0,left:0,bottom:620,right:620,toJSON:()=>({})});
  mocks.fetch.mockResolvedValue({ok:true,json:async()=>clock});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
describe("first prepared exam display",()=>{
  it.each([false,undefined])("keeps an unconfirmed terminal preparation recoverable (%s)",async completionConfirmed=>{
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({...clock,status:"expired",phase:"completed",currentQuestionId:null,completionConfirmed})});
    render(<PreparedQuizPlayer preparation={{...preparation,kind:"practice"}}/>);await advance(32);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("시험을 준비하지 못했습니다. 다시 확인해 주세요.");
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({...clock,status:"expired",phase:"completed",currentQuestionId:null,completionConfirmed:true})});
    fireEvent.click(screen.getByRole("button",{name:"다시 확인"}));await advance(32);
    expect(mocks.replace).toHaveBeenCalledWith("/student/practice/prepared-1/result");
  });
  it("mounts the actual inactive frame before two frames, then starts once without another heavy read",async()=>{
    render(<StrictMode><PreparedQuizPlayer preparation={preparation}/></StrictMode>);
    const prompt=document.querySelector("[data-question-id='q1']");
    expect(prompt).not.toBeNull();expect(screen.queryByRole("heading",{name:"apple"})).toBeNull();
    expect(screen.getByText("시험 준비 중")).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();await advance(16);expect(mocks.fetch).not.toHaveBeenCalled();
    await advance(16);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.read).not.toHaveBeenCalled();
    expect(screen.queryByText("시험 준비 중")).toBeNull();
    expect(document.querySelector("[data-question-id='q1']")).toBe(prompt);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:05");
    expect(screen.getByRole("button",{name:/1.*사과/})).toBeEnabled();
    fireEvent(document,new Event("visibilitychange"));await advance(100);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("blocks answer, expiry and keyboard during a long ready response",async()=>{
    let finish!:(value:unknown)=>void;mocks.fetch.mockReturnValue(new Promise(r=>{finish=r;}));
    render(<PreparedQuizPlayer preparation={preparation}/>);await advance(5_000);
    fireEvent.click(screen.getByText("사과"));fireEvent.keyDown(document.querySelector("section")!,{key:"1"});
    expect(mocks.answer).not.toHaveBeenCalled();expect(mocks.expire).not.toHaveBeenCalled();
    await act(async()=>{finish({ok:true,json:async()=>clock});});
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:05");
  });
  it("does not start a background tab until it becomes visible",async()=>{
    const visibility=vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
    render(<PreparedQuizPlayer preparation={preparation}/>);await advance(1000);expect(mocks.fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");fireEvent(document,new Event("visibilitychange"));await advance(32);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, {jsonError:true}])("uses a short safe error, not parser internals",async bad=>{
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>{if("jsonError" in bad)throw new SyntaxError("internal JSON detail");return bad;}});
    render(<PreparedQuizPlayer preparation={preparation}/>);await advance(32);
    expect(screen.getByRole("alert")).toHaveTextContent("시험을 준비하지 못했습니다. 다시 확인해 주세요.");
    expect(document.body).not.toHaveTextContent("internal JSON detail");expect(mocks.expire).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>clock});fireEvent.click(screen.getByRole("button",{name:"다시 확인"}));await advance(32);
    expect(screen.queryByRole("alert")).toBeNull();expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("resumes the actual run instead of merging fresh practice answers over an existing run",async()=>{
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({...clock,id:"actual",questionIds:["actual-q1"],currentQuestionId:"actual-q2"})});
    render(<PreparedQuizPlayer preparation={{...preparation,kind:"practice"}}/>);await advance(32);
    expect(mocks.replace).toHaveBeenCalledWith("/student/practice/actual");
  });
  it("does not retry a preparation that is confirmed expired or changed",async()=>{
    mocks.fetch.mockResolvedValue({ok:false,status:409,json:async()=>({code:"preparation_changed"})});
    render(<PreparedQuizPlayer preparation={preparation}/>);await advance(32);
    expect(screen.getByRole("alert")).toHaveTextContent("목록에서 다시 시작");
    expect(screen.queryByRole("button",{name:"다시 확인"})).toBeNull();
    expect(screen.getByRole("link",{name:"목록으로"})).toHaveAttribute("href","/student");
    fireEvent(document,new Event("visibilitychange"));await advance(1000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a changed phase out of the prepared initial frame",async()=>{
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({...clock,phase:"retry"})});
    render(<PreparedQuizPlayer preparation={preparation}/>);await advance(32);
    expect(mocks.replace).toHaveBeenCalledWith("/student/attempt/prepared-1");
  });
  it.each([false,true])("keeps later waiting and recovery separate from first preparation, failure=%s",async failure=>{
    const prepared={...preparation,questions:[...preparation.questions,{...preparation.questions[0],id:"q2",orderIndex:2,prompt:"pear"}]};
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({...clock,questionIds:["q1","q2"]})});
    const success=(payload:unknown)=>({ok:true,payload,receivedAt:performance.now(),requestElapsedMilliseconds:0});
    mocks.answer.mockImplementation(async()=>success({correct:true,correctChoiceIndex:0,nextQuestionId:"q2",nextPhase:"initial",feedbackProtocol:"variable",questionDeadlineAt:clock.timerDeadlineAt,timerRemainingMilliseconds:12000}));
    let finish!:(v:unknown)=>void;mocks.feedback.mockReturnValue(new Promise(r=>{finish=r;}));
    mocks.read.mockImplementation(async()=> failure ? {ok:false,payload:{}} : success({
      attempt:{...prepared,...clock,questions:prepared.questions.map((q,i)=>i===0?{...q,initialChoiceIndex:0,initialIsCorrect:true,revealedCorrectChoiceIndex:0}:q),currentQuestionId:"q2"},
      timerRemainingMilliseconds:5500,transitionRemainingMilliseconds:500,
    }));
    render(<PreparedQuizPlayer preparation={prepared}/>);await advance(32);
    fireEvent.click(screen.getByRole("button",{name:/1.*사과/}));await advance(120);
    expect(screen.getByText("다음 문제 준비 중")).toBeInTheDocument();
    expect(screen.queryByText("시험 준비 중")).toBeNull();
    if(!failure)mocks.feedback.mockImplementationOnce(async()=>({ok:false,payload:{}}))
      .mockImplementation(async()=>success({questionDeadlineAt:clock.timerDeadlineAt,questionStartsAt:clock.startedAt,
        timerRemainingMilliseconds:5500,transitionRemainingMilliseconds:500}));
    await act(async()=>{finish({ok:false,payload:{}});});
    if(failure){
      expect(screen.queryByText("시험 준비 중")).toBeNull();
      expect(screen.getByRole("button",{name:"다시 시도"})).toBeEnabled();
    }else{
      await advance(499);expect(screen.getByText("다음 문제 준비 중")).toBeInTheDocument();
      expect(screen.queryByRole("heading",{name:"pear"})).toBeNull();
      await advance(1);expect(screen.queryByText("다음 문제 준비 중")).toBeNull();
      expect(screen.getByRole("heading",{name:"pear"})).toBeInTheDocument();
    }
  });
});

