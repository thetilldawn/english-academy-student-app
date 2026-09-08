import { describe, expect, it } from "vitest";
import { parseEntrySourcePronunciation, withEntrySourcePronunciation } from "./entry-source-pronunciation";
import { preferredPronunciationWithActiveVocaRelease } from "./pronunciation-snapshot";
const url="https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3";
const variant="mw:"+"1".repeat(20), supabase="https://wojxpruvbjzbhrpmsbuy.supabase.co";
const row={vocab_entry_id:7,headword:"test",entry_row_sha256:"a".repeat(64),variant_id:variant,audio_key:url,
 display_ko:"테스트",segments:[{text:"테",stress:"primary"},{text:"스트",stress:"none"}],
 source_file_sha256:"b".repeat(64),manifest_sha256:"c".repeat(64)};
const selected={displayKo:"기존",variantId:variant,audioUrl:url,available:true};
const parsed=()=>parseEntrySourcePronunciation(row,supabase)!;
describe("source restoration proof",()=>{
 it("parses only the minimal source row and changes display, not audio",()=>{
   const proof=parsed(); expect(proof).toMatchObject({entryId:7,headword:"test"});
   expect(withEntrySourcePronunciation(selected,{headword:"test",restorations:[proof]}))
    .toEqual({...selected,displayKo:"테스트",segments:row.segments});
   expect(JSON.stringify(proof)).not.toMatch(/sha256|manifest|source_file/);
 });
 it.each([
  null,{...row,entry_row_sha256:"bad"},{...row,extra:"secret"},{...row,vocab_entry_id:0},
  {...row,segments:[]},{...row,segments:[{text:"테스트",stress:"none"}]},
  {...row,segments:[{text:"테",stress:"primary"},{text:"스트",stress:"primary"}]},
  {...row,display_ko:"불일치"},{...row,audio_key:"https://evil.example/test.mp3"},
  {...row,audio_key:url+"?redirect=1"},{...row,variant_id:"synthetic:"+"1".repeat(64)}
 ])("rejects malformed/unbound source row %#",value=>expect(parseEntrySourcePronunciation(value,supabase)).toBeNull());
 it("uses the deployment host for the same hash-bound existing Google object",()=>{
   const hash="1".repeat(64), key="/storage/v1/object/public/vocab-pronunciation-audio/pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/"+hash+".mp3";
   const value={...row,variant_id:"synthetic:"+hash,audio_key:key};
   expect(parseEntrySourcePronunciation(value,supabase)?.pronunciation.audioUrl).toBe(supabase+key);
   expect(parseEntrySourcePronunciation({...value,audio_key:key.replace(hash,"2".repeat(64))},supabase)).toBeNull();
   expect(parseEntrySourcePronunciation(value,supabase+"/evil")).toBeNull();
 });
 it("cannot apply to another stored headword, voice or ambiguous record",()=>{
   for(const context of [{headword:"other",restorations:[parsed()]},{headword:null,restorations:[parsed()]},
    {headword:"test",restorations:[parsed(),parsed()]},{headword:"test",restorations:[{...parsed(),pronunciation:{...parsed().pronunciation,variantId:"other"}}]},
    {headword:"test",restorations:[{...parsed(),pronunciation:{...parsed().pronunciation,audioUrl:url.replace("test0001","test0002")}}]}])
    expect(withEntrySourcePronunciation(selected,context)).toBe(selected);
   expect(withEntrySourcePronunciation({...selected,available:false},{headword:"test",restorations:[parsed()]}).available).toBe(false);
 });
 it("preserves an existing exact user approval above the source overlay",()=>{
   const approved={dictionaryId:"word:test",pronunciation:{...selected,displayKo:"지정",segments:[{text:"지정",stress:"primary" as const}]}};
   const result=preferredPronunciationWithActiveVocaRelease("word:test",selected,undefined,undefined,undefined,new Map(),approved,{headword:"test",restorations:[parsed()]});
   expect(result.displayKo).toBe("지정");
 });
 it("old and current voices coexist without replacing the saved voice",()=>{
   const other={...parsed(),pronunciation:{...parsed().pronunciation,variantId:"mw:other",audioUrl:url.replace("test0001","test0002")}};
   const result=withEntrySourcePronunciation(selected,{headword:"test",restorations:[other,parsed()]});
   expect(result.audioUrl).toBe(url);expect(result.variantId).toBe(variant);
 });
});
