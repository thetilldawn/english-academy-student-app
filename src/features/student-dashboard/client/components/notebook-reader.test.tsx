/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {renderToString} from 'react-dom/server';
import type {ReactElement} from 'react';
import {announceStudentPrivateCacheChange} from '@/features/session/public-client';
import {readFileSync} from 'node:fs';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import type {MistakeStudyPage as NotebookPage,MistakeStudyWord as NotebookWord} from '@/features/students/public-contracts';
import { installNativeOverlayFixture } from '@/test-support/native-overlay-fixture';
installNativeOverlayFixture();
const mocks=vi.hoisted(()=>({load:vi.fn(),episodes:vi.fn(),play:vi.fn(),dispose:vi.fn(),back:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({back:mocks.back})}));
vi.mock('../transport/notebook-transport',async()=>({...await vi.importActual('../transport/notebook-transport'),loadNotebook:mocks.load}));
vi.mock('@/features/students/transport/mistake-episode-history',async()=>({...await vi.importActual('@/features/students/transport/mistake-episode-history'),loadMistakeEpisodeHistory:mocks.episodes}));
vi.mock('@/lib/audio/managed-audio-player',()=>({ManagedAudioPlayer:class {play=mocks.play;dispose=mocks.dispose;}}));
import {NotebookReader} from './notebook-reader';
import {NotebookDetail,NotebookWorkspace,NotebookPreviewPane} from './notebook-detail';
import {NotebookRequestError} from '../transport/notebook-transport';
import {MistakeEpisodeHistoryError} from '@/features/students/transport/mistake-episode-history';
const counters={currentWrongCount:4,lifetimeWrongCount:4,currentMissedCount:0,lifetimeMissedCount:0};
const word:NotebookWord={key:'dictionary:potential',sourceVersion:'c'.repeat(64),headword:'potential',primaryMeaning:'가능성',...counters,legacyWrongCount:0,lastWrongAt:'2026-09-30T00:00:00Z',
  meanings:[{meaningKey:'a'.repeat(64),episodeId:'00000000-0000-4000-8000-000000000009',stateVersion:'4',...counters,legacyWrongCount:0,countQuality:'exact',
    unresolved:true,resolvedAt:null,lastWrongAt:'2026-09-30T00:00:00Z',testedField:'primary_meaning',identityKind:'reviewed-meaning',selectedText:'가능성',primaryMeaning:'가능성',episodeCount:0,episodes:[],episodeNextCursor:null,
    sourceEntryId:1,sourceDatasetId:'00000000-0000-4000-8000-000000000003',sourceLabel:'가짜 책',sources:[]}],
  pronunciation:{displayKo:'퍼텐셜',variantId:null,audioUrl:'https://example.test/approved.mp3',available:true},definition:'a possibility',example:'This shows potential.',exampleKo:null};
