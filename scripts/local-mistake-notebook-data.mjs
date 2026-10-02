// Read-only synthetic current/history notebook data. Never used by app code.
import {createHash} from 'node:crypto';
import {uid,DATA_ORIGIN,PUBLIC_KEY,ACCESS_TOKEN,fixtureResponse} from './local-admin-baseline-data.mjs';
import {STUDY_SECRET} from './local-student-study-data.mjs';
const student=uid(1),source=uid(3),version='42',sourceVersion='a'.repeat(64),meaningKey='b'.repeat(64),resolvedKey='c'.repeat(64);
const stamp='2026-10-02T00:00:00.123456Z';
const counters={currentWrongCount:2,lifetimeWrongCount:22,currentMissedCount:0,lifetimeMissedCount:0};
const episodes=Array.from({length:21},(_,i)=>{const at=Date.UTC(2026,8,30-i);return{episodeId:uid(500+i),openedAt:new Date(at).toISOString(),resolvedAt:i?new Date(at+3600000).toISOString():null,wrongCount:i?1:2,missedCount:0,includesLegacy:false};});
const episodeCursor={schemaVersion:'vocabulary-mistake-episode-cursor-v1',studentId:student,meaningKey,stateVersion:version,lastSequence:'23',openedAt:episodes[19].openedAt,episodeId:episodes[19].episodeId};
const currentMeaning={meaningKey,episodeId:uid(500),stateVersion:version,...counters,legacyWrongCount:0,countQuality:'exact',unresolved:true,resolvedAt:null,lastWrongAt:stamp,
  testedField:'primary_meaning',identityKind:'frozen-selection-v1',selectedText:'모으다',primaryMeaning:'모으다',episodeCount:21,episodes:episodes.slice(0,20),episodeNextCursor:episodeCursor,
  sourceEntryId:1,sourceDatasetId:source,sourceLabel:'가짜 검사 단어장',sources:[{datasetId:source,entryId:1,label:'가짜 검사 단어장',...counters,lastWrongAt:stamp}]};
const resolvedMeaning={...currentMeaning,meaningKey:resolvedKey,episodeId:uid(600),unresolved:false,resolvedAt:stamp,currentWrongCount:0,lifetimeWrongCount:1,
  selectedText:'수집하다',primaryMeaning:'수집하다',episodeCount:1,episodes:[{...episodes[1],episodeId:uid(600)}],episodeNextCursor:null,
  sources:currentMeaning.sources.map(s=>({...s,currentWrongCount:0,lifetimeWrongCount:1}))};
const studySource={entryId:1,currentHeadword:'collect',snapshotDisplayKo:null,dictionaryId:null,releaseId:null,displayKo:null,pronunciationSnapshot:null,
  compositionPronunciation:{displayKo:'컬렉트',variantId:null,audioUrl:null,available:false},definition:'to gather things',example:'She collected the letters.',exampleKo:'그녀는 편지들을 모았다.'};
const response=body=>({status:200,category:'notebook-mistake-read',body});
const denied=()=>({status:403,category:'notebook-mistake-rejected',body:{code:'42501',message:'Explicit local fake read only'}});
export function isLocalMistakeNotebookRead(path,method){return method==='GET'&&(
  /^\/api\/student\/notebook\/[A-Za-z0-9_-]+$/.test(path)||
  new RegExp('^/api/admin/students/'+student+'/(wrong-words(?:/episodes)?|vocab-assignment-queues)$').test(path));}
