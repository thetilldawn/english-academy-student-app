import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),registry:vi.fn(),corrections:vi.fn()}));
vi.mock('@/lib/auth/student-session',()=>({getStudentSession:mocks.session}));
vi.mock('@/lib/supabase/service',()=>({getServiceSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/services/quiz/pronunciation-registry',()=>({
  loadPronunciationLineage: vi.fn(async () => new Map()),loadVocabPronunciationRegistry:mocks.registry,loadActiveVocabPronunciationReleaseRegistry:mocks.registry,loadSyntheticPronunciationRegistry:mocks.registry,loadApprovedKoreanPronunciationRegistry:mocks.registry,loadEntryApprovedKoreanPronunciationRegistry:mocks.registry,loadEntrySourcePronunciationRegistry:mocks.registry,loadPronunciationAudioCorrections:mocks.corrections}));
import { getNotebookPage,getNotebookWord } from './notebook-study-query';
import { notebookFiltersSchema,notebookWordToken } from '../../contracts/notebook-study';
const student='00000000-0000-4000-8000-000000000001',dataset='00000000-0000-4000-8000-000000000003';
const filters=notebookFiltersSchema.parse({});
const pronunciation={displayKo:'퍼텐셜',variantId:null,audioUrl:'https://media.merriam-webster.com/audio/prons/en/us/mp3/p/potent02.mp3',available:true};
const word={key:'dictionary:potential',headword:'potential',primaryMeaning:'가능성',wrongCount:4,lastWrongAt:'2026-09-30T00:00:00.123456Z',occurrences:[{datasetId:dataset,vocabEntryId:1,datasetLabel:'검사책',headword:'potential',primaryMeaning:'가능성',provenanceStatus:'composition_verified_v1'}],studySource:{entryId:1,currentHeadword:'potential',snapshotDisplayKo:null,dictionaryId:'potential',releaseId:null,displayKo:'퍼텐셜',pronunciationSnapshot:null,compositionPronunciation:pronunciation,definition:'a possibility',example:'This shows potential.',exampleKo:'이것은 가능성을 보여준다.'},correctOption:3,latestQuestionId:'secret'};
const raw={items:[word],eventUpperId:'10',totalCount:1,notebookSummary:{wordCount:1,wrongEventCount:4,repeatedWordCount:1},datasetOptions:[]};
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({studentId:student});mocks.rpc.mockResolvedValue({data:raw,error:null});mocks.registry.mockResolvedValue(new Map());mocks.corrections.mockResolvedValue([]);});
describe('본인 단어 학습자료',()=>{
  it('본인만 조회하며 내부ID/정답을 버리고 고정 발음/예문을 잇는다',async()=>{
    const result=await getNotebookPage({filters});
    expect(result?.items[0]).toMatchObject({headword:'potential',pronunciation,example:'This shows potential.'});
    expect(JSON.stringify(result)).not.toMatch(/correctOption|studySource|latestQuestionId/);
    expect(mocks.rpc).toHaveBeenCalledWith('get_student_wrong_word_notebook_page_v2',expect.objectContaining({p_student_id:student,p_order:'count'}));
    expect(mocks.registry).toHaveBeenCalledWith([],true,expect.any(Map));
    expect(mocks.corrections).toHaveBeenCalledWith(true);
  });
  it('첫페이지 11개는10개+커서이며 상세는 안정키로 다시 본인 확인한다',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{...raw,items:Array.from({length:11},(_,n)=>({...word,key:'dictionary:'+n})),totalCount:11},error:null});
    const page=await getNotebookPage({filters});expect(page?.items).toHaveLength(10);expect(page?.nextCursor).toBeTruthy();
    expect((await getNotebookWord(notebookWordToken(word.key)))?.key).toBe(word.key);
    expect(mocks.rpc).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({p_word_key:word.key,p_student_id:student}));
    expect(await getNotebookWord('../invalid')).toBeNull();
  });
  it('권한거절/없음/잘못된자료/발음장애를 정상0건으로 바꾸지 않는다',async()=>{
    mocks.session.mockResolvedValueOnce(null);await expect(getNotebookPage({filters})).rejects.toMatchObject({reason:'unauthenticated'});
    mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect(await getNotebookPage({filters})).toBeNull();
    mocks.rpc.mockResolvedValueOnce({data:{...raw,totalCount:null},error:null});await expect(getNotebookPage({filters})).rejects.toThrow();
    mocks.registry.mockRejectedValueOnce(new Error('발음 조회 실패'));await expect(getNotebookPage({filters})).rejects.toThrow('발음 조회 실패');
  });
  it('현재 항목이 다른 단어로 바뀌었으면 그 새 발음은 옛 오답에 붙이지 않는다',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{...raw,items:[{...word,studySource:{...word.studySource,currentHeadword:'different',compositionPronunciation:null}}]},error:null});
    mocks.registry.mockResolvedValue(new Map([[1,pronunciation]]));
    const result=await getNotebookPage({filters});expect(result?.items[0].pronunciation).toMatchObject({audioUrl:null,displayKo:null});
    expect(mocks.registry).toHaveBeenCalledWith([],true,expect.any(Map));
  });
});