const initial:NotebookPage={view:'current',sourceVersion:word.sourceVersion,stateVersion:'4',items:[word],totalCount:12,nextCursor:'next',summary:{wordCount:12,currentWrongCount:48,lifetimeWrongCount:48,currentMissedCount:0,legacyWrongCount:0},datasetOptions:[]};
function hydrate(element:ReactElement){const container=document.createElement('div');container.innerHTML=renderToString(element);document.body.appendChild(container);return render(element,{container,hydrate:true});}
const mount=()=>hydrate(<NotebookWorkspace identity="test-session" detail={<NotebookPreviewPane/>}><NotebookReader initialIdentity="test-session" initial={initial}/></NotebookWorkspace>);
beforeEach(()=>{vi.resetAllMocks();mocks.play.mockResolvedValue('started');mocks.load.mockResolvedValue({...initial,nextCursor:null});vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1000);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('내 단어장 화면',()=>{
  it.each([404,409])('뜻 이력 %i는 실제 목록 재조회와 새 상세 표시로 이어진다',async status=>{
    const episodes=Array.from({length:20},(_,n)=>({episodeId:`a3030000-0000-4000-8000-${String(n+100).padStart(12,'0')}`,openedAt:'2026-10-02T00:00:00Z',resolvedAt:null,wrongCount:1,missedCount:0,includesLegacy:false}));
    const old={...word,meanings:[{...word.meanings[0],episodeCount:21,episodes,episodeNextCursor:'cursor'}]};
    hydrate(<NotebookWorkspace identity="test-session" detail={<NotebookPreviewPane/>}><NotebookReader initialIdentity="test-session" initial={{...initial,items:[old]}}/></NotebookWorkspace>);
    mocks.episodes.mockRejectedValueOnce(new MistakeEpisodeHistoryError(status));
    let finish!:(value:NotebookPage)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByText('오답·해결 이력 21건'));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이전 이력 더 보기'})));
    expect(mocks.load).toHaveBeenCalledOnce();expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    const refreshed={...word,primaryMeaning:'다시 확인한 뜻',meanings:[{...word.meanings[0],stateVersion:'5',selectedText:'다시 확인한 뜻'}]};
    await act(async()=>finish({...initial,stateVersion:'5',items:[refreshed],nextCursor:null}));
    expect(screen.getByRole('link',{name:'potential 상세'})).toBeVisible();expect(screen.queryByText('오답·해결 이력 21건')).toBeNull();
    expect(screen.queryByText('목록이 바뀌었습니다. 최신 목록에서 단어를 다시 열어 주세요.')).toBeNull();
    expect(screen.getByRole('checkbox',{name:'1번째 뜻 연습 선택'})).toBeEnabled();
  });
  it.each(['단어를 찾을 수 없습니다.','화면을 불러오지 못했습니다.'])('상세 안내를 로그인 오류로 바꾸거나 가리지 않는다: %s',message=>{
    render(<NotebookWorkspace identity="test-session" detail={null}><NotebookDetail presentation="page"><p role="alert">{message}</p><button>다시 시도</button></NotebookDetail></NotebookWorkspace>);
    expect(screen.getByRole('alert')).toHaveTextContent(message);expect(screen.getByRole('button',{name:'다시 시도'})).toBeVisible();
    expect(screen.queryByText('다시 로그인해 주세요.')).toBeNull();expect(mocks.load).not.toHaveBeenCalled();
  });
  it('다른 화면에서 돌아온 첫 표시는 이전 서버 자료를 숨기고 다시 읽는다',async()=>{
    let finish!:(value:NotebookPage)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    render(<NotebookWorkspace identity="test-session" detail={<NotebookPreviewPane/>}><NotebookReader initialIdentity="test-session" initial={initial}/></NotebookWorkspace>);
    expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    await waitFor(()=>expect(mocks.load).toHaveBeenCalledTimes(1));
    await act(async()=>finish({...initial,items:[],totalCount:0,nextCursor:null}));
    expect(screen.getByText('조건에 맞는 단어가 없습니다.')).toBeVisible();
  });
  it('시험 변경 신호는 선택과 음성을 비우고 숨김 동안의 늦은 응답을 버린다',async()=>{
    mount();fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));
    let finish!:(value:NotebookPage)=>void;mocks.load.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    await act(async()=>announceStudentPrivateCacheChange('mistakes'));
    expect(screen.getByText('0개 뜻 선택')).toBeVisible();expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    const signal=mocks.load.mock.calls[0][2] as AbortSignal;
    let visibility:DocumentVisibilityState='hidden';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility);
    act(()=>fireEvent(document,new Event('visibilitychange')));expect(signal.aborted).toBe(true);
    await act(async()=>{finish(initial);announceStudentPrivateCacheChange('mistakes');});
    expect(mocks.load).toHaveBeenCalledTimes(1);expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    mocks.load.mockResolvedValueOnce({...initial,items:[],totalCount:0,nextCursor:null});
    await act(async()=>{visibility='visible';fireEvent(document,new Event('visibilitychange'));fireEvent(window,new PageTransitionEvent('pageshow',{persisted:true}));});
    expect(mocks.load).toHaveBeenCalledTimes(2);expect(screen.getByText('조건에 맞는 단어가 없습니다.')).toBeVisible();
  });
  it('계정 변경 신호 또는 서버와 화면의 세션 불일치는 상세까지 폐기한다',async()=>{
    const mounted=mount();act(()=>announceStudentPrivateCacheChange('identity'));
    expect(screen.getByRole('alert')).toHaveTextContent('다시 로그인');expect(screen.queryByRole('link',{name:'potential 상세'})).toBeNull();
    await act(async()=>announceStudentPrivateCacheChange('mistakes'));expect(mocks.load).not.toHaveBeenCalled();
    mounted.unmount();render(<NotebookWorkspace identity="new-session" detail={<NotebookDetail initialIdentity="test-session" word={word}/>}><NotebookReader initialIdentity="test-session" initial={initial}/></NotebookWorkspace>);
    expect(screen.getByRole('alert')).toHaveTextContent('다시 로그인');expect(mocks.load).not.toHaveBeenCalled();
  });
  it('공용 기본 표시가 모달 잠금 전후 스크롤바 자리를 유지하고680/681 경계를 구별한다',()=>{
    const css=readFileSync(process.cwd()+'/src/features/student-dashboard/ui/notebook.module.css','utf8');
    const reset=readFileSync(process.cwd()+'/src/styles/reset.css','utf8');
    expect(reset).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable;/);
    expect(css).not.toContain(':global(');
    expect(css).toContain('@container(min-width:681px)');
    let width=680;vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(()=>width);
    render(<NotebookWorkspace identity="test-session" detail={<NotebookDetail initialIdentity="test-session" word={word}/>}><p>목록</p></NotebookWorkspace>);
    expect(screen.getByRole('dialog',{name:'단어 상세'})).toBeVisible();
    expect(within(screen.getByRole('dialog',{name:'단어 상세'})).getByRole('link',{name:'메인으로'})).toHaveAttribute('href','/student');
    width=681;fireEvent(window,new Event('resize'));
    expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('complementary',{name:'단어 상세'})).toBeVisible();
    width=680;fireEvent(window,new Event('resize'));
    expect(screen.getByRole('dialog',{name:'단어 상세'})).toBeVisible();
  });
  it('처음에는 서버 자료만 사용하고 행상세와 체크선택·전체해제를 구별한다',()=>{
    mount();expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.getByRole('link',{name:'potential 상세'})).toHaveAttribute('href',expect.stringContaining('/student/wordbook/'));
    fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));expect(screen.getByText('1개 뜻 선택')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'전체 선택 해제'}));expect(screen.getByText('0개 뜻 선택')).toBeVisible();
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
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({sort:'recent'}),null,expect.any(AbortSignal),"test-session");
  });
  it('정확횟수와 구간을 사용자 입력 그대로 검증한다',async()=>{
    mount();fireEvent.change(screen.getByRole('combobox',{name:'틀린 횟수'}),{target:{value:'custom'}});
    fireEvent.change(screen.getByRole('textbox',{name:'최소 오답 횟수'}),{target:{value:'4'}});fireEvent.change(screen.getByRole('textbox',{name:'최대 오답 횟수'}),{target:{value:'4'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'검색'})));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({minWrongCount:4,maxWrongCount:4}),null,expect.any(AbortSignal),"test-session");
    fireEvent.change(screen.getByRole('textbox',{name:'최소 오답 횟수'}),{target:{value:'2'}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'검색'})));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({minWrongCount:2,maxWrongCount:4}),null,expect.any(AbortSignal),"test-session");
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
    render(<NotebookWorkspace identity="test-session" detail={<NotebookDetail initialIdentity="test-session" word={word}/>}><p>목록</p></NotebookWorkspace>);fireEvent.click(screen.getByRole('button',{name:'닫기'}));expect(mocks.back).toHaveBeenCalledOnce();expect(mocks.load).not.toHaveBeenCalled();
  });
  it('더보기409는 선택·상세·소리를 무효화하고 첫 페이지를 한 번 다시 읽는다',async()=>{
    hydrate(<NotebookWorkspace identity="test-session" detail={<NotebookDetail initialIdentity="test-session" word={word}/>}><NotebookReader initialIdentity="test-session" initial={initial}/></NotebookWorkspace>);
    fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));
    const changed={...initial,stateVersion:'5',nextCursor:null,items:[{...word,meanings:word.meanings.map(meaning=>({...meaning,stateVersion:'5'}))}]};
    mocks.load.mockRejectedValueOnce(new NotebookRequestError(409)).mockResolvedValueOnce(changed);
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'10개 더보기'})));
    expect(mocks.load).toHaveBeenCalledTimes(2);expect(mocks.load.mock.calls[0][1]).toBe('next');expect(mocks.load.mock.calls[1][1]).toBeNull();
    expect(screen.getByText('0개 뜻 선택')).toBeVisible();expect(screen.getByText('목록이 바뀌었습니다. 최신 목록에서 단어를 다시 열어 주세요.')).toBeVisible();
    expect(screen.queryByRole('checkbox',{name:'1번째 뜻 연습 선택'})).toBeNull();expect(mocks.dispose).toHaveBeenCalled();
  });
  it('상태판이 같아도 자료명이나 학생이 바뀌면 이전 상세를 다시 선택할 수 없다',async()=>{
    const contents=(detail:NotebookWord)=><NotebookWorkspace identity="test-session" detail={<NotebookDetail initialIdentity="test-session" word={detail}/>}><NotebookReader initialIdentity="test-session" initial={initial}/></NotebookWorkspace>;
    const mounted=hydrate(contents(word));
    fireEvent.click(screen.getByRole('checkbox',{name:'potential 선택'}));
    const changedWord={...word,sourceVersion:'d'.repeat(64)};
    mocks.load.mockRejectedValueOnce(new NotebookRequestError(409)).mockResolvedValueOnce({...initial,sourceVersion:changedWord.sourceVersion,items:[changedWord],nextCursor:null});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'10개 더보기'})));
    expect(screen.getByText('0개 뜻 선택')).toBeVisible();
    expect(screen.queryByRole('checkbox',{name:'1번째 뜻 연습 선택'})).toBeNull();
    mounted.rerender(contents({...word}));
    expect(screen.queryByRole('checkbox',{name:'1번째 뜻 연습 선택'})).toBeNull();
    mounted.rerender(contents(changedWord));
    fireEvent.click(screen.getByRole('checkbox',{name:'1번째 뜻 연습 선택'}));
    expect(screen.getByText('1개 뜻 선택')).toBeVisible();
  });
  it('과거 이력 상세 주소에는 같은 조회 상한을 유지한다',async()=>{
    mount();mocks.load.mockResolvedValueOnce({...initial,view:'history',nextCursor:null});
    await act(async()=>fireEvent.click(screen.getByRole('tab',{name:'과거 이력'})));
    expect(screen.getByRole('link',{name:'potential 상세'})).toHaveAttribute('href',expect.stringContaining('?view=history&upperVersion=4'));
    expect(mocks.load).toHaveBeenLastCalledWith(expect.objectContaining({view:'history'}),null,expect.any(AbortSignal),"test-session");
  });
  it('한 카드의 두 뜻은 상세에서 따로 선택한다',()=>{
    const two={...word,meanings:[...word.meanings,{...word.meanings[0],meaningKey:'b'.repeat(64),selectedText:'잠재적인'}]};
    hydrate(<NotebookWorkspace identity="test-session" detail={<NotebookPreviewPane/>}><NotebookReader initialIdentity="test-session" initial={{...initial,items:[two]}}/></NotebookWorkspace>);
    fireEvent.click(screen.getByRole('checkbox',{name:'2번째 뜻 연습 선택'}));expect(screen.getByText('1개 뜻 선택')).toBeVisible();
    expect(screen.getByRole('checkbox',{name:'1번째 뜻 연습 선택'})).not.toBeChecked();expect(screen.getByRole('checkbox',{name:'potential 선택'})).not.toBeChecked();
  });
});
