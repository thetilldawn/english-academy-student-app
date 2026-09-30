import {describe,expect,it} from 'vitest';
import {compositionQuestionPronunciation,type AssignmentQuestionSnapshot} from './question-snapshot';
const voice={displayKo:'검사발음',variantId:null,audioUrl:null,available:false},frozen={target:voice,choices:[voice,voice,voice,voice]};
const question:AssignmentQuestionSnapshot={provenance_status:'notebook_snapshot_v1',headword_snapshot:'collect',primary_meaning_snapshot:'과거 뜻',notebook_pronunciation_snapshot:frozen};
describe('개인 오답의 고정 발음',()=>{
 it('별도 출처의 기존 발음을 사용한다',()=>expect(compositionQuestionPronunciation(question)).toEqual(frozen));
 it('정규 구성 단어장 발음은 유지한다',()=>expect(compositionQuestionPronunciation({...question,provenance_status:'composition_verified_v1',notebook_pronunciation_snapshot:null,composition_pronunciation_snapshot:frozen})).toEqual(frozen));
 it('누락/개수 불일치/출처 혼합은 추측해서 대신 쓰지 않는다',()=>{
  for(const q of [{...question,notebook_pronunciation_snapshot:null},{...question,notebook_pronunciation_snapshot:{...frozen,choices:[]}},{...question,composition_pronunciation_snapshot:frozen},{...question,provenance_status:'verified_v2' as const}])expect(()=>compositionQuestionPronunciation(q)).toThrow();
 });
});
