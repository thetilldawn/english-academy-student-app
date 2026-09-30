import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getServiceSupabaseClient:()=>mocks}));
vi.mock('@/features/wordbook-compositions/public-server',()=>({readMappedEntryResources:async(ids:number[],read:(ids:number[])=>unknown)=>read(ids),readCompositionLineage:async()=>new Map()}));
import {loadEntrySourcePronunciationRegistry,loadEntryApprovedKoreanPronunciationRegistry,loadVocabPronunciationRegistry,loadActiveVocabPronunciationReleaseRegistry,loadSyntheticPronunciationRegistry,loadApprovedKoreanPronunciationRegistry,loadPronunciationAudioCorrections} from '@/lib/services/quiz/pronunciation-registry';
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'warn').mockImplementation(()=>{});mocks.rpc.mockResolvedValue({data:null,error:{code:'offline'}});mocks.from.mockImplementation(()=>{const chain={select:()=>chain,in:()=>chain,eq:()=>chain,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:null,error:{code:'offline'}}).then(resolve)};return chain;});});
afterEach(()=>vi.restoreAllMocks());
describe('학습자료 음원 장애 구별',()=>{
  const loaders=[(strict:boolean)=>loadEntrySourcePronunciationRegistry([1],strict),(strict:boolean)=>loadEntryApprovedKoreanPronunciationRegistry([1],strict),(strict:boolean)=>loadVocabPronunciationRegistry([1],strict),(strict:boolean)=>loadActiveVocabPronunciationReleaseRegistry([1],strict),(strict:boolean)=>loadSyntheticPronunciationRegistry([{releaseId:'release',vocabEntryId:1}],strict),(strict:boolean)=>loadApprovedKoreanPronunciationRegistry(['word'],strict)];
  it.each(loaders)('기존시험의 복구는 유지하고 내단어장은 조회장애로 재시도를 제공한다',async load=>{expect((await load(false)).size).toBe(0);await expect(load(true)).rejects.toThrow('발음 정보를');});
  it('교정음원 조회도 장애일때 예전 잘못된 음원으로 대체하지 않는다',async()=>{expect(await loadPronunciationAudioCorrections()).toEqual([]);await expect(loadPronunciationAudioCorrections(true)).rejects.toThrow();mocks.rpc.mockResolvedValue({data:[],error:null});expect(await loadPronunciationAudioCorrections(true)).toEqual([]);});
});
