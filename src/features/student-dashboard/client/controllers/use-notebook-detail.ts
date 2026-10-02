"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeStudentPrivateCacheChanges, useInitialServerHydration } from "@/features/session/public-client";
import type { MistakeStudyWord } from "@/features/students/public-contracts";
import { loadNotebookWord, NotebookRequestError } from "../transport/notebook-transport";

export function useNotebookDetail(input:{word?:MistakeStudyWord;view:"current"|"history";identity:string;initialIdentity?:string;enabled:boolean}) {
  const hydrating=useInitialServerHydration();
  const [seeded]=useState(()=>hydrating&&input.identity===input.initialIdentity);
  const owner=`${input.identity}:${input.word?.key}:${input.view}:${input.word?.meanings[0]?.stateVersion}:${input.word?.sourceVersion}`;
  const loadedOwner=useRef(owner);
  const [read,setRead]=useState<{owner:string;word:MistakeStudyWord}|null>(()=>seeded&&input.word?{owner,word:input.word}:null);
  const [error,setError]=useState<string|null>(null),[denied,setDenied]=useState(!!input.word&&input.identity!==input.initialIdentity);
  const [busy,setBusy]=useState(false);
  const blocked=useRef(!!input.word&&input.identity!==input.initialIdentity),request=useRef<AbortController|null>(null);
  const key=input.word?.key,upper=input.word?.meanings[0]?.stateVersion??"0",identity=input.identity,view=input.view,enabled=input.enabled;
  const load=useCallback(async()=>{
    if(!enabled||!key||blocked.current||document.visibilityState==="hidden")return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setRead(null);setBusy(true);setError(null);
    try {
      const value=await loadNotebookWord(key,view,upper,controller.signal,identity);
      if(request.current===controller&&!controller.signal.aborted){loadedOwner.current=owner;setRead({owner,word:value});}
    }catch(cause){
      if(request.current!==controller||controller.signal.aborted)return;
      if(cause instanceof NotebookRequestError&&(cause.status===401||cause.status===403)){blocked.current=true;setDenied(true);}
      setError(cause instanceof NotebookRequestError?cause.message:"단어를 불러오지 못했습니다. 다시 시도해 주세요.");
    }finally{if(request.current===controller){request.current=null;setBusy(false);}}
  },[enabled,key,view,upper,identity,owner]);
  useEffect(()=>{
    if(!enabled)return;
    let disposed=false,queued=false;
    const cancel=()=>{request.current?.abort();request.current=null;setRead(null);setBusy(false);};
    const refresh=()=>{cancel();if(queued||blocked.current||document.visibilityState==="hidden")return;queued=true;
      queueMicrotask(()=>{queued=false;if(!disposed)void load();});};
    const visibility=()=>{if(document.visibilityState==="hidden")cancel();else refresh();};
    const show=(event:PageTransitionEvent)=>{if(event.persisted)refresh();};
    const unsubscribe=subscribeStudentPrivateCacheChanges(kind=>{if(kind==="identity"){blocked.current=true;cancel();setDenied(true);}else refresh();});
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",cancel);window.addEventListener("pageshow",show);
    if(!seeded||owner!==loadedOwner.current)refresh();
    return()=>{disposed=true;unsubscribe();request.current?.abort();request.current=null;
      document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",cancel);window.removeEventListener("pageshow",show);};
  },[enabled,load,seeded,owner]);
  return{word:read?.owner===owner?read.word:null,error,denied,busy,retry:load};
}
