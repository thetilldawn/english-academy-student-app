// Explicit local UI scenarios only. No DB/remote calls; saved replies live in this process.
import {createHash} from 'node:crypto';
import {APP_ORIGIN,uid} from './local-admin-baseline-data.mjs';
const receipts=new Map();
export function localMixedUiFixture({path,method,origin,body}){
  if(!['/api/admin/mixed-assignments','/api/admin/mixed-assignments/preview'].includes(path))return null;
  const reject={status:403,body:{error:'Local fake mixed requests only'}};
  if(method!=='POST'||origin!==APP_ORIGIN||!body||body.planVersion!=='meaning-episode-v1'||body.studentId!==uid(1)||
    ![uid(10),uid(11)].includes(body.datasetId)||!Array.isArray(body.primaryUnitIds)||!body.primaryUnitIds.length||
    body.primaryUnitIds.some(id=>![101,102,103,104,105].map(uid).includes(id)))return reject;
  const n=body.totalQuestionCount;
  if(!Number.isInteger(n)||n<4||n>500||![0,50,100].includes(body.englishToKoreanRatio))return reject;
  const settings={...body};delete settings.idempotencyKey;delete settings.selectionFingerprint;delete settings.excludeUnavailableConfirmed;delete settings.banksConfirmed;
  const hash=createHash('sha256').update(JSON.stringify(settings)).digest('hex');
  if(path.endsWith('/preview')){
    const sizes=[Math.floor(n/2),Math.ceil(n/2)],ratios=[50,100,0];
    const directions=ratios.flatMap(a=>ratios.map(b=>[a,b])).find(pair=>sizes.reduce((sum,size,index)=>sum+Math.round(size*pair[index]/100),0)===Math.round(n*body.englishToKoreanRatio/100));
    const limited=body.timingMode==='total',seconds=body.timeLimitSeconds;
    const error=limited&&seconds<60?'서로 다른 뜻을 보존하려면 시험 2개가 필요합니다. 전체 시간을 60초 이상으로 늘려 주세요.':null;
    const portions=sizes.map(size=>limited?(seconds-60)*size/n:0),times=portions.map(value=>30+Math.floor(value));
    if(limited&&times[0]+times[1]<seconds)times[portions[0]%1>=portions[1]%1?0:1]++;
    return{status:200,body:{planVersion:'meaning-episode-v1',selectionFingerprint:error?null:hash,totalQuestionCount:n,primaryQuestionCount:n-4,reviewMeaningCount:4,
      availablePrimaryCount:96,candidateReviewCount:5,unavailableCount:1,unavailableItems:[{key:'fake-only',headword:'sample',reason:'선택한 방향의 보기가 부족합니다.'}],error,
      banks:error?[]:sizes.map((questionCount,index)=>({index,questionCount,primaryQuestionCount:questionCount-2,reviewMeaningCount:2,quizContentMode:'book_meaning_choice',englishToKoreanRatio:directions[index],timeLimitSeconds:limited?times[index]:null}))}};
  }
  if(!/^[a-f0-9-]{36}$/.test(body.idempotencyKey)||body.selectionFingerprint!==hash||!body.excludeUnavailableConfirmed||!body.banksConfirmed)return reject;
  const serialized=JSON.stringify(body),prior=receipts.get(body.idempotencyKey);
  if(prior&&prior.input!==serialized)return{status:409,body:{code:'request_conflict',error:'다른 저장 요청입니다.'}};
  if(prior)return{status:201,body:prior.result};
  const result={planVersion:'meaning-episode-v1',kind:'mistake_batch',assignments:[Math.floor(n/2),Math.ceil(n/2)].map((questionCount,index)=>({studentId:uid(1),assignmentId:uid(800+index),questionCount}))};
  receipts.set(body.idempotencyKey,{input:serialized,result});
  return{status:503,body:{error:'가짜 저장 응답 지연: 같은 요청으로 확인해 주세요.'}};
}
