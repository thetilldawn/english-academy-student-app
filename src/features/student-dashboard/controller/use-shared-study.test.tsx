// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act,cleanup,renderHook} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {packAssignmentStudy} from "../domain/study-materials";
import {useSharedStudy} from "./use-shared-study";
const m=vi.hoisted(()=>({read:vi.fn(),cache:vi.fn(),known:vi.fn(),request:vi.fn(),identity:"A",changed:null as ((kind:"identity")=>void)|null}));
vi.mock("@/features/quiz-player/public-local-client",()=>({readLocalDisplayAtoms:m.read,cacheLocalQuizContents:m.cache,knownLocalQuizContentKeys:m.known,requestLocalQuiz:m.request}));
vi.mock("@/features/session/public-client",()=>({studentIdentityGeneration:()=>m.identity,subscribeStudentPrivateCacheChanges:(f:typeof m.changed)=>{m.changed=f;return()=>{m.changed=null;};}}));
const word={key:"word-1",headword:"bank",meaning:"은행",definition:null,example:null,pronunciation:{available:false,audioUrl:null,displayKo:null,variantId:null}};
const study={assignmentId:"a5050000-0000-4000-8000-000000000100",title:"A 학생 배정",mode:"book_meaning_choice" as const,words:[word]};
let packed:Awaited<ReturnType<typeof packAssignmentStudy>>;
async function settle(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});}
beforeEach(async()=>{vi.resetAllMocks();vi.stubGlobal("crypto",webcrypto);m.identity="A";packed=await packAssignmentStudy(study);m.read.mockResolvedValue(new Map(packed.atoms.map(a=>[a.key,a])));m.known.mockResolvedValue([]);m.cache.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("공용 단어보기와 개인 배정의 경계",()=>{
  it("이미 가진 표시 자료는 다시 전송하지 않고 원래 배정·뜻을 복원한다",async()=>{
    const h=renderHook(()=>useSharedStudy(packed.manifest));await settle();expect(h.result.current.study).toMatchObject(study);expect(m.request).not.toHaveBeenCalled();
  });
  it("빠진 자료만 인증 조회한 뒤 같은 표시를 저장한다",async()=>{
    m.read.mockResolvedValueOnce(new Map());m.request.mockResolvedValue(packed);
    const h=renderHook(()=>useSharedStudy(packed.manifest));await settle();expect(h.result.current.study).toMatchObject(study);
    expect(m.request).toHaveBeenCalledExactlyOnceWith({action:"study",assignmentId:study.assignmentId,knownKeys:[]},expect.any(AbortSignal));expect(m.cache).toHaveBeenCalledWith({contents:[],atoms:packed.atoms});
  });
  it("계정 변경 뒤 다시 확인을 눌러도 이전 배정이나 제목을 캐시에서 되살리지 않는다",async()=>{
    const h=renderHook(()=>useSharedStudy(packed.manifest));await settle();
    act(()=>{m.identity="B";m.changed?.("identity");});expect(h.result.current.study).toBeNull();expect(h.result.current.blockedIdentity).toBe(true);
    act(()=>h.result.current.retry());await settle();expect(h.result.current.study).toBeNull();expect(m.read).toHaveBeenCalledTimes(1);expect(m.request).not.toHaveBeenCalled();
  });
  it("늦게 도착한 이전 학생의 자료는 계정 변경 후 표시하거나 저장하지 않는다",async()=>{
    m.read.mockResolvedValueOnce(new Map());let resolve!:(v:typeof packed)=>void;m.request.mockReturnValue(new Promise(r=>{resolve=r;}));
    const h=renderHook(()=>useSharedStudy(packed.manifest));await settle();act(()=>{m.identity="B";m.changed?.("identity");});
    await act(async()=>resolve(packed));expect(h.result.current.study).toBeNull();expect(m.cache).not.toHaveBeenCalled();expect(m.request.mock.calls[0][1].aborted).toBe(true);
  });
});
