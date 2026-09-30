'use client';
import {useEffect,useRef,useState} from 'react';
import {navigateDocument} from '@/components/document-navigation';
import {useRouteExitGuard} from '@/components/use-route-exit-guard';
import {subscribeAdminPrivateCacheChanges} from '@/features/session/public-client';
import {notebookFiltersSchema,type NotebookFilters} from '@/features/students/public-contracts';
import {notebookAssignmentInputSchema,type NotebookAssignmentInput,type NotebookAssignmentPreview,type NotebookAssignmentSave,type NotebookAssignmentSettings} from '../contracts/notebook-assignment';
import {NotebookRequestError,previewNotebook,saveNotebook} from '../transport/notebook-assignment';

export function useNotebookAssignment(studentIds:string[],audienceMode:'single'|'bulk',onSuccess:(count:number)=>void,interactionAllowed=true){
 const [ids,setIds]=useState(studentIds),[filters,setFilters]=useState<NotebookFilters>(()=>notebookFiltersSchema.parse({}));
 const [settings,setSettings]=useState<NotebookAssignmentSettings>({questionCount:10,englishToKoreanRatio:50,timingMode:'none',timeLimitSeconds:null,questionTimeLimitSeconds:null,passingScore:80,retryEnabled:false,retryPassingScore:null});
 const [preview,setPreview]=useState<NotebookAssignmentPreview|null>(null),[input,setInput]=useState<NotebookAssignmentInput|null>(null),[confirmed,setConfirmed]=useState<string[]>([]);
 const [sent,setSent]=useState<NotebookAssignmentSave|null>(null),[busy,setBusy]=useState(false),[denied,setDenied]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null),active=useRef(true),pending=useRef(false),generation=useRef(0),sentRef=useRef<NotebookAssignmentSave|null>(null);
 const exitGuard=useRouteExitGuard({busy:!!sent&&!denied,dirty:false,idPrefix:'notebook-assignment-save',confirmMessage:'먼저 배정 결과를 확인해 주세요.'});
 useEffect(()=>{
  generation.current++;active.current=true;
  const stop=subscribeAdminPrivateCacheChanges(kind=>{
   if(kind!=='identity')return;
   active.current=false;generation.current++;request.current?.abort();pending.current=false;
   setDenied(true);setPreview(null);setInput(null);setSent(null);setConfirmed([]);setIds([]);setError('다시 로그인해 주세요.');setBusy(false);
  });
  return()=>{active.current=false;request.current?.abort();stop();};
 },[]);
 function invalidate(){generation.current++;request.current?.abort();pending.current=false;setBusy(false);setPreview(null);setInput(null);setConfirmed([]);setError('');}
 function changeSettings(value:NotebookAssignmentSettings){if(sentRef.current||!interactionAllowed||denied)return;invalidate();setSettings(value);}
 function changeFilters(value:NotebookFilters){if(sentRef.current||!interactionAllowed||denied)return;invalidate();setFilters(value);}
 function exclude(studentId:string){if(sentRef.current||!interactionAllowed||denied)return;invalidate();setIds(current=>current.filter(id=>id!==studentId));}
 function restore(){if(sentRef.current||!interactionAllowed||denied)return;invalidate();setIds(studentIds);}
 function failure(value:unknown){
  if(value instanceof NotebookRequestError&&[401,403].includes(value.status)){setDenied(true);setPreview(null);setInput(null);setIds([]);setConfirmed([]);setSent(null);sentRef.current=null;navigateDocument('/',true);}
  setError(value instanceof NotebookRequestError?value.message:'응답을 확인하지 못했습니다. 다시 시도해 주세요.');
 }
 async function check(){
  if(pending.current||sentRef.current||denied||!interactionAllowed)return;
  const parsed=notebookAssignmentInputSchema.safeParse({requestKey:crypto.randomUUID(),studentIds:ids,audienceMode,filters,settings});
  if(!parsed.success){setError(parsed.error.issues[0]?.message.includes('10,000')?parsed.error.issues[0].message:'학생, 문항 수와 시험 조건을 확인해 주세요.');return;}
  const token=++generation.current;request.current=new AbortController();pending.current=true;setBusy(true);setError('');
  try{const result=await previewNotebook(parsed.data,request.current.signal);if(active.current&&token===generation.current){setPreview(result);setInput(parsed.data);setConfirmed([]);}}
  catch(value){if(active.current&&token===generation.current)failure(value);}
  finally{if(token===generation.current){pending.current=false;if(active.current)setBusy(false);}}
 }
 async function save(){
  if(pending.current||denied||!interactionAllowed||!input||!preview?.confirmation)return;
  if(preview.students.some(s=>s.mismatchingSources.length&&!confirmed.includes(s.studentId))){setError('학년이 다른 단어장을 포함할지 확인해 주세요.');return;}
  const value=sentRef.current??{...input,confirmation:preview.confirmation,gradeConfirmedStudentIds:confirmed};
  sentRef.current=value;setSent(value);pending.current=true;setBusy(true);setError('');request.current=new AbortController();const token=++generation.current;
  try{const result=await saveNotebook(value,request.current.signal);if(active.current&&token===generation.current)exitGuard.forceExit(()=>{if(!active.current)return false;sentRef.current=null;setSent(null);onSuccess(result.length);});}
  catch(value){if(active.current&&token===generation.current){failure(value);if(value instanceof NotebookRequestError&&value.code==='source_changed'){sentRef.current=null;setSent(null);invalidate();setError(value.message);}}}
  finally{if(token===generation.current){pending.current=false;if(active.current)setBusy(false);}}
 }
 return{ids,filters,settings,preview,confirmed,sent,busy,denied,error,changeSettings,changeFilters,exclude,restore,check,save,
  confirm:(id:string,include:boolean)=>{if(!sentRef.current&&interactionAllowed&&!denied)setConfirmed(values=>include?[...new Set([...values,id])]:values.filter(v=>v!==id));}};
}
