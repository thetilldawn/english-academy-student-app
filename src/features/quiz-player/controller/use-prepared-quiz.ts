"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { beginPreparedAttempt, PreparationChanged } from "../api/prepare-attempt";
import { type PreparedQuiz } from "../contracts/preparation";
import type { QuizAttempt, QuizAttemptResponse } from "../model";

// All QuizPlayer code is statically imported. The preparation page has already
// received questions/voices; only the clock receipt is requested after hydration.
export function usePreparedQuiz(preparation:PreparedQuiz) {
  const router=useRouter();
  const [ready,setReady]=useState<(QuizAttemptResponse & {receivedAt:number})|null>(null);
  const frameRef=useRef<HTMLDivElement>(null);
  const display=useMemo<QuizAttempt>(() => ({...preparation,status:"in_progress",startedAt:null,deadlineAt:null,timerDeadlineAt:null}),[preparation]);
  const [error,setError]=useState("");
  const [needsRestart,setNeedsRestart]=useState(false);
  const [version,setVersion]=useState(0);
  const inFlight=useRef<ReturnType<typeof beginPreparedAttempt>|null>(null);
  const completed=useRef(false);
  useEffect(() => {
    let active=true, first=0,second=0,fontsReady=!document.fonts;
    void document.fonts?.ready.then(() => {fontsReady=true;request();});
    const request = () => {
      if (!active || !fontsReady || completed.current || document.visibilityState === "hidden") return;
      cancelAnimationFrame(first);cancelAnimationFrame(second);
      first=requestAnimationFrame(() => {
        const before=frameRef.current?.getBoundingClientRect();
        second=requestAnimationFrame(() => {
        if (!active || completed.current || document.visibilityState === "hidden") return;
        const after=frameRef.current?.getBoundingClientRect();
        if (!before || !after || after.width <= 0 || after.height <= 0) return;
        if (before.width !== after.width || before.height !== after.height) {request();return;}
        const pending=inFlight.current ?? beginPreparedAttempt(preparation);
        inFlight.current=pending;
        void pending.then(({clock,receivedAt}) => {
          if (!active) return;
          const practice=preparation.kind === "practice";
          if (clock.status !== "in_progress" || clock.phase === "review" || clock.phase === "completed") {
            router.replace(practice ? `/student/practice/${clock.id}/result` : `/student/result/${clock.id}`);return;
          }
          if (clock.phase !== preparation.phase || (!practice && (clock.id !== preparation.id || clock.currentQuestionId !== preparation.currentQuestionId)) ||
              (practice && clock.currentQuestionId !== clock.questionIds?.[0])) {
            router.replace(practice ? `/student/practice/${clock.id}` : `/student/attempt/${clock.id}`);return;
          }
          if (clock.questionIds && clock.questionIds.length !== preparation.questions.length) throw new Error("시험 자료가 바뀌었습니다. 목록에서 다시 확인해 주세요.");
          const questions=preparation.questions.map((q,index) => ({...q,id:clock.questionIds?.[index] ?? q.id,priorWrongLevel:clock.priorWrongLevels?.[index] ?? q.priorWrongLevel}));
          if (practice && clock.id !== preparation.id) window.history.replaceState(null,"",`/student/practice/${clock.id}`);
          completed.current=true;
          setReady({attempt:{...preparation,...clock,questions},
            timerRemainingMilliseconds:clock.timerRemainingMilliseconds,receivedAt});
        }).catch((cause:unknown) => {
          if (active) {
            inFlight.current=null;
            if(cause instanceof PreparationChanged){completed.current=true;setNeedsRestart(true);setError("시험 준비가 만료되었거나 자료가 바뀌었습니다. 목록에서 다시 시작해 주세요.");}
            else setError("시험을 준비하지 못했습니다. 다시 확인해 주세요.");
          }
        });
      });});
    };
    request();
    const observer=typeof ResizeObserver !== "undefined" ? new ResizeObserver(request) : null;
    if (frameRef.current) observer?.observe(frameRef.current);
    document.addEventListener("visibilitychange",request);
    return () => {active=false;observer?.disconnect();cancelAnimationFrame(first);cancelAnimationFrame(second);document.removeEventListener("visibilitychange",request);};
  },[preparation,router,version]);
  return {display,state:{response:ready,error,frameRef,retry:needsRestart?undefined:()=>{setError("");setVersion(v=>v+1);}}};
}
