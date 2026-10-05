"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { announceStudentPrivateCacheChange, subscribeStudentPrivateCacheChanges, useInitialServerHydration } from "@/features/session/public-client";
import { useNotebookDetail } from "../controllers/use-notebook-detail";
import type { MistakeStudyWord as NotebookWord } from "@/features/students/public-contracts";
import { PronunciationText } from "@/components/pronunciation-text";
import { MistakeEpisodeHistory } from "@/features/students/public-client";
import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { FitText } from "@/design-system/primitives/fit-text/fit-text";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import { useStudyAudio } from "../../controller/use-study-audio";
import { StudyBlur } from "../../ui/study-blur";
import styles from "../../ui/notebook.module.css";

type Selection = { wordKey: string; meaning: NotebookWord["meanings"][number] };
type Snapshot = { view: "current" | "history"; version: string; sourceVersion: string };
type DisplayState = { readonly identity: string; hidden: "english" | "meaning" | null; setHidden: (value: "english" | "meaning" | null) => void;
  selected: Map<string, Selection>; toggle: (word: NotebookWord, meaningKey?: string) => void; clear: () => void; select: (words: NotebookWord[]) => void;
  preview: NotebookWord | null; setPreview: (word: NotebookWord | null) => void; denied: boolean; setDenied: (value: boolean) => void;
  snapshot: Snapshot | null; setSnapshot: (view: "current" | "history", version: string, sourceVersion: string) => void;
  valid: boolean; setAvailable: (value: boolean) => void; invalidate: () => void;
  audio: ReturnType<typeof useStudyAudio>; wide: boolean };
