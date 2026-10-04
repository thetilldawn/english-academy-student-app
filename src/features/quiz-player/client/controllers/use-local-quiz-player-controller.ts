"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { announceStudentPrivateCacheChange, studentIdentityGeneration, subscribeStudentPrivateCacheChanges } from "@/features/session/public-client";
import { LocalQuizClientError, requestLocalQuiz } from "../../api/local-quiz";
import { localPhasePlanSchema, localReceiptSchema, type CommonQuizContent, type LocalQuizRun } from "../../contracts/local-quiz";
import { phaseRemainingMs, receiptConfirmsBatch, recordLocalAnswer, restoredLocalElapsed } from "../../domain/local-quiz";
import { getLocalQuizRun, holdLocalQuizTab, readLocalQuizContents, saveLocalQuizRun } from "../flows/local-quiz-store";
import { holdLocalQuizScreen, prepareLocalQuizScreen } from "../flows/local-quiz-screen";
import { anchorLocalQuizClock } from "../flows/local-quiz-clock-anchor";
import { ANSWER_RESULT_VISIBLE_MS } from "../../domain/quiz-session";

type View = "preparing" | "playing" | "sending" | "confirmed" | "blocked" | "failed";
type Feedback = { index: number; correct: boolean; selected: number | null; answer: number; timedOut: boolean };
// Kept separately from transport failures: never advance after an aborted local write.
const localSaveMessage = "답을 기기에 보관하지 못했습니다. 선택은 그대로 두고 다시 저장해 주세요.";
function message(error: unknown) {
  if (error instanceof LocalQuizClientError) return error.message;
  if (error instanceof Error && error.message === "local_quiz_another_tab") return "다른 탭에서 이 시험을 진행 중입니다. 그 탭을 닫은 뒤 다시 열어 주세요.";
  if (error instanceof Error && error.message === "local_clock_recheck_required") return "기기 시각이 바뀌었습니다. 인터넷에 연결한 뒤 시간 확인을 눌러 주세요. 답은 보관돼 있습니다.";
  if (error instanceof Error && error.message === "local_clock_anchor_slow") return "연결이 느려 시험 시간을 확인하지 못했습니다. 다시 확인해 주세요. 원래 시험 시각은 유지됩니다.";
  return "시험 자료를 준비하지 못했습니다. 연결 후 다시 열어 주세요. 저장한 답은 기기에 보관됩니다.";
}

