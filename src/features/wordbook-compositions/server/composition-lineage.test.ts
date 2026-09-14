import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/supabase/service",()=>({getServiceSupabaseClient:()=>mocks}));
import { readCompositionLineage,readMappedEntryResources } from "./queries/composition-lineage";
import { loadEntrySourcePronunciationRegistry,loadSyntheticPronunciationRegistry,loadVocabPronunciationDisplayRegistry } from "@/lib/services/quiz/pronunciation-registry";
const sourceRelease='00000000-0000-4000-8000-000000000001',targetRelease='00000000-0000-4000-8000-000000000002';
const links=[107,108].map(id=>({vocab_entry_id:id,source_entry_id:7,source_release_id:sourceRelease,composition_release_id:targetRelease}));
let tables:Record<string,unknown[]>;const queries:Array<{table:string;field:string;value:unknown}>=[];
afterEach(()=>vi.unstubAllEnvs());
beforeEach(()=>{vi.resetAllMocks();tables={};queries.length=0;mocks.rpc.mockImplementation(async(name:string)=>({data:name==='list_mock_composition_lineage_v1'?links:[],error:null}));
  mocks.from.mockImplementation((table:string)=>{const chain={select:()=>chain,eq:(field:string,value:unknown)=>{queries.push({table,field,value});return chain;},in:(field:string,value:unknown)=>{queries.push({table,field,value});return chain;},
    then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:tables[table]??[],error:null}).then(resolve)};return chain;});});
describe('verified source resource mapping',()=>{
  it('expands one source to multiple new IDs and leaves unrelated IDs unchanged',async()=>{
    const read=vi.fn(async()=>new Map([[7,'same audio'],[9,'ordinary']]));
    expect(await readMappedEntryResources([107,108,9],read)).toEqual(new Map([[107,'same audio'],[108,'same audio'],[9,'ordinary']]));
    expect(read).toHaveBeenCalledExactlyOnceWith([7,9]);
  });
  it('refuses unrequested, duplicate, self, or invalid source mappings',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    for(const rows of [[...links,links[0]],[{...links[0],vocab_entry_id:999}],[{...links[0],source_entry_id:107}],[{...links[0],source_release_id:'invalid'}]]){
      mocks.rpc.mockResolvedValueOnce({data:rows,error:null});await expect(readCompositionLineage([107,108])).rejects.toThrow('학습정보 연결');
    }
    warn.mockRestore();
  });
  it('stops before querying substitute resources when source proof lookup fails',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'40001'}});
    const read=vi.fn();await expect(readMappedEntryResources([107,108],read)).rejects.toThrow('다시 시도');
    expect(read).not.toHaveBeenCalled();
  });
  it('maps source proof entryId as well as Map keys through the real public loader',async()=>{
    const source={vocab_entry_id:7,headword:'sample',entry_row_sha256:'a'.repeat(64),variant_id:'mw:'+'1'.repeat(20),
      audio_key:'https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3',display_ko:'가짜발음',
      segments:[{text:'가짜발음',stress:'primary'}],source_file_sha256:'b'.repeat(64),manifest_sha256:'c'.repeat(64)};
    mocks.rpc.mockImplementation(async(name:string)=>({data:name==='list_mock_composition_lineage_v1'?links:[source],error:null}));
    const mapped=await loadEntrySourcePronunciationRegistry([107,108]);
    expect(mapped.get(107)?.[0].entryId).toBe(107);expect(mapped.get(108)?.[0].entryId).toBe(108);
    expect(mapped.get(107)?.[0].pronunciation).toEqual(mapped.get(108)?.[0].pronunciation);
  });
  it('loads pronunciation text by the original ID',async()=>{
    tables.vocab_entries=[{id:7,pronunciation_ko:'원래발음'}];
    expect(await loadVocabPronunciationDisplayRegistry([107,108])).toEqual(new Map([[107,'원래발음'],[108,'원래발음']]));
    expect(queries).toContainEqual({table:'vocab_entries',field:'id',value:[7]});
  });
  it('queries synthetic audio by original release and returns requested composite keys',async()=>{
    const hash='1'.repeat(64);tables.vocab_synthetic_audio_bindings=[{release_id:sourceRelease,vocab_entry_id:7,asset_id:`synthetic:${hash}`}];
    tables.vocab_synthetic_audio_assets=[{asset_id:`synthetic:${hash}`,dictionary_id:'expression:sample',speech_text:'sample phrase',profile_id:'profile:5b6efb0ecc8f4702',provider:'google_cloud_text_to_speech',model:'chirp3-hd',voice:'en-US-Chirp3-HD-Despina',pronunciation_variant_id:null,
      pronunciation_identity_type:'dictionary_expression',pronunciation_mode:'provider_default_expression',canonical_ipa:null,google_tts_ipa:null,request_sha256:hash,storage_bucket:'vocab-pronunciation-audio',storage_object_key:`pronunciation/google_cloud_text_to_speech/profile-5b6efb0ecc8f4702/${hash}.mp3`,review_status:'profile_approved_generated',storage_verified:true,playback_enabled:true,canonical_pronunciation_approval_implied:false}];
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://abcdefghijklmnopqrst.supabase.co');
    const result=await loadSyntheticPronunciationRegistry([107,108].map(id=>({releaseId:targetRelease,vocabEntryId:id})));
    expect([...result.keys()]).toEqual([`${targetRelease}\0${107}`,`${targetRelease}\0${108}`]);
    expect(result.get(`${targetRelease}\0${107}`)?.available).toBe(true);
    expect(queries).toContainEqual({table:'vocab_synthetic_audio_bindings',field:'release_id',value:sourceRelease});vi.unstubAllEnvs();
  });
});
