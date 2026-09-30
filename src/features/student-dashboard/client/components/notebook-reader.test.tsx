/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {readFileSync} from 'node:fs';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import type {NotebookPage,NotebookWord} from '@/features/students/public-contracts';
import { installNativeOverlayFixture } from '@/test-support/native-overlay-fixture';
installNativeOverlayFixture();
const mocks=vi.hoisted(()=>({load:vi.fn(),play:vi.fn(),dispose:vi.fn(),back:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({back:mocks.back})}));
vi.mock('../transport/notebook-transport',async()=>({...await vi.importActual('../transport/notebook-transport'),loadNotebook:mocks.load}));
vi.mock('@/lib/audio/managed-audio-player',()=>({ManagedAudioPlayer:class {play=mocks.play;dispose=mocks.dispose;}}));
import {NotebookReader} from './notebook-reader';
import {NotebookDetail,NotebookWorkspace,NotebookPreviewPane} from './notebook-detail';
import {NotebookRequestError} from '../transport/notebook-transport';
const word:NotebookWord={key:'dictionary:potential',headword:'potential',primaryMeaning:'가능성',wrongCount:4,lastWrongAt:'2026-09-30T00:00:00Z',occurrences:[{datasetId:'00000000-0000-4000-8000-000000000003',vocabEntryId:1,datasetLabel:'가짜 책',headword:'potential',primaryMeaning:'가능성',provenanceStatus:'verified_v2'}],pronunciation:{displayKo:'퍼텐셜',variantId:null,audioUrl:'https://example.test/approved.mp3',available:true},definition:'a possibility',example:'This shows potential.',exampleKo:null};
const initial:NotebookPage={items:[word],totalCount:12,nextCursor:'next',summary:{wordCount:12,wrongEventCount:48,repeatedWordCount:12},datasetOptions:[]};
const mount=()=>render(<NotebookWorkspace detail={<NotebookPreviewPane/>}><NotebookReader initial={initial}/></NotebookWorkspace>);
beforeEach(()=>{vi.resetAllMocks();mocks.play.mockResolvedValue('started');mocks.load.mockResolvedValue({...initial,nextCursor:null});vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1000);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('내 단어장 화면',()=>{
  it('공용 기본 표시가 모달 잠금 전후 스크롤바 자리를 유지하고680/681 경계를 구별한다',()=>{
    const css=readFileSync(process.cwd()+'/src/features/student-dashboard/ui/notebook.module.css','utf8');
    const reset=readFileSync(process.cwd()+'/src/styles/reset.css','utf8');
    expect(reset).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable;/);
    expect(css).not.toContain(':global(');
    expect(css).toContain('@container(min-width:681px)');
    let width=680;vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(()=>width);
    render(<NotebookWorkspace detail={<NotebookDetail word={word}/>}><p>목록</p></NotebookWorkspace>);
    expect(screen.getByRole('dialog',{name:'단어 상세'})).toBeVisible();
    width=681;fireEvent(window,new Event('resize'));
    expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('complementary',{name:'단어 상세'})).toBeVisible();
    width=680;fireEvent(window,new Event('resize'));
    expect(screen.getByRole('dialog',{name:'단어 상세'})).toBeVisible();
  });
  it('처음에는 서버 자료만 사용하고 행상세와 체크선택·전체해제를 구별한다',()=>{
    mount();expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.getByRole('link',{name:'potential 상세'})).toHaveAttribute('href',expect.stringContaining('/student/wordbook/'));
    fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));expect(screen.getByText('1개 선택')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'전체 선택 해제'}));expect(screen.getByText('0개 선택')).toBeVisible();
    expect(screen.queryByText('틀린 단어를 골라 다시 연습해요.')).toBeNull();
  });
  it('가리기는 영어·한글발음·영영풀이의 접근성을 함께 숨기고 소리를 멈춘다',async()=>{
    const view=mount();await act(async()=>fireEvent.click(screen.getAllByRole('button',{name:'potential 듣기'})[0]));
    expect(mocks.play).toHaveBeenCalledWith(word.pronunciation.audioUrl);
    const prior=mocks.dispose.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'영어 가리기'}));
    expect(mocks.dispose.mock.calls.length).toBeGreaterThan(prior);
    expect(screen.queryByRole('button',{name:'potential 듣기'})).toBeNull();
    expect(screen.getAllByRole('button',{name:'발음 가림'}).every(button=>button.hasAttribute('disabled'))).toBe(true);
    expect(view.container.querySelector('[data-concealed="true"]')).toHaveAttribute('aria-hidden','true');
    expect(screen.getByRole('link',{name:'1번 단어 상세'})).toBeVisible();
  });
  it('목록과 상세가 하나의 재생기를 공유하며 실제 실패는 다시 누를 수 있다',async()=>{
    mount();mocks.play.mockResolvedValueOnce('failed');await act(async()=>fireEvent.click(screen.getAllByRole('button',{name:'potential 듣기'})[0]));
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('소리를 재생하지 못했습니다');
    await act(async()=>fireEvent.click(screen.getAllByRole('button',{name:'potential 듣기'})[1]));expect(mocks.play).toHaveBeenCalledTimes(2);expect(screen.queryByRole('alert')).toBeNull();
  });
  it('더보기는 이어붙이고 조건 변경은 전체에서 새로 조회한다',async()=>{
    mount();mocks.load.mockResolvedValueOnce({...initial,items:[{...word,key:'new',headword:'another'}],totalCount:null,summary:null,datasetOptions:null,nextCursor:null});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'10개 더보기'})));
    expect(screen.getByRole('link',{name:'another 상세'})).toBeVisible();expect(screen.getByRole('link',{name:'potential 상세'})).toBeVisible();
    await act(async()=>fireEvent.change(screen.getByRole('combobox',{name:'정렬'}),{target:{value:'recent'}}));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({sort:'recent'}),null,expect.any(AbortSignal));
  });
  it('정확횟수와 구간을 사용자 입력 그대로 검증한다',async()=>{
    mount();fireEvent.change(screen.getByRole('combobox',{name:'틀린 횟수'}),{target:{value:'custom'}});
    fireEvent.change(screen.getByRole('textbox',{name:'최소 오답 횟수'}),{target:{value:'4'}});fireEvent.change(screen.getByRole('textbox',{name:'최대 오답 횟수'}),{target:{value:'4'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'검색'})));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({minWrongCount:4,maxWrongCount:4}),null,expect.any(AbortSignal));
    fireEvent.change(screen.getByRole('textbox',{name:'최소 오답 횟수'}),{target:{value:'2'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'검색'})));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({minWrongCount:2,maxWrongCount:4}),null,expect.any(AbortSignal));
  });
  it('늦은 옛 응답이 새 조건을 덮지 않으며 실패를0개로 오인하지 않는다',async()=>{
    mount();let resolve!:(value:NotebookPage)=>void;mocks.load.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    fireEvent.change(screen.getByRole('combobox',{name:'정렬'}),{target:{value:'recent'}});
    mocks.load.mockRejectedValueOnce(new NotebookRequestError(503));await act(async()=>fireEvent.change(screen.getByRole('combobox',{name:'정렬'}),{target:{value:'count'}}));
    await act(async()=>resolve(initial));expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다');expect(screen.queryByText('조건에 맞는 단어가 없습니다.')).toBeNull();expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'다시 시도'})));expect(screen.getByRole('link',{name:'potential 상세'})).toBeVisible();
  });
  it('401이면 목록·선택·우측상세를 숨기고 소리를 정지한다',async()=>{
    mount();fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));mocks.load.mockRejectedValueOnce(new NotebookRequestError(401));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'10개 더보기'})));
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('다시 로그인'));
    expect(screen.queryByText('potential')).toBeNull();expect(screen.queryByText('1개 선택')).toBeNull();expect(mocks.dispose).toHaveBeenCalled();
  });
  it('넓은 화면 상세를 닫을때 뒤로가기만 실행한다',()=>{
    render(<NotebookWorkspace detail={<NotebookDetail word={word}/>}><p>목록</p></NotebookWorkspace>);fireEvent.click(screen.getByRole('button',{name:'닫기'}));expect(mocks.back).toHaveBeenCalledOnce();expect(mocks.load).not.toHaveBeenCalled();
  });
});
