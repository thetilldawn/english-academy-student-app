"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "@/design-system/primitives/dialog/dialog";
import type { NotebookFilters } from "@/features/students/public-contracts";
import { practiceSettingsSchema, type PracticeInput, type PracticePreview, type PracticeSelection, type PracticeSettings, type PracticeStartInput } from "../contracts/practice";
import { PracticeRequestError, requestPracticePreview, requestPracticeStart } from "../api/practice-transport";
import styles from "../ui/practice.module.css";

export function PracticeLauncher({ keys, filters, totalCount, disabled }: { keys: string[]; filters: NotebookFilters; totalCount: number; disabled: boolean }) {
  const [selection, setSelection] = useState<PracticeSelection | null>(null);
  const [initialCount, setInitialCount] = useState(10);
  function open(value: PracticeSelection, count: number) { setInitialCount(Math.min(10, count)); setSelection(value); }
  return <div className={styles.actions}>
    <Button disabled={disabled || !keys.length || keys.length > 500} onClick={() => open({ mode: "selected", keys }, keys.length)}>선택 연습</Button>
    <Button disabled={disabled || !totalCount} onClick={() => open({ mode: "filtered", filters }, totalCount)}>조건 전체 연습</Button>
    <ButtonLink href="/student/practice" prefetch={false}>연습 내역</ButtonLink>
    {selection ? <PracticeSetup selection={selection} initialCount={initialCount} onClose={() => setSelection(null)} /> : null}
  </div>;
}
function PracticeSetup({ selection, initialCount, onClose }: { selection: PracticeSelection; initialCount: number; onClose: () => void }) {
  const router = useRouter();
  const [settings, setSettings] = useState<PracticeSettings>({ questionCount: initialCount, englishToKoreanRatio: 50, timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null });
  const [preview, setPreview] = useState<PracticePreview | null>(null);
  const [input, setInput] = useState<PracticeInput | null>(null);
  const [sent, setSent] = useState<PracticeStartInput | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const request = useRef<AbortController | null>(null), active = useRef(true), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  function change(next: PracticeSettings) { request.current?.abort(); setSettings(next); setPreview(null); setInput(null); setError(""); }
  function failed(failure: unknown) {
    if (failure instanceof PracticeRequestError && [401, 403].includes(failure.status)) { setDenied(true); setPreview(null); }
    setError(failure instanceof PracticeRequestError ? failure.message : "응답을 확인하지 못했습니다. 다시 시도해 주세요.");
  }
  async function check() {
    if (pending.current) return;
    const parsed = practiceSettingsSchema.safeParse(settings);
    if (!parsed.success) { setError("문항 수와 시간을 확인해 주세요."); return; }
    const next: PracticeInput = { requestKey: crypto.randomUUID(), selection, settings: parsed.data };
    pending.current = true; setBusy(true); setError(""); request.current = new AbortController();
    try { const value = await requestPracticePreview(next, request.current.signal); if (active.current) { setInput(next); setPreview(value); } }
    catch (failure) { if (active.current) failed(failure); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function start() {
    if (pending.current || !input || !preview?.confirmation) return;
    const next = sent ?? { ...input, confirmation: preview.confirmation };
    setSent(next); pending.current = true; setBusy(true); setError(""); request.current = new AbortController();
    try { const value = await requestPracticeStart(next, request.current.signal); if (active.current) router.push(value.attempt.status === "in_progress" ? `/student/practice/${value.attempt.id}` : `/student/practice/${value.attempt.id}/result`); }
    catch (failure) { if (active.current) {
      failed(failure);
      if (failure instanceof PracticeRequestError && failure.code === "source_changed") { setSent(null); setInput(null); setPreview(null); }
    } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <DialogFrame onRequestClose={onClose} closeDisabled={busy || !!sent} size="compact" layout="body-footer" aria-labelledby="practice-setup-title">
    <DialogHeader closeLabel="닫기"><h2 id="practice-setup-title">자율연습</h2></DialogHeader>
    <DialogBody><div className={styles.form}>
      {!denied ? <>
        <fieldset className={styles.fields} disabled={busy || !!sent}>
          <label>문항 수<input type="number" min={1} max={500} value={settings.questionCount || ""} onChange={e => change({ ...settings, questionCount: Number(e.target.value) })} /></label>
          <label>출제 방향<select value={settings.englishToKoreanRatio} onChange={e => change({ ...settings, englishToKoreanRatio: Number(e.target.value) as 0 | 50 | 100 })}><option value={100}>영어 → 뜻</option><option value={0}>뜻 → 영어</option><option value={50}>반반</option></select></label>
          <label>시간<select value={settings.timingMode} onChange={e => { const mode = e.target.value as PracticeSettings["timingMode"]; change({ ...settings, timingMode: mode, timeLimitSeconds: mode === "total" ? 240 : null, questionTimeLimitSeconds: mode === "per_question" ? 10 : null }); }}><option value="none">제한 없음</option><option value="total">전체 시간</option><option value="per_question">문제당 시간</option></select></label>
          {settings.timingMode === "total" ? <label>전체 시간(분)<input type="number" min={0.5} max={180} step={0.5} value={(settings.timeLimitSeconds ?? 0) / 60 || ""} onChange={e => change({ ...settings, timeLimitSeconds: Number(e.target.value) * 60 })} /></label> : null}
          {settings.timingMode === "per_question" ? <label>문제당 시간(초)<input type="number" min={5} max={600} value={settings.questionTimeLimitSeconds ?? ""} onChange={e => change({ ...settings, questionTimeLimitSeconds: Number(e.target.value) })} /></label> : null}
        </fieldset>
        {preview ? <section aria-label="연습 미리보기"><p>{preview.words.length}문항 · 출제 가능 {preview.availableCount}개 / 전체 {preview.totalCount}개</p>
          {preview.error ? <p role="alert">{preview.error}</p> : null}
          <ol className={styles.words}>{preview.words.map(word => <li key={word.key}><span lang="en">{word.headword}</span><span>{word.primaryMeaning}</span></li>)}</ol>
          {preview.excluded.length ? <details><summary>제외 {preview.excluded.length}개</summary><ul>{preview.excluded.map(word => <li key={word.key}>{word.headword}: {word.reason}</li>)}</ul></details> : null}
        </section> : null}
      </> : <ButtonLink href="/">처음으로</ButtonLink>}
      {busy ? <p role="status">확인 중입니다.</p> : null}{error ? <p role="alert">{error}</p> : null}
    </div></DialogBody>
    <DialogFooter>{!denied ? sent ? <><Button disabled={busy} onClick={() => void start()}>시작 결과 확인</Button>{!busy ? <ButtonLink href="/student/practice">연습 내역 확인</ButtonLink> : null}</> : preview?.confirmation ? <Button disabled={busy} onClick={() => void start()}>연습 시작</Button> : <Button disabled={busy} onClick={() => void check()}>연습할 단어 확인</Button> : null}</DialogFooter>
  </DialogFrame>;
}
