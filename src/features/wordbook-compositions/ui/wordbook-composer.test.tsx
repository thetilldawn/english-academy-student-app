// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render,screen,fireEvent,waitFor,cleanup } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { WordbookComposer } from "./wordbook-composer";
import type { SourceScope } from "../contracts/composition";
const scopes: SourceScope[] = [2024,2025,2026].map((year,i)=>({id:`00000000-0000-4000-8000-00000000000${i+1}`,version:String(i+1).repeat(64),
  displayName:`${year}년 ${i===1?6:3}월 장문 [41–42번]`,sourceTitle:'가짜 모의고사',sourceEntryCount:5,includedEntryCount:4,
  metadata:{executionYear:year,examMonth:i===1?6:3,examKind:'mock',academicYear:null,agency:'가짜',typeCode:'long_reading',typeLabel:'장문독해',questionNumbers:[41,42],sharedPassage:true}}));
const saved={datasetId:'00000000-0000-4000-8000-000000000099',title:'나의 모의고사',scopeCount:1,sourceEntryCount:5,includedEntryCount:4};
const requests: unknown[]=[];
let fail=0;
let catalogScopes=scopes;
beforeEach(()=>{requests.length=0;fail=0;catalogScopes=scopes;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  if(init?.method==='POST') {requests.push(JSON.parse(init.body));if(fail) {const status=fail;fail=0;return new Response('{}',{status});}return Response.json(saved,{status:201});}
  return Response.json({scopes:catalogScopes});
}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function ready(){await screen.findByLabelText(/2026년 3월 장문/);fireEvent.change(screen.getByLabelText('단어장 이름'),{target:{value:'나의 모의고사'}});}
describe('wordbook composer',()=>{
  it('preserves hidden choices across filters and adds only the visible scopes',async()=>{
    render(<WordbookComposer onSaved={vi.fn()} onBack={vi.fn()}/>);await ready();
    fireEvent.click(screen.getByRole('button',{name:'2026년'}));fireEvent.click(screen.getByRole('button',{name:'현재 조건 범위 담기'}));
    fireEvent.click(screen.getByRole('button',{name:'2026년'}));fireEvent.click(screen.getByRole('button',{name:'2024년'}));
    expect(screen.getByText('현재 조건에서 보이지 않는 선택 1개도 함께 저장됩니다.')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));
    await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0]).toMatchObject({scopes:[{id:scopes[2]!.id}]});
  });
  it('reuses the request after an unknown result and prevents editing while confirming',async()=>{
    fail=503;const onSaved=vi.fn();render(<WordbookComposer onSaved={onSaved} onBack={vi.fn()}/>);await ready();
    fireEvent.click(screen.getByLabelText(/2026년 3월 장문/));fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));
    await screen.findByRole('button',{name:'같은 내용으로 저장 확인'});expect(screen.getByLabelText('단어장 이름')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'같은 내용으로 저장 확인'}));await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
    expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
  });
  it('does not POST again after successful storage and a failed UI callback',async()=>{
    const onSaved=vi.fn().mockImplementationOnce(()=>{throw new Error('render error');});render(<WordbookComposer onSaved={onSaved} onBack={vi.fn()}/>);await ready();
    fireEvent.click(screen.getByLabelText(/2026년 3월 장문/));fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));
    await screen.findByText('단어장은 저장됐습니다. 다시 눌러 목록에 표시해 주세요.');
    fireEvent.click(screen.getByRole('button',{name:'같은 내용으로 저장 확인'}));await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(2));expect(requests).toHaveLength(1);
  });
  it('keeps an uncertain request through an authentication failure and a later retry',async()=>{
    fail=503;const onSaved=vi.fn();render(<WordbookComposer onSaved={onSaved} onBack={vi.fn()}/>);await ready();
    fireEvent.click(screen.getByLabelText(/2026년 3월 장문/));fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));
    await screen.findByRole('button',{name:'같은 내용으로 저장 확인'});fail=401;
    fireEvent.click(screen.getByRole('button',{name:'같은 내용으로 저장 확인'}));await screen.findByText('관리자 로그인이 필요합니다.');
    expect(screen.getByLabelText('단어장 이름')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'같은 내용으로 저장 확인'}));await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
    expect(requests).toHaveLength(3);expect(requests[0]).toEqual(requests[1]);expect(requests[1]).toEqual(requests[2]);
  });
  it('offers reload after a changed scope and still allows removing a disappeared selection',async()=>{
    fail=409;render(<WordbookComposer onSaved={vi.fn()} onBack={vi.fn()}/>);await ready();fireEvent.click(screen.getByLabelText(/2026년 3월 장문/));
    fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));await screen.findByRole('button',{name:'다시 불러오기'});
    catalogScopes=scopes.slice(0,2);fireEvent.click(screen.getByRole('button',{name:'다시 불러오기'}));
    await screen.findByText(/담은 범위 1개의 준비 상태가 바뀌었습니다/);fireEvent.click(screen.getByText('담은 범위 모두 보기'));
    fireEvent.click(screen.getByRole('button',{name:'빼기'}));expect(screen.getByText(/담은 범위 0개/)).toBeVisible();
  });
  it('shows authentication failure without locking return and keeps ordinary empty results distinct',async()=>{
    const report=vi.fn();const capture=vi.fn(()=>report);
    fail=403;render(<WordbookComposer captureAuthenticationFailure={capture} onSaved={vi.fn()} onBack={vi.fn()}/>);await ready();fireEvent.click(screen.getByLabelText(/2026년 3월 장문/));
    fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}));await screen.findByText('관리자 로그인이 필요합니다.');
    expect(screen.getByRole('button',{name:'단어장 찾기로 돌아가기'})).toBeEnabled();
    expect(capture).toHaveBeenCalledTimes(2);expect(report).toHaveBeenCalledWith(expect.objectContaining({status:403}));
    fireEvent.click(screen.getByRole('button',{name:'2026년'}));fireEvent.click(screen.getByRole('button',{name:'6월'}));expect(screen.getByText('이 조건에 맞는 준비된 자료가 없습니다.')).toBeVisible();
  });
});