export function useLocalQuizPlayerController(key: string, retryIntent: boolean, detachedScreen = false) {
  const [run, setRun] = useState<LocalQuizRun | null>(null);
  const [contents, setContents] = useState(new Map<string, CommonQuizContent>());
  const [view, setView] = useState<View>("preparing"); const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(Infinity); const [pendingChoice, setPendingChoice] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null); const [busy, setBusy] = useState(false);
  const current = useRef<LocalQuizRun | null>(null); const active = useRef(false); const locked = useRef(false);
  const epoch = useRef({ monotonic: 0, elapsed: 0 }); const serial = useRef(false);
  const network = useRef<AbortController | null>(null); const released = useRef(Promise.resolve());
  const selection = useRef<{ choice: number; elapsed: number } | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedWrite = useRef<LocalQuizRun | null>(null); const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materialReady = useRef(false);
  const elapsed = useCallback(() => Math.floor(epoch.current.elapsed + Math.max(0, performance.now() - epoch.current.monotonic)), []);
  const publish = useCallback((value: LocalQuizRun) => { current.current = value; if (active.current) setRun(value); }, []);
  const sameIdentity = useCallback(() => {
    try { return !locked.current && studentIdentityGeneration() === current.current?.identity; } catch { return false; }
  }, []);
  const block = useCallback(() => {
    locked.current = true; network.current?.abort(); selection.current = null;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback(null); setPendingChoice(null); setView("blocked"); setError("계정 확인이 필요합니다. 다시 로그인한 뒤 이어가기를 눌러 주세요. 답안은 기기에 보관돼 있습니다.");
  }, []);
  const persist = useCallback(async (value: LocalQuizRun) => {
    const previous = current.current;
    if (!previous || !sameIdentity()) throw new Error("local_identity_changed");
    failedWrite.current = value;
    await saveLocalQuizRun(value, previous.revision);
    failedWrite.current = null;
    current.current = value;
    if (!active.current || !sameIdentity()) {
      if (active.current) block();
      throw new DOMException("Identity changed after local commit", "AbortError");
    }
    publish(value);
  }, [sameIdentity, publish, block]);
  const startPhase = useCallback(async (retry: boolean) => {
    let previous = current.current;
    if (!previous || serial.current || !sameIdentity()) return;
    serial.current = true; setError(""); setView("preparing");
    try {
      if (!previous.startRequested) { await persist({ ...previous, revision: previous.revision + 1, startRequested: true }); previous = current.current!; }
      if (!active.current || !sameIdentity()) return;
      const sent = performance.now();
      network.current = new AbortController();
      const plan = localPhasePlanSchema.parse(await requestLocalQuiz(retry
        ? { action: "retry", attemptId: previous.plan!.attemptId, device: previous.device }
        : { action: "begin", preparationId: previous.preparation.preparationId, planHash: previous.preparation.planHash, device: previous.device }, network.current.signal));
      if (!active.current || !sameIdentity()) return;
      const preparedItems = previous.preparation.items;
      if (plan.phase !== (retry ? "retry" : "initial") || plan.items.some(q => !preparedItems.some(i => i.contentId === q.contentId))) throw new Error("local_plan_conflict");
      const { elapsed: initialElapsed } = await anchorLocalQuizClock(plan, sent, previous.device, network.current.signal);
      if (!active.current || !sameIdentity()) return;
      epoch.current = { monotonic: performance.now(), elapsed: initialElapsed };
      const next = { ...previous, revision: previous.revision + 1, plan, startRequested: false, answers: [], openedMs: 0, batch: null, receipt: null,
        clock: { wallAt: Date.now(), elapsedAt: initialElapsed } };
      await persist(next);
      if (active.current && sameIdentity()) setView("playing");
    } catch (e) { if (active.current && sameIdentity()) {
      if (e instanceof LocalQuizClientError && [401, 403].includes(e.status)) block();
      else { setError(failedWrite.current ? localSaveMessage : message(e)); setView("failed"); }
    } }
    finally { serial.current = false; network.current = null; }
  }, [persist, sameIdentity, block]);
  const submit = useCallback(async () => {
    const value = current.current;
    if (!value?.batch || value.receipt || serial.current || !sameIdentity()) return;
    serial.current = true; setView("sending"); setError(""); network.current = new AbortController();
    try {
      const receipt = localReceiptSchema.parse(await requestLocalQuiz({ action: "submit", device: value.device, batch: value.batch }, network.current.signal));
      if (!active.current || !sameIdentity()) return;
      if (!await receiptConfirmsBatch(value.batch, receipt)) throw new Error("local_receipt_incomplete");
      await persist({ ...value, revision: value.revision + 1, receipt });
      if (active.current && sameIdentity()) { announceStudentPrivateCacheChange("mistakes"); setView("confirmed"); }
    } catch (e) {
      if (active.current && sameIdentity()) {
        if (e instanceof LocalQuizClientError && [401, 403].includes(e.status)) block();
        else { setError(failedWrite.current ? localSaveMessage : message(e)); setView("failed"); }
      }
    } finally { serial.current = false; network.current = null; }
  }, [persist, sameIdentity, block]);
  const showCommittedAnswer = useCallback((previous: LocalQuizRun, next: LocalQuizRun) => {
    const index = previous.answers.length;
    const answer = next.answers[index]; const question = previous.plan?.items[index];
    selection.current = null; setPendingChoice(null); setError(""); setBusy(true); setView("playing");
    if (answer && question) setFeedback({ index, correct: answer.kind === "answer" && answer.choice === question.correctChoiceIndex,
      selected: answer.choice, answer: question.correctChoiceIndex, timedOut: answer.kind !== "answer" });
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null; setFeedback(null); setBusy(false);
      if (next.batch) void submit();
    }, ANSWER_RESULT_VISIBLE_MS);
  }, [submit]);
  const accept = useCallback(async (choice: number | null, at: number) => {
    const value = current.current;
    if (!value?.plan || value.batch || serial.current || !sameIdentity()) return;
    serial.current = true; setBusy(true); setError("");
    try {
      const next = recordLocalAnswer(value, choice, at, Date.now(), crypto.randomUUID());
      next.clock = { wallAt: Date.now(), elapsedAt: Math.max(at, elapsed()) };
      await persist(next);
      if (!active.current || !sameIdentity()) return;
      showCommittedAnswer(value, next);
    } catch (e) {
      if (active.current && sameIdentity()) { setError(failedWrite.current ? localSaveMessage : message(e)); setView("failed"); }
    } finally { serial.current = false; }
  }, [elapsed, persist, sameIdentity, showCommittedAnswer]);
  const choose = useCallback((choice: number) => {
    const value = current.current; const at = elapsed();
    if (!value?.plan || view !== "playing" || feedback || busy || value.batch || !sameIdentity() || at < value.openedMs || phaseRemainingMs(value.plan, value.openedMs, at) <= 0) return;
    selection.current = { choice, elapsed: at }; setPendingChoice(choice);
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => {
      selectionTimer.current = null;
      const selected = selection.current; if (selected) void accept(selected.choice, selected.elapsed);
    }, 20);
  }, [elapsed, view, feedback, busy, sameIdentity, accept]);
  useEffect(() => {
    active.current = true; locked.current = false; materialReady.current = false;
    const abort = new AbortController(); let disposed = false;
    let releaseScreen: (() => void) | undefined;
    // A StrictMode cleanup may precede a pending Web Lock acquisition. Wait for
    // that acquisition AND its actual release before the next setup can ask.
    const acquisition = released.current.then(() => holdLocalQuizTab(key));
    let releaseTab!: () => void;
    released.current = new Promise<void>(resolve => {
      releaseTab = () => { void acquisition.then(unlock => unlock()).catch(() => {}).finally(resolve); };
    });
    const stop = subscribeStudentPrivateCacheChanges(kind => { if (kind === "identity") block(); });
    const check = () => { if (current.current && !sameIdentity()) block(); };
    window.addEventListener("pageshow", check); document.addEventListener("visibilitychange", check);
    (async () => {
      try {
        await acquisition;
        if (disposed) return;
        const value = await getLocalQuizRun(key);
        if (disposed) return;
        if (!value) throw new Error("local_quiz_missing");
        publish(value);
        if (!sameIdentity()) { block(); return; }
        const material = await readLocalQuizContents(value.preparation.items.map(i => i.key), true);
        if (material.size !== new Set(value.preparation.items.map(i => i.key)).size) throw new Error("local_content_missing");
        await prepareLocalQuizScreen(detachedScreen);
        if (disposed || !sameIdentity()) return;
        releaseScreen = await holdLocalQuizScreen(abort.signal);
        if (disposed || !sameIdentity()) { releaseScreen(); return; }
        setContents(material);
        materialReady.current = true;
        if (!value.plan) { await startPhase(false); return; }
        epoch.current = { monotonic: performance.now(), elapsed: restoredLocalElapsed(value.clock, Date.now()) };
        if (value.receipt) { if ((retryIntent || value.startRequested) && !value.receipt.result.finalized && value.plan.phase === "initial") await startPhase(true); else setView("confirmed"); }
        else if (value.batch) await submit();
        else setView("playing");
      } catch (e) { if (!disposed && !locked.current) { setError(message(e)); setView("failed"); } }
    })();
    return () => {
      disposed = true; active.current = false; abort.abort(); network.current?.abort(); stop();
      window.removeEventListener("pageshow", check); document.removeEventListener("visibilitychange", check);
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      releaseTab();
      releaseScreen?.();
    };
  }, [key, retryIntent, block, sameIdentity, publish, startPhase, submit, detachedScreen]);
  useEffect(() => {
    if (view !== "playing") return;
    const tick = () => {
      const value = current.current;
      if (!value?.plan || value.batch || !sameIdentity()) return;
      const at = elapsed(); const left = phaseRemainingMs(value.plan, value.openedMs, at); setRemaining(left);
      if (left === 0 && !selection.current && !serial.current && !feedbackTimer.current) void accept(null, at);
    };
    tick(); const timer = setInterval(tick, 50); return () => clearInterval(timer);
  }, [view, elapsed, sameIdentity, accept]);
  const recover = useCallback(async () => {
    const value = current.current; if (serial.current) return;
    if (!value) { window.location.reload(); return; }
    if (failedWrite.current && sameIdentity()) {
      serial.current = true;
      try {
        const next = failedWrite.current; await persist(next);
        if (!active.current || !sameIdentity()) return;
        epoch.current = { monotonic: performance.now(), elapsed: restoredLocalElapsed(next.clock, Date.now()) };
        if (next.answers.length > value.answers.length && next.plan?.phase === value.plan?.phase) {
          showCommittedAnswer(value, next); return;
        }
        setError(""); setBusy(false); selection.current = null; setPendingChoice(null);
        if (!next.plan) { window.location.reload(); return; }
        setView(next.receipt ? "confirmed" : next.batch ? "failed" : "playing");
        if (next.receipt) announceStudentPrivateCacheChange("mistakes");
        if (next.batch && !next.receipt) { serial.current = false; void submit(); }
      } catch { if (active.current && sameIdentity()) setError(localSaveMessage); }
      finally { serial.current = false; }
      return;
    }
    if (!sameIdentity()) {
      serial.current = true; network.current = new AbortController();
      try {
        const generation = studentIdentityGeneration();
        const identity = z.object({ studentId: z.uuid() }).parse(await requestLocalQuiz({ action: "identity" }, network.current.signal));
        if (!active.current || generation !== studentIdentityGeneration()) return;
        if (identity.studentId !== value.studentId || generation !== studentIdentityGeneration()) throw new Error("local_identity_changed");
        const durable = await getLocalQuizRun(value.key);
        if (!active.current || generation !== studentIdentityGeneration()) return;
        if (!durable || durable.studentId !== identity.studentId) throw new Error("local_identity_changed");
        const candidate = failedWrite.current;
        if (candidate && (candidate.key !== durable.key || candidate.studentId !== durable.studentId || candidate.revision !== durable.revision + 1)) throw new Error("local_pending_answer_conflict");
        const restored = { ...(candidate ?? durable), revision: durable.revision + 1, identity: generation };
        await saveLocalQuizRun(restored, durable.revision);
        failedWrite.current = null;
        if (active.current && generation === studentIdentityGeneration()) window.location.reload();
      } catch { if (active.current) setError("시험을 시작한 학생으로 다시 로그인해 주세요. 답은 기기에 보관돼 있습니다."); }
      finally { serial.current = false; network.current = null; }
      return;
    }
    if (!materialReady.current) { window.location.reload(); return; }
    if (value.startRequested) { void startPhase(value.plan?.phase === "initial" && Boolean(value.receipt)); return; }
    if (value.batch) { void submit(); return; }
    // A clock rollback needs a fresh server anchor, without changing the original deadline.
    if (value.plan) {
      serial.current = true; network.current = new AbortController();
      try {
        const sent = performance.now();
        const plan = localPhasePlanSchema.parse(await requestLocalQuiz({ action: "read", attemptId: value.plan.attemptId, phase: value.plan.phase, device: value.device }, network.current.signal));
        if (plan.planHash !== value.plan.planHash) throw new Error("local_plan_conflict");
        const anchor = await anchorLocalQuizClock(plan, sent, value.device, network.current.signal);
        if (!active.current || !sameIdentity()) return;
        const at = Math.max(value.clock.elapsedAt, anchor.elapsed);
        await persist({ ...value, revision: value.revision + 1, clock: { wallAt: Date.now(), elapsedAt: at } });
        if (!active.current || !sameIdentity()) return;
        epoch.current = { monotonic: performance.now(), elapsed: at }; setError(""); setBusy(false); setView("playing");
      } catch (e) { if (active.current && sameIdentity()) {
        if (e instanceof LocalQuizClientError && [401, 403].includes(e.status)) block(); else setError(message(e));
      } }
      finally { serial.current = false; network.current = null; }
    } else window.location.reload();
  }, [sameIdentity, persist, submit, startPhase, block, showCommittedAnswer]);
  useEffect(() => {
    const online = () => { if (current.current?.batch && !current.current.receipt && sameIdentity()) void submit(); };
    window.addEventListener("online", online); return () => window.removeEventListener("online", online);
  }, [sameIdentity, submit]);
  return { run, contents, view, error, remaining, pendingChoice, feedback, busy, choose, recover, retry: () => startPhase(true) };
}
