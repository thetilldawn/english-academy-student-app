"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { getPriorWrongIndicator } from "@/lib/quiz/prior-wrong";
import type { QuizQuestion } from "../../model";
import { QuizFrame } from "../../ui/quiz-frame";
import { quizAnswerAnnouncement, quizAudioPresentation, quizChoiceAudioUrls, quizChoicesDensity, quizPromptDensity } from "../../domain/quiz-session";
import { useQuizAudio } from "../../controller/use-quiz-audio";
import { useLocalQuizPlayerController } from "../controllers/use-local-quiz-player-controller";
import { findLocalQuizRun } from "../flows/local-quiz-store";
import styles from "../../ui/quiz-player.module.css";

type Controller = ReturnType<typeof useLocalQuizPlayerController>;
function LocalQuizFrame({ controller: c }: { controller: Controller }) {
  const { run, contents, feedback } = c;
  const index = feedback?.index ?? run?.answers.length ?? 0;
  const item = run?.plan?.items[index]; const promptRef = useRef<HTMLHeadingElement>(null);
  const question = useMemo((): QuizQuestion | null => {
    if (!item || !run) return null;
    const key = run.preparation.items.find(i => i.contentId === item.contentId)?.key;
    const body = key ? contents.get(key)?.body : null; if (!body) return null;
    return { ...body, id: item.id, orderIndex: item.order,
      initialChoiceIndex: null, initialIsCorrect: null, retryChoiceIndex: null, retryIsCorrect: null, initialTimedOut: false, retryTimedOut: false,
      priorWrongLevel: Math.min(2, item.priorWrongCount) as 0 | 1 | 2, revealedCorrectChoiceIndex: null };
  }, [item, run, contents]);
  // Use the original CDN URLs and the browser's normal HTTP/media cache.
  // As in the existing player, preload current choices and the next prompt.
  const preloadAudioUrls = useMemo(() => {
    if (!question || !run) return [];
    const urls = quizChoiceAudioUrls(question);
    const next = run.plan?.items[index + 1];
    const key = next && run.preparation.items.find(i => i.contentId === next.contentId)?.key;
    const body = key && contents.get(key)?.body;
    const prompt = body && quizAudioPresentation({ ...question, ...body }).promptAudioUrl;
    return prompt ? [...new Set([...urls, prompt])] : urls;
  }, [question, run, index, contents]);
  const audio = question ? quizAudioPresentation(question) : { promptAudioUrl: null };
  const phase = run?.plan?.phase ?? "initial";
  const { playAudio } = useQuizAudio({ attemptId: run?.plan?.attemptId ?? "", phase, questionId: question?.id ?? null,
    autoPlayEnabled: c.view === "playing" && !c.busy && c.pendingChoice === null && !feedback, playbackReady: true,
    preloadAudioUrls, promptAudioUrl: audio.promptAudioUrl });
  useEffect(() => { promptRef.current?.focus(); }, [question?.id]);
  if (!run?.plan || !question) return <p role="status">시험 결과를 준비하고 있습니다.</p>;
  const seconds = Number.isFinite(c.remaining) ? Math.ceil(c.remaining / 1000) : Infinity;
  const time = Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "제한 없음";
  return <QuizFrame assignmentTitle={run.preparation.title} currentQuestion={question} promptRef={promptRef} phase={phase}
    quizContentMode={run.preparation.quizContentMode} phaseQuestionCount={run.plan.items.length} completedInPhase={index}
    progress={Math.round(index * 100 / run.plan.items.length)} priorWrongIndicator={getPriorWrongIndicator(question.priorWrongLevel)}
    promptDensity={quizPromptDensity(question.prompt, question.direction, run.preparation.quizContentMode)} choiceDensity={quizChoicesDensity(question.choices)}
    answerAnnouncement={quizAnswerAnnouncement(phase, feedback?.correct ?? null, feedback?.timedOut ?? false)}
    formattedRemaining={time} remainingSeconds={Number.isFinite(seconds) ? seconds : 1} timingMode={run.preparation.timingMode}
    timerSynchronized={true} submitting={c.view !== "playing" || c.busy || Boolean(feedback)} error={c.error} timeWarning="" timedOut={feedback?.timedOut ?? false}
    promptAudioUrl={audio.promptAudioUrl} onPlayAudio={url => { if (!c.busy && !feedback) playAudio(url); }} onChoose={c.choose} onRetrySynchronization={() => void c.recover()}
    choiceFeedback={i => feedback ? feedback.answer === i ? "correct" : feedback.selected === i ? "wrong" : null : c.pendingChoice === i ? "selected" : null} />;
}
function Player({ localKey, retry }: { localKey: string; retry: boolean }) {
  const controller = useLocalQuizPlayerController(localKey, retry);
  const { view, error, run } = controller;
  return <main className={styles.shell} id="main-content"><div className={styles.stage}>
    {view === "playing" || (view === "failed" && controller.pendingChoice !== null && run?.plan && !run.batch) ? <LocalQuizFrame controller={controller} /> : <section className={styles.finalizing}>
      {view !== "blocked" && run ? <strong>{run.preparation.title}</strong> : null}
      {view === "preparing" ? <p role="status">시험 자료를 기기에 준비하고 있습니다.</p> : null}
      {view === "sending" ? <p role="status">답은 기기에 보관됐습니다. 시험 결과를 제출하고 있습니다.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {view === "failed" || view === "blocked" ? <Button onClick={() => void controller.recover()}>{view === "blocked" ? "계정 확인 후 이어가기" : "다시 확인"}</Button> : null}
      {view === "blocked" ? <ButtonLink href="/" prefetch={false}>로그인 화면</ButtonLink> : null}
      {view === "confirmed" && run?.receipt ? <>
        <p role="status">시험 결과가 저장됐습니다.</p>
        {!run.receipt.result.finalized && run.receipt.retryTargets.length > 0 ? <Button onClick={controller.retry}>재시험 시작</Button> : null}
        <ButtonLink href={`/student/result/${run.plan!.attemptId}`} prefetch={false}>결과 보기</ButtonLink>
      </> : null}
      <ButtonLink href="/student" prefetch={false}>시험 목록</ButtonLink>
    </section>}
  </div></main>;
}
export function LocalQuizPlayer() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  if (hash === null) return <main id="main-content"><p role="status">저장한 시험을 확인하고 있습니다.</p></main>;
  const match = /^#([0-9a-f-]{36})(\/retry)?$/.exec(hash);
  if (!match) return <main id="main-content"><p>시험 목록에서 시험을 선택해 주세요.</p><ButtonLink href="/student" prefetch={false}>시험 목록</ButtonLink></main>;
  return <Player key={hash} localKey={match[1]} retry={Boolean(match[2])} />;
}
function subscribeHash(changed: () => void) {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
}
export function LocalQuizResume({ studentId, attemptId, retry = false }: { studentId: string; attemptId: string; retry?: boolean }) {
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void findLocalQuizRun(attemptId, studentId).then(run => {
      if (!alive) return;
      if (run) window.location.replace(`/quiz-offline#${run.key}${retry ? "/retry" : ""}`);
      else setError("이 시험은 처음 시작한 기기의 브라우저에서 이어서 진행해 주세요.");
    }).catch(() => { if (alive) setError("기기의 시험 기록을 읽지 못했습니다. 저장소 접근을 확인하고 다시 열어 주세요."); });
    return () => { alive = false; };
  }, [studentId, attemptId, retry]);
  return <main id="main-content"><p role={error ? "alert" : "status"}>{error || "기기에 보관한 시험을 열고 있습니다."}</p>{error ? <ButtonLink href="/student" prefetch={false}>시험 목록</ButtonLink> : null}</main>;
}
