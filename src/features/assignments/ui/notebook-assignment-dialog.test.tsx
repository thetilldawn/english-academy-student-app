// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {announceAdminPrivateCacheChange} from '@/features/session/public-client';
import {NotebookAssignmentDialog} from './notebook-assignment-dialog';
const navigate=vi.hoisted(()=>vi.fn());vi.mock('@/components/document-navigation',()=>({navigateDocument:navigate}));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const students=[{id:id(1),displayName:'가짜학생가'},{id:id(2),displayName:'가짜학생나'}],fetchMock=vi.fn(),success=vi.fn(),close=vi.fn();
const row=(studentId:string,mismatch=false,error:string|null=null)=>({studentId,displayName:students.find(s=>s.id===studentId)?.displayName??'가짜학생',totalCount:2,availableCount:2,words:[{key:studentId+':word',headword:'collect',primaryMeaning:'모으다'}],excludedCount:0,excluded:[],sources:[],mismatchingSources:mismatch?[{id:id(10),label:'고2 가짜책',gradeCode:'g11'}]:[],error});
const preview=(ids=[id(1)],mismatch=false)=>({confirmation:'a'.repeat(64),students:ids.map(s=>row(s,mismatch))});
beforeAll(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','');}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value(){this.removeAttribute('open');}});});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('BroadcastChannel',undefined);fetchMock.mockResolvedValue(Response.json(preview()));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(list=students.slice(0,1),audienceMode:'single'|'bulk'='bulk'){render(<NotebookAssignmentDialog students={list} audienceMode={audienceMode} onClose={close} onSuccess={success}/>);fireEvent.change(screen.getByLabelText('학생당 문항 수'),{target:{value:'1'}});}
async function check(){fireEvent.click(screen.getByRole('button',{name:'출제 단어 확인'}));await screen.findAllByText('1문항 · 출제 가능 2개 / 전체 2개');}
describe('개인 오답 배정 화면',()=>{
 it.each([[0.5,30],[4.5,270]])('전체 시간 %s분을 %s초로 요청한다',async(minutes,seconds)=>{
  open();fireEvent.change(screen.getByLabelText('시간'),{target:{value:'total'}});fireEvent.change(screen.getByLabelText('전체 시간(분)'),{target:{value:String(minutes)}});await check();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).settings).toMatchObject({timingMode:'total',timeLimitSeconds:seconds,questionTimeLimitSeconds:null});
 });
 it('일괄 1명에서도 포함 확인 뒤 같은 조건으로 배정한다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json(preview([id(1)],true))).mockResolvedValueOnce(Response.json([{studentId:id(1),assignmentId:id(20),questionCount:1}]));
  open();await check();const button=screen.getByRole('button',{name:'배정'});expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:/학년이 다른 단어장 포함/}));expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(success).toHaveBeenCalledWith({studentCount:1,assignmentCount:1}));
  const saved=JSON.parse(fetchMock.mock.calls[1][1].body);expect(saved).toMatchObject({audienceMode:'bulk',gradeConfirmedStudentIds:[id(1)],settings:{questionCount:1}});
 });
 it('학생 제외는 기존 배정을 건드리지 않고 새 미리보기를 요구한다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json({...preview([id(1),id(2)]),confirmation:null,students:[row(id(1)),row(id(2),false,'출제할 단어가 없습니다.')]}));
  open(students);await check();fireEvent.click(screen.getAllByRole('button',{name:'제외'})[1]);
  expect(screen.getByRole('button',{name:'배정'})).toBeDisabled();expect(screen.queryByText('출제할 단어가 없습니다.')).not.toBeInTheDocument();
  fetchMock.mockResolvedValueOnce(Response.json(preview()));await check();expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({studentIds:[id(1)],audienceMode:'bulk'});
  expect(fetchMock.mock.calls.every(c=>String(c[0]).endsWith('/preview'))).toBe(true);
 });
 it('조건 변경은 확인값과 학년 확인을 지운다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json(preview([id(1)],true)));open();await check();fireEvent.click(screen.getByRole('checkbox',{name:/학년이 다른 단어장 포함/}));
  fireEvent.change(screen.getByLabelText('틀린 횟수(이상)'),{target:{value:'3'}});expect(screen.queryByRole('checkbox',{name:/학년이 다른/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'배정'})).toBeDisabled();
 });
 it('저장 응답 유실은 같은 요청으로 확인하고 성공을 중복 호출하지 않는다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json(preview())).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(Response.json([{studentId:id(1),assignmentId:id(20),questionCount:1}]));
  open();await check();fireEvent.click(screen.getByRole('button',{name:'배정'}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'닫기'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'배정 결과 확인'}));await waitFor(()=>expect(success).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
 });
 it('원천 변경409는 조건을 남겨 새로 확인할 수 있다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json(preview())).mockResolvedValueOnce(Response.json({error:'정보가 달라졌습니다.',code:'source_changed'},{status:409}));
  open();await check();fireEvent.click(screen.getByRole('button',{name:'배정'}));await screen.findByText('정보가 달라졌습니다.');
  expect(screen.getByLabelText('학생당 문항 수')).toHaveValue('1');expect(screen.getByRole('button',{name:'출제 단어 확인'})).toBeEnabled();expect(screen.getByRole('button',{name:'닫기'})).toBeEnabled();
 });
 it('로그아웃 신호 뒤의 늦은 응답은 개인 자료를 복원하지 않는다',async()=>{
  let resolve!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done;}));
  open();fireEvent.click(screen.getByRole('button',{name:'출제 단어 확인'}));act(()=>announceAdminPrivateCacheChange('identity'));
  await act(async()=>{resolve(Response.json(preview()));});expect(screen.queryByText('가짜학생가')).not.toBeInTheDocument();expect(screen.queryByText('출제 단어 1개')).not.toBeInTheDocument();expect(screen.getByText('처음으로')).toBeInTheDocument();
 });
 it('401은 개인 자료를 숨기고 처음으로 이동하며503은 입력을 보존한다',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json({error:'일시 장애'},{status:503})).mockResolvedValueOnce(Response.json({error:'로그인 필요'},{status:401}));
  open();fireEvent.click(screen.getByRole('button',{name:'출제 단어 확인'}));await screen.findByText('일시 장애');expect(screen.getByText('가짜학생가')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'출제 단어 확인'}));await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/',true));expect(screen.queryByText('가짜학생가')).not.toBeInTheDocument();
 });
 it('학생 미리보기는10명씩 표시한다',()=>{
  const list=Array.from({length:21},(_,i)=>({id:id(i+100),displayName:`검사용학생${i}`}));open(list);
  expect(screen.getAllByRole('button',{name:'제외'})).toHaveLength(10);fireEvent.click(screen.getByRole('button',{name:'10명 더보기'}));expect(screen.getAllByRole('button',{name:'제외'})).toHaveLength(20);
 });
});
