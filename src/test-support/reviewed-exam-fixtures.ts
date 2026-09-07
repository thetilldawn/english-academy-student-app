import { createHash } from "node:crypto";
import { schoolPronunciationFixture } from "./pronunciation-fixtures";
import { SCHOOL_PRONUNCIATION_SCOPES } from "@/lib/vocab/school-pronunciation-release-contract";
import { computeVocabPronunciationBindingHash, computeVocabPronunciationIdentityHash, computeVocabPronunciationPackageVersion } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

export const reviewedFixtureId = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const sha256Text = (s:string) => createHash("sha256").update(s,"utf8").digest("hex");
export function canonicalText(value: unknown): string {
  if(Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  if(value!==null && typeof value==="object") return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalText(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const reviewedHash = (value:unknown) => sha256Text(canonicalText(value));
export const reviewedFixtureModes = [
  ["book_meaning_choice","english_to_korean","headword","korean_meaning"],
  ["book_meaning_choice","korean_to_english","korean_meaning","headword"],
  ["canonical_definition_to_headword","korean_to_english","english_definition","headword"],
  ["canonical_headword_to_definition","english_to_korean","headword","english_definition"],
] as const;

/** Entirely artificial words/glosses: no student records or source material. */
export function reviewedExamFixture() {
  const voice=schoolPronunciationFixture(SCHOOL_PRONUNCIATION_SCOPES.findIndex(s=>s.datasetKey==="simseok-g11-sem2-mid-mock-v1"));
  const template=voice.identities[0]!;
  const words=["alpha","beta","gamma","delta"];
  voice.identities=words.map((word,i)=>{
    const identity={...structuredClone(template),identity_id:`pron:v3:${String(i+6).repeat(64)}`,headword:word,headword_normalized:word};
    identity.identity_content_sha256=computeVocabPronunciationIdentityHash(identity);
    return identity;
  });
  voice.summary.identity_count=4;
  voice.bindings=voice.bindings.map((b,i)=>{
    const identity=voice.identities[i%4]!;
    const binding={...b,headword:identity.headword,headword_normalized:identity.headword,identity_id:identity.identity_id};
    binding.binding_content_sha256=computeVocabPronunciationBindingHash(binding);
    return binding;
  });
  voice.package_version=computeVocabPronunciationPackageVersion(voice);
  voice.release_id=`voca-release:${voice.package_version.toLowerCase()}`;
  const counts=[12,24,14,18,14,8,10,14,10,17,13,9,9,24,16,12,21,11,12,10];
  const units=counts.map((entry_count,i)=>({key:`fake-${i+1}`,label:`가짜 지문 ${i+1}`,sort_index:i+1,entry_count,academic_year:i<10?2025:2024,exam_month:9,item_range:String([29,30,31,32,33,34,35,36,38,40][i%10])}));
  let row=0;
  const entries=units.flatMap(unit=>Array.from({length:unit.entry_count},(_,i)=>{
    const source_row=++row; const binding=voice.bindings[source_row-1]!;
    const entry={source_row,headword:binding.headword,korean_meaning:`가짜 뜻 ${((source_row-1)%4)+1}`,
      lexical_pos:"noun",source_meaning:"원본 가짜 뜻",source_pos:"noun",english_definition:`a fake definition ${((source_row-1)%4)+1}`,
      definition_provenance:{kind:"author_created_exam_context",provided_definition_found:false},
      unit_key:unit.key,position_in_unit:i+1,source_locator:{source_code:unit.key},
      pronunciation_identity_id:binding.identity_id,pronunciation_source_release_id:voice.release_id,
      pronunciation_ko:"테스트",predecessor_entry_row_sha256:binding.entry_row_sha256.toLowerCase()};
    return {...entry,entry_row_sha256:reviewedHash(entry)};
  }));
  const questions=entries.flatMap(entry=>reviewedFixtureModes.map(([mode,direction,prompt_role,choice_role],modeIndex)=>{
    const targetGroup=(entry.source_row-1)%4;
    const choice_source_rows=words.map((_,i)=>i===targetGroup?entry.source_row:i+1);
    const question={item_id:`fake-${entry.source_row}-${modeIndex}`,source_row:entry.source_row,entry_row_sha256:entry.entry_row_sha256,
      mode,direction,prompt_role,choice_role,prompt:entry[prompt_role],choice_source_rows,
      choice_texts:choice_source_rows.map(n=>entries[n-1]![choice_role]),correct_choice_index:targetGroup};
    return {...question,item_sha256:reviewedHash(question)};
  }));
  const content={dataset:{key:"fake-reviewed-mock-v2",title:"가짜 네 방향 시험",predecessor_key:voice.dataset_key,
    predecessor_source_sha256:voice.dataset_source_sha256.toLowerCase(),source_sha256:"c".repeat(64)},
    inputs:[{path:"fake-input",sha256:"d".repeat(64)}],units,entries,questions};
  const content_sha256=reviewedHash(content);
  const bundle={format:"reviewed-exam-bundle-v1",schema_version:1,...content,content_sha256,
    permissions:{canonical_approved:false,release_allowed:true},
    reviews:["fake-review-a","fake-review-b"].map(reviewer=>({reviewer,status:"passed",input_content_sha256:content_sha256,report_sha256:reviewedHash(reviewer)}))};
  const text=JSON.stringify(bundle);
  return {voice,bundle,text,fileHash:sha256Text(text)};
}