const Context = createContext<DisplayState | null>(null);
export function useNotebookDisplay() { const context = useContext(Context); if (!context) throw new Error("notebook_context_required"); return context; }
export function NotebookWorkspace({ children, detail, identity }: { children: ReactNode; detail: ReactNode; identity: string }) {
  const hydrating = useInitialServerHydration();
  const element = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const update = () => { const style = getComputedStyle(node); setWide(node.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0") > 680); };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node); window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  const [hidden, setHidden] = useState<DisplayState["hidden"]>(null);
  const [selected, setSelected] = useState(new Map<string, Selection>());
  const [preview, setPreview] = useState<NotebookWord | null>(null);
  const [denied, updateDenied] = useState(false);
  const [snapshot, updateSnapshot] = useState<Snapshot | null>(null), snapshotRef = useRef<Snapshot | null>(null);
  const [valid, setAvailable] = useState(hydrating);
  const audio = useStudyAudio();
  const { stop, play, failedWord } = audio;
  const clear = useCallback(() => setSelected(new Map()), []);
  const invalidate = useCallback(() => { clear(); setPreview(null); setAvailable(false); stop(); }, [clear, stop]);
  const setSnapshot = useCallback((view: "current" | "history", version: string, sourceVersion: string) => {
    const old = snapshotRef.current;
    if (!old || old.view !== view || old.version !== version || old.sourceVersion !== sourceVersion) {
      clear(); setPreview(null); stop(); const next = { view, version, sourceVersion }; snapshotRef.current = next; updateSnapshot(next);
    }
    setAvailable(true);
  }, [clear, stop]);
  const setDenied = useCallback((value: boolean) => {
    if (value) updateDenied(true);
    if (value) { setSelected(new Map()); setPreview(null); stop(); }
  }, [stop]);
  useEffect(() => {
    const unsubscribe = subscribeStudentPrivateCacheChanges(kind => { invalidate(); if (kind === "identity") setDenied(true); });
    const hidden = () => { if (document.visibilityState === "hidden") invalidate(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", invalidate);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", invalidate); };
  }, [invalidate, setDenied]);
  const context = useMemo(() => ({ identity, hidden, setHidden, selected, preview, setPreview, denied, setDenied, wide, snapshot, setSnapshot, valid, setAvailable, invalidate, audio: { stop, play, failedWord },
    toggle: (word: NotebookWord, meaningKey?: string) => setSelected(previous => {
      const meanings = word.meanings.filter(meaning => !meaningKey || meaning.meaningKey === meaningKey);
      if (!valid || snapshot && (snapshot.sourceVersion !== word.sourceVersion || meanings.some(meaning => snapshot.version !== meaning.stateVersion))) return previous;
      const next = new Map(previous), remove = meanings.every(meaning => next.has(meaning.meaningKey));
      for (const meaning of meanings) { if (remove) next.delete(meaning.meaningKey); else next.set(meaning.meaningKey, { wordKey: word.key, meaning }); }
      return next;
    }),
    clear, select: (words: NotebookWord[]) => setSelected(previous => {
      if (!valid) return previous;
      const next = new Map(previous);
      for (const word of words) for (const meaning of word.meanings) if (!snapshot || snapshot.version === meaning.stateVersion && snapshot.sourceVersion === word.sourceVersion) next.set(meaning.meaningKey, { wordKey: word.key, meaning });
      return next;
    }),
  }), [identity, hidden, selected, preview, denied, setDenied, stop, play, failedWord, wide, snapshot, setSnapshot, valid, invalidate, clear]);
  return <Context.Provider value={context}><div className={styles.workspace} ref={element}>{denied ? <main><p role="alert">다시 로그인해 주세요.</p><ButtonLink href="/">처음으로</ButtonLink></main> : <div className={styles.columns}><div className={styles.main}>{children}</div>{detail}</div>}</div></Context.Provider>;
}

export function NotebookWordBody({ word }: { word: NotebookWord }) {
  const state = useNotebookDisplay();
  const audio = state.audio;
  const { stop } = audio;
  useEffect(() => { stop(); }, [word.key, state.hidden, stop]);
  const hideEnglish = state.hidden === "english", hideMeaning = state.hidden === "meaning";
  return <div className={styles.detailBody}>
    <div className={styles.detailTop}><span>현재 오답 {word.currentWrongCount}회 · 전체 {word.lifetimeWrongCount}회</span><AudioButton variant="compact" disabled={hideEnglish || !word.pronunciation.audioUrl}
      label={hideEnglish ? "발음 가림" : `${word.headword} 듣기`} onClick={() => { if (!hideEnglish && word.pronunciation.audioUrl) void audio.play(word.key, word.pronunciation.audioUrl); }} /></div>
    <StudyBlur block concealed={hideEnglish} label="영어 가림"><h2 className={styles.detailWord} lang="en"><FitText>{word.headword}</FitText></h2>
      <FitText className={styles.pronunciation}><PronunciationText pronunciation={word.pronunciation} /></FitText></StudyBlur>
    <StudyBlur block concealed={hideMeaning} label="뜻 가림"><p className={styles.detailMeaning}>{word.primaryMeaning}</p></StudyBlur>
    {audio.failedWord ? <p role="alert">소리를 재생하지 못했습니다. 다시 눌러 주세요.</p> : null}
    {word.definition ? <section className={styles.context}><h3>영영풀이</h3><StudyBlur block concealed={!!state.hidden} label="영영풀이 가림"><p lang="en">{word.definition}</p></StudyBlur></section> : null}
    {word.example ? <section className={styles.context}><h3>예문</h3><StudyBlur block concealed={!!state.hidden} label="예문 가림"><p lang="en">{word.example}</p>{word.exampleKo ? <p>{word.exampleKo}</p> : null}</StudyBlur></section> : null}
    <section className={styles.meaningList} aria-label="뜻별 오답">
      {word.meanings.map((meaning, index) => <section className={styles.meaningItem} key={meaning.meaningKey}>
        <div className={styles.meaningHeading}><label><input type="checkbox" checked={state.selected.has(meaning.meaningKey)} disabled={!state.valid}
          aria-label={`${index + 1}번째 뜻 연습 선택`} onChange={() => state.toggle(word, meaning.meaningKey)} />
          {meaning.testedField === "primary_meaning" ? "뜻" : meaning.testedField === "definition" ? "영영풀이" : "예문"} {index + 1}</label><span>{meaning.unresolved ? "복습 필요" : "해결"}</span></div>
        <StudyBlur block concealed={hideMeaning || meaning.testedField !== "primary_meaning" && hideEnglish} label="뜻 가림"><p>{meaning.selectedText}</p></StudyBlur>
        <p>현재 {meaning.currentWrongCount}회 · 전체 {meaning.lifetimeWrongCount}회{meaning.currentMissedCount ? ` · 현재 미응답 ${meaning.currentMissedCount}회` : ""}</p>
        {meaning.countQuality === "legacy-continuation" || meaning.legacyWrongCount > 0 ? <p className={styles.legacyNote}>이전 방식 기록 {meaning.legacyWrongCount}건 포함 · 당시 재시험 횟수는 일부 확인할 수 없습니다.</p> : null}
        <p className={styles.sourceLabels}>{meaning.sources.map(source => source.label).join(" · ")}</p>
        {meaning.episodes.length ? <MistakeEpisodeHistory reader={{ kind: "student", identity: state.identity }} meaningKey={meaning.meaningKey}
          upperVersion={meaning.stateVersion} episodeCount={meaning.episodeCount} initial={meaning.episodes} initialCursor={meaning.episodeNextCursor}
          enabled={state.valid && !state.denied} onInvalidated={status => {
            state.invalidate(); if (status === 401 || status === 403) state.setDenied(true); else announceStudentPrivateCacheChange("mistakes");
          }} /> : null}
      </section>)}
    </section>
    <dl className={styles.facts}><dt>최근 오답</dt><dd>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(word.lastWrongAt))}</dd></dl>
  </div>;
}
export function NotebookPreviewPane() {
  const { preview, denied, valid } = useNotebookDisplay();
  return preview && !denied && valid ? <aside className={styles.previewPane} aria-label="단어 상세"><NotebookWordBody word={preview} /></aside> : null;
}
export function NotebookDetail({ word: initialWord, children, initialIdentity, view = "current", presentation = "intercepted" }: { word?: NotebookWord; children?: ReactNode; initialIdentity?: string; view?: "current" | "history"; presentation?: "intercepted" | "page" }) {
  const router = useRouter();
  const state = useNotebookDisplay();
  const checked = useNotebookDetail({ word: initialWord, view, identity: state.identity, initialIdentity, enabled: presentation === "page" && !!initialWord });
  const word = presentation === "page" ? checked.word ?? undefined : initialWord;
  const { stop } = state.audio;
  const { setSnapshot, setDenied, identity } = state;
  useEffect(() => { if (initialWord && (initialIdentity !== identity || presentation === "page" && checked.denied)) setDenied(true);
    else if (presentation === "page" && word) setSnapshot(view, word.meanings[0].stateVersion, word.sourceVersion);
  }, [presentation, word, initialWord, checked.denied, view, setSnapshot, setDenied, identity, initialIdentity]);
  useEffect(() => { stop(); return stop; }, [stop, word?.key]);
  const stale = !!word && initialIdentity !== identity || !state.valid || !!word && !!state.snapshot && (state.snapshot.view !== view
    || state.snapshot.version !== word.meanings[0].stateVersion || state.snapshot.sourceVersion !== word.sourceVersion);
  const content = !initialWord ? children : presentation === "page" && !word ? <div className={styles.notice}>{checked.error ? <><p role="alert">{checked.error}</p><Button disabled={checked.busy} onClick={() => void checked.retry()}>다시 시도</Button></> : <p role="status">단어를 확인하는 중입니다.</p>}</div>
    : stale ? <p role="status" className={styles.notice}>목록이 바뀌었습니다. 최신 목록에서 단어를 다시 열어 주세요.</p> : word ? <NotebookWordBody word={word} /> : children;
  if (state.denied) return null;
  if (presentation === "page") return <main className={styles.standalone}><ButtonLink href={`/student/wordbook?view=${view}`} prefetch={false}>내 단어장</ButtonLink>{content}</main>;
  if (state.wide) return <aside className={styles.detailPane} aria-label="단어 상세"><div className={styles.detailClose}><Button onClick={() => router.back()}>닫기</Button></div>{content}</aside>;
  return <RoutedDetailDialog heading={<h2 id="notebook-detail-title">단어 상세</h2>} titleId="notebook-detail-title" closeLabel="닫기" size="compact"
    headerActions={<ButtonLink href="/student" prefetch={false} size="small" variant="quiet">메인으로</ButtonLink>}>{content}</RoutedDetailDialog>;
}