export function localMistakeNotebookFixture(request){
 const target=new URL(request.url),name=target.pathname.split('/').at(-1);
 const pages=['get_student_vocabulary_mistake_page_v1','get_admin_vocabulary_mistake_page_v1'];
 const histories=['get_student_vocabulary_mistake_episodes_v1','get_admin_vocabulary_mistake_episodes_v1'];
 const extras=['get_admin_student_detail_initial_v2','get_admin_school_schedules_v1','list_vocab_assignment_queue_summaries_v2'];
 if(![...pages,...histories,...extras].includes(name))return null;
 const admin=name.includes('admin')||name==='list_vocab_assignment_queue_summaries_v2';
 const key=admin?PUBLIC_KEY:STUDY_SECRET,token=admin?ACCESS_TOKEN:STUDY_SECRET;
 if(target.origin!==DATA_ORIGIN||request.method!=='POST'||request.headers.get('apikey')!==key||request.headers.get('authorization')!=='Bearer '+token)return denied();
 let input;try{input=JSON.parse(request.body||'{}');}catch{return denied();}
 if(name==='get_admin_school_schedules_v1')return JSON.stringify(input.p_student_ids)==='["'+student+'"]'?response({students:[{id:student,schoolKey:null,schoolName:'검사 학교',gradeLabel:'고1'}],bundles:[]}):denied();
 if(input.p_student_id!==student)return denied();
 if(name==='list_vocab_assignment_queue_summaries_v2')return input.p_include_closed===true&&input.p_limit===21?response([]):denied();
 if(name==='get_admin_student_detail_initial_v2'){
   const prior=fixtureResponse({...request,studentProfile:true});
   return prior.status===200?response({...prior.body,currentMistakeSummary:{basis:'current_meaning_cards_v1',wordCount:1,repeatedWordCount:1}}):denied();
 }
 if(histories.includes(name)){
   if(![meaningKey,resolvedKey].includes(input.p_meaning_key)||input.p_upper!==version)return denied();
   if(input.p_cursor&&(input.p_meaning_key!==meaningKey||Object.keys(input.p_cursor).length!==Object.keys(episodeCursor).length||Object.entries(episodeCursor).some(([key,value])=>input.p_cursor[key]!==value)))return denied();
   const current=input.p_meaning_key===meaningKey,items=current?input.p_cursor?episodes.slice(20):episodes.slice(0,20):resolvedMeaning.episodes;
   return response({meaningKey:input.p_meaning_key,stateVersion:version,episodeCount:current?21:1,items,nextCursor:current&&!input.p_cursor?episodeCursor:null});
 }
 const filters=input.p_filters??{},view=filters.view??'current';if(!['current','history'].includes(view))return denied();
 let meanings=view==='current'?[currentMeaning]:[currentMeaning,resolvedMeaning];
 if(admin)meanings=meanings.map((m,i)=>({...m,sourceQuestionId:uid(701+i),sourceAttemptId:uid(710),sourcePhase:'retry',queueId:null,reviewDraftId:null,isCurrentEpisode:m.unresolved,
   scheduling:m.unresolved?'available':'none',activeAssignment:null,sources:m.sources.map(s=>({...s,sourceQuestionId:uid(701+i),sourcePhase:'retry',episodeId:m.episodeId}))}));
 const keyValue='dictionary:local-collect',total={...counters,lifetimeWrongCount:23},count=view==='history'?23:2;
 const word={sourceVersion,key:keyValue,headword:'collect',primaryMeaning:'모으다',...total,legacyWrongCount:0,lastWrongAt:stamp,meanings,studySource,
   cursor:{studentId:student,filtersHash:createHash('sha256').update(JSON.stringify(filters)).digest('hex'),stateVersion:version,sourceVersion,key:keyValue,count,lastWrongAt:stamp}};
 const minimum=filters.level==='once'?1:filters.level==='repeated'?2:filters.minWrongCount??1;
 const maximum=filters.level==='once'?1:filters.maxWrongCount??Number.MAX_SAFE_INTEGER;
 const include=(!filters.key||filters.key===keyValue)&&(!filters.datasetId||filters.datasetId===source)&&
   (!filters.query||('collect 모으다 수집하다'.includes(filters.query.toLowerCase())))&&count>=minimum&&count<=maximum;
 return response({view,stateVersion:version,sourceVersion,totalCount:include?1:0,summary:{wordCount:include?1:0,currentWrongCount:include?2:0,lifetimeWrongCount:include?total.lifetimeWrongCount:0,currentMissedCount:0,legacyWrongCount:0},
   datasetOptions:[{id:source,label:'가짜 검사 단어장'}],items:include?[word]:[],...(admin?{schedulingBasis:'current',schedulingAsOf:stamp,reviewDrafts:[]}:{} )});
}
