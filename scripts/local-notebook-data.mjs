// Local fake read-only records. Never imported by application code or deployed routes.
import {STUDY_SECRET, studentStudyFixture} from './local-student-study-data.mjs';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const names=['collect','responsibility','take responsibility for','interdisciplinary','characteristically','potential','participate','approach','efficient','circumstance','contribute',...Array.from({length:14},(_,i)=>'word '+(i+12))];
export const notebookFixtureWords=names.map((headword,index)=>({key:'headword:'+uid(3)+':'+headword,headword,primaryMeaning:index===0?'모으다':'화면 검사용 뜻 '+index,wrongCount:25-index,lastWrongAt:'2026-09-30T00:00:00.123456Z',
  occurrences:[{datasetId:uid(3),vocabEntryId:index+1,datasetLabel:'가짜 검사 단어장',headword,primaryMeaning:'검사용 뜻',provenanceStatus:'composition_verified_v1'}],
  studySource:{entryId:index+1,currentHeadword:headword,snapshotDisplayKo:null,dictionaryId:null,releaseId:null,displayKo:null,pronunciationSnapshot:null,
    compositionPronunciation:{displayKo:index===0?'컬렉트':null,variantId:null,audioUrl:index===0?'https://media.merriam-webster.com/audio/prons/en/us/mp3/c/collec01.mp3':null,available:index===0},
    definition:index===0?'to gather things':null,example:index===0?'She collected the letters.':null,exampleKo:index===0?'그녀는 편지들을 모았다.':null}}));
export function localNotebookFixture({url,method,headers,body}){
  const target=new URL(url);if(target.origin!=='http://127.0.0.1:3038'||headers.get('apikey')!==STUDY_SECRET||headers.get('authorization')!=='Bearer '+STUDY_SECRET)return null;
  if(method!=='POST')return null;const name=target.pathname.split('/').at(-1);let input;try{input=JSON.parse(body||'{}');}catch{return null;}
  if(name==='get_student_dashboard_initial_v3') {
    const prior = studentStudyFixture({target:new URL('/rest/v1/rpc/get_student_dashboard_initial_v2',target),method,headers,input});
    if(prior.status!==200)return prior;
    return {...prior,body:prior.body.map(row=>({...row,current_items:row.current_items.map(node=>({...node,sortBucket:1,sortAt:'infinity',secondarySortAt:node.effectiveAt}))}))};
  }
  if(name==='list_pronunciation_audio_corrections_v1')return {status:200,body:[],category:'notebook-audio-corrections'};
  if(name!=='get_student_wrong_word_notebook_page_v2')return null;
  if(input.p_student_id!==uid(1))return {status:403,body:{error:'fake student only'},category:'rejected'};
  const query=(input.p_query||'').toLowerCase();let words=notebookFixtureWords.filter(w=>(!input.p_word_key||w.key===input.p_word_key)&&(!input.p_dataset_id||input.p_dataset_id===uid(3))&&(!input.p_min_wrong_count||w.wrongCount>=input.p_min_wrong_count)&&(!input.p_max_wrong_count||w.wrongCount<=input.p_max_wrong_count)&&(w.headword+' '+w.primaryMeaning).includes(query));
  words.sort(input.p_order==='recent'?(a,b)=>a.key.localeCompare(b.key):(a,b)=>b.wrongCount-a.wrongCount||a.key.localeCompare(b.key));const total=words.length;
  if(input.p_after_key)words=words.slice(words.findIndex(w=>w.key===input.p_after_key)+1);
  return {status:200,category:'notebook-read',body:{items:words.slice(0,11),totalCount:input.p_after_key?null:total,eventUpperId:'325',notebookSummary:input.p_after_key?null:{wordCount:notebookFixtureWords.length,wrongEventCount:notebookFixtureWords.reduce((total,w)=>total+w.wrongCount,0),repeatedWordCount:notebookFixtureWords.filter(w=>w.wrongCount>=2).length},datasetOptions:input.p_after_key?null:[{id:uid(3),label:'가짜 검사 단어장'}]}};
}

// Opt-in display stress samples. They never become production dictionary data.
export function notebookDisplaySamples(request, result) {
  // Integrated fake-DB runs must keep the actual generated questions/results.
  // Long-text samples only decorate the static visual fixture.
  if(result.category?.startsWith('notebook-'))return result;
  if(result.status!==200)return result;
  const path=new URL(request.url).pathname;
  if(path==='/rest/v1/rpc/get_student_assignment_study_v1'&&result.body?.words) return {...result,body:{...result.body,words:result.body.words.map((word,index)=>{
    const sample=index===3?{...word,headword:'take responsibility for',meaning:'책임을 맡다',displayKo:'테이크 리스판서빌러티 포어'}:word;
    return {...sample,compositionPronunciation:{displayKo:sample.displayKo,variantId:null,audioUrl:null,available:false}};
  })}};
  if(path==='/rest/v1/quiz_questions'&&Array.isArray(result.body)) return {...result,body:result.body.map((question,index)=>{
    if(index!==0)return question;
    const word='take responsibility for';
    const choices=question.direction==='korean_to_english'?['take responsibility for','interdisciplinary','characteristically','responsibility']:question.choices;
    const assignment={...question.assignment_question,headword_snapshot:word};
    assignment.exam_use_snapshot={...assignment.exam_use_snapshot,headword_snapshot:word,
      choice_dictionary_snapshots:assignment.exam_use_snapshot.choice_dictionary_snapshots.map((item,i)=>({...item,displayHeadword:choices[i]}))};
    return {...question,prompt:question.direction==='english_to_korean'?word:question.prompt,choices,assignment_question:assignment};
  })};
  return result;
}
