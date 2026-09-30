"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { NotebookWord } from "@/features/students/public-contracts";
import { PronunciationText } from "@/components/pronunciation-text";
import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { FitText } from "@/design-system/primitives/fit-text/fit-text";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import { useStudyAudio } from "../../controller/use-study-audio";
import { StudyBlur } from "../../ui/study-blur";
import styles from "../../ui/notebook.module.css";

type DisplayState = { hidden: "english" | "meaning" | null; setHidden: (value: "english" | "meaning" | null) => void;
  selected: Map<string, NotebookWord>; toggle: (word: NotebookWord) => void; clear: () => void; select: (words: NotebookWord[]) => void;
  preview: NotebookWord | null; setPreview: (word: NotebookWord | null) => void; denied: boolean; setDenied: (value: boolean) => void;
  audio: ReturnType<typeof useStudyAudio>; wide: boolean };
const Context = createContext<DisplayState | null>(null);
export function useNotebookDisplay() { const context = useContext(Context); if (!context) throw new Error("notebook_context_required"); return context; }
export function NotebookWorkspace({ children, detail }: { children: ReactNode; detail: ReactNode }) {
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
  const [selected, setSelected] = useState(new Map<string, NotebookWord>());
  const [preview, setPreview] = useState<NotebookWord | null>(null);
  const [denied, updateDenied] = useState(false);
  const audio = useStudyAudio();
  const { stop, play, failedWord } = audio;
  const setDenied = useCallback((value: boolean) => {
    updateDenied(value);
    if (value) { setSelected(new Map()); setPreview(null); stop(); }
  }, [stop]);
  const context = useMemo(() => ({ hidden, setHidden, selected, preview, setPreview, denied, setDenied, wide, audio: { stop, play, failedWord },
    toggle: (word: NotebookWord) => setSelected(previous => { const next = new Map(previous); if (next.has(word.key)) next.delete(word.key); else next.set(word.key, word); return next; }),
    clear: () => setSelected(new Map()), select: (words: NotebookWord[]) => setSelected(previous => new Map([...previous, ...words.map(word => [word.key, word] as const)])),
  }), [hidden, selected, preview, denied, setDenied, stop, play, failedWord, wide]);
  return <Context.Provider value={context}><div className={styles.workspace} ref={element}><div className={styles.columns}><div className={styles.main}>{children}</div>{!denied && detail}</div></div></Context.Provider>;
}

export function NotebookWordBody({ word }: { word: NotebookWord }) {
  const state = useNotebookDisplay();
  const audio = state.audio;
  const { stop } = audio;
  useEffect(() => { stop(); }, [word.key, state.hidden, stop]);
  const hideEnglish = state.hidden === "english", hideMeaning = state.hidden === "meaning";
  return <div className={styles.detailBody}>
    <div className={styles.detailTop}><span>{word.wrongCount}회 틀림</span><AudioButton variant="compact" disabled={hideEnglish || !word.pronunciation.audioUrl}
      label={hideEnglish ? "발음 가림" : `${word.headword} 듣기`} onClick={() => { if (!hideEnglish && word.pronunciation.audioUrl) void audio.play(word.key, word.pronunciation.audioUrl); }} /></div>
    <StudyBlur block concealed={hideEnglish} label="영어 가림"><h2 className={styles.detailWord} lang="en"><FitText>{word.headword}</FitText></h2>
      <FitText className={styles.pronunciation}><PronunciationText pronunciation={word.pronunciation} /></FitText></StudyBlur>
    <StudyBlur block concealed={hideMeaning} label="뜻 가림"><p className={styles.detailMeaning}>{word.primaryMeaning}</p></StudyBlur>
    {audio.failedWord ? <p role="alert">소리를 재생하지 못했습니다. 다시 눌러 주세요.</p> : null}
    {word.definition ? <section className={styles.context}><h3>영영풀이</h3><StudyBlur block concealed={!!state.hidden} label="영영풀이 가림"><p lang="en">{word.definition}</p></StudyBlur></section> : null}
    {word.example ? <section className={styles.context}><h3>예문</h3><StudyBlur block concealed={!!state.hidden} label="예문 가림"><p lang="en">{word.example}</p>{word.exampleKo ? <p>{word.exampleKo}</p> : null}</StudyBlur></section> : null}
    <dl className={styles.facts}><dt>최근 오답</dt><dd>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(word.lastWrongAt))}</dd><dt>출처</dt><dd>{word.occurrences.map((source, index) => <div key={`${source.vocabEntryId}:${index}`}><span>{source.datasetLabel}</span><StudyBlur block concealed={hideMeaning} label="뜻 가림"><p>{source.primaryMeaning}</p></StudyBlur></div>)}</dd></dl>
    <Button variant={state.selected.has(word.key) ? "primary" : "secondary"} onClick={() => state.toggle(word)}>{state.selected.has(word.key) ? "선택 해제" : "연습할 단어로 선택"}</Button>
  </div>;
}
export function NotebookPreviewPane() {
  const { preview, denied } = useNotebookDisplay();
  return preview && !denied ? <aside className={styles.previewPane} aria-label="단어 상세"><NotebookWordBody word={preview} /></aside> : null;
}
export function NotebookDetail({ word, children, presentation = "intercepted" }: { word?: NotebookWord; children?: ReactNode; presentation?: "intercepted" | "page" }) {
  const router = useRouter();
  const state = useNotebookDisplay();
  const { stop } = state.audio;
  useEffect(() => { stop(); return stop; }, [stop, word?.key]);
  const content = word ? <NotebookWordBody word={word} /> : children;
  if (state.denied) return null;
  if (presentation === "page") return <main className={styles.standalone}><ButtonLink href="/student/wordbook" prefetch={false}>내 단어장</ButtonLink>{content}</main>;
  if (state.wide) return <aside className={styles.detailPane} aria-label="단어 상세"><div className={styles.detailClose}><Button onClick={() => router.back()}>닫기</Button></div>{content}</aside>;
  return <RoutedDetailDialog heading={<h2 id="notebook-detail-title">단어 상세</h2>} titleId="notebook-detail-title" closeLabel="닫기" size="compact">{content}</RoutedDetailDialog>;
}
