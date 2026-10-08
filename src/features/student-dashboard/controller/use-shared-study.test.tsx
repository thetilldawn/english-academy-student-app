// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act,cleanup,renderHook} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {packAssignmentStudy} from "../domain/study-materials";
import {useSharedStudy} from "./use-shared-study";
const m=vi.hoisted(()=>({read:vi.fn(),cache:vi.fn(),known:vi.fn(),remember:vi.fn(),request:vi.fn(),identity:"A",changed:null as ((kind:"identity")=>void)|null}));
vi.mock("@/features/quiz-player/public-local-client",()=>({readLocalDisplayAtoms:m.read,cacheLocalQuizContents:m.cache,knownLocalQuizAssignmentKeys:m.known,rememberLocalQuizMaterials:m.remember,requestLocalQuiz:m.request}));
vi.mock("@/features/session/public-client",()=>({studentIdentityGeneration:()=>m.identity,subscribeStudentPrivateCacheChanges:(f:typeof m.changed)=>{m.changed=f;return()=>{m.changed=null;};}}));
const word={key:"word-1",headword:"bank",meaning:"은행",definition:null,example:null,pronunciation:{available:false,audioUrl:null,displayKo:null,variantId:null}};
const study={assignmentId:"a5050000-0000-4000-8000-000000000100",title:"A 학생 배정",mode:"book_meaning_choice" as const,words:[word]};
const access={assignmentId:study.assignmentId,studentId:"a5050000-0000-4000-8000-000000000001",title:study.title,mode:study.mode,revision:"a".repeat(32)};
let packed:Awaited<ReturnType<typeof packAssignmentStudy>>;
async function settle(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});}
beforeEach(async()=>{vi.resetAllMocks();vi.stubGlobal("crypto",webcrypto);m.identity=crypto.randomUUID();packed=await packAssignmentStudy(study);m.read.mockResolvedValue(new Map(packed.atoms.map(a=>[a.key,a])));m.known.mockResolvedValue([]);m.cache.mockResolvedValue(undefined);m.request.mockResolvedValue({...packed,access});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("공용 단어보기와 개인 배정의 경계",()=>{
  it("48시간 만료 또는 배정판 변경이면 공용 본문이 남아 있어도 목록을 다시 받는다",async()=>{
    const first=renderHook(()=>useSharedStudy(access));await settle();first.unmount();
    const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+48*60*60*1000);
    const expired=renderHook(()=>useSharedStudy(access));await settle();expect(m.request).toHaveBeenCalledTimes(2);expired.unmount();
    const changed={...access,revision:"b".repeat(32)};m.request.mockResolvedValue({...packed,access:changed});
    const next=renderHook(()=>useSharedStudy(changed));await settle();expect(next.result.current.study).toMatchObject(study);expect(m.request).toHaveBeenCalledTimes(3);
  });
  it("저장한 목록의 본문이 지워지면 필요한 자료를 다시 받고 잠김 응답은 분리한다",async()=>{
    const first=renderHook(()=>useSharedStudy(access));await settle();first.unmount();
    m.read.mockResolvedValueOnce(new Map());
    const repaired=renderHook(()=>useSharedStudy(access));await settle();expect(repaired.result.current.study).toMatchObject(study);expect(m.request).toHaveBeenCalledTimes(2);repaired.unmount();
    m.read.mockResolvedValueOnce(new Map());m.request.mockResolvedValue({locked:{assignmentId:access.assignmentId,studentId:access.studentId,title:access.title,mode:access.mode,release:{state:"held",opensAt:null,hasDeadline:false}}});
    const locked=renderHook(()=>useSharedStudy(access));await settle();expect(locked.result.current.study).toBeNull();expect(locked.result.current.locked?.release.state).toBe("held");expect(locked.result.current.error).toBe("");
  });
  it("최초 본문은 한번 받고 같은 배정을 다시 열면 저장한 표시만 복원한다",async()=>{
    const h=renderHook(()=>useSharedStudy(access));await settle();expect(h.result.current.study).toMatchObject(study);h.unmount();
    const again=renderHook(()=>useSharedStudy(access));await settle();expect(again.result.current.study).toMatchObject(study);expect(m.request).toHaveBeenCalledTimes(1);
  });
  it("빠진 자료만 인증 조회한 뒤 같은 표시를 저장한다",async()=>{
    m.request.mockResolvedValue({...packed,access});
    const h=renderHook(()=>useSharedStudy(access));await settle();expect(h.result.current.study).toMatchObject(study);
    expect(m.request).toHaveBeenCalledExactlyOnceWith({action:"study",assignmentId:study.assignmentId,knownKeys:[]},expect.any(AbortSignal));expect(m.cache).toHaveBeenCalledWith({contents:[],atoms:packed.atoms});
  });
  it("계정 변경 뒤 다시 확인을 눌러도 이전 배정이나 제목을 캐시에서 되살리지 않는다",async()=>{
    const h=renderHook(()=>useSharedStudy(access));await settle();
    act(()=>{m.identity="B";m.changed?.("identity");});expect(h.result.current.study).toBeNull();expect(h.result.current.blockedIdentity).toBe(true);
    act(()=>h.result.current.retry());await settle();expect(h.result.current.study).toBeNull();expect(m.read).toHaveBeenCalledTimes(1);expect(m.request).toHaveBeenCalledTimes(1);
  });
  it("늦게 도착한 이전 학생의 자료는 계정 변경 후 표시하거나 저장하지 않는다",async()=>{
    let resolve!:(v:typeof packed & {access:typeof access})=>void;m.request.mockReturnValue(new Promise(r=>{resolve=r;}));
    const h=renderHook(()=>useSharedStudy(access));await settle();act(()=>{m.identity="B";m.changed?.("identity");});
    await act(async()=>resolve({...packed,access}));expect(h.result.current.study).toBeNull();expect(m.cache).not.toHaveBeenCalled();expect(m.request.mock.calls[0][1].aborted).toBe(true);
  });
});
