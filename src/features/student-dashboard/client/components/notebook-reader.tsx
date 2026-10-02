"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { notebookWordToken, mistakeFiltersSchema, type MistakeStudyPage, type MistakeFilters } from "@/features/students/public-contracts";
import { PracticeLauncher } from "@/features/quiz-player/public-ui";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import { FitText } from "@/design-system/primitives/fit-text/fit-text";
import { PronunciationText } from "@/components/pronunciation-text";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import { useNotebook } from "../controllers/use-notebook";
import { useNotebookDisplay } from "./notebook-detail";
import { StudyBlur } from "../../ui/study-blur";
import { StudyVisibilityControls } from "../../ui/study-visibility-controls";
import styles from "../../ui/notebook.module.css";

export function NotebookReader({ initial, initialIdentity, initialFilters = mistakeFiltersSchema.parse({ view: initial.view }) }: { initial: MistakeStudyPage; initialIdentity: string; initialFilters?: MistakeFilters }) {
  const display = useNotebookDisplay();
  const view = useNotebook(initial, initialFilters, { identity: display.identity, initialIdentity });
  const audio = display.audio;
  const [query, setQuery] = useState("");
  const [countMode, setCountMode] = useState("all");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const { stop } = audio;
  const { setPreview, setDenied, invalidate, setSnapshot, setAvailable } = display;
  useEffect(() => { if (view.resetRevision) invalidate(); }, [view.resetRevision, invalidate]);
  useEffect(() => { if (view.fresh && !view.busy) setSnapshot(view.page.view, view.page.stateVersion, view.page.sourceVersion); else setAvailable(false); }, [view.fresh, view.busy, view.page.view, view.page.stateVersion, view.page.sourceVersion, setSnapshot, setAvailable]);
  useEffect(() => { setPreview(view.fresh ? view.page.items[0] ?? null : null); }, [view.page.items, view.fresh, setPreview]);
  useEffect(() => { setDenied(view.denied); }, [view.denied, setDenied]);
  useEffect(() => { stop(); }, [display.hidden, stop]);
  const englishHidden = display.hidden === "english", meaningHidden = display.hidden === "meaning";
  if (view.denied) return <main className={styles.reader}><p role="alert">다시 로그인해 주세요.</p><ButtonLink href="/">처음으로</ButtonLink></main>;
  return <main className={styles.reader} id="main-content">
    <header className={styles.heading}><h1>내 단어장</h1><ButtonLink href="/student" prefetch={false}>시험 목록</ButtonLink></header>
    <Tabs ariaLabel="오답 보기" value={view.filters.view} items={[{ value: "current", label: "현재 오답" }, { value: "history", label: "과거 이력" }]}
      onChange={next => { invalidate(); void view.load({ ...view.filters, view: next }); }} />
    <p className={styles.viewNote}>{view.filters.view === "current" ? "아직 해결하지 못한 뜻입니다. 정규 시험에서 해당 뜻을 맞히면 현재 오답에서 빠집니다." : "해결한 뜻을 포함한 학습 이력입니다. 연습해도 정규 시험 기록은 바뀌지 않습니다."}</p>
    <form className={styles.filters} onSubmit={event => { event.preventDefault(); void view.load({ ...view.filters, query,
      ...(countMode === "custom" ? { minWrongCount: minimum ? Number(minimum) : undefined, maxWrongCount: maximum ? Number(maximum) : undefined } : {}),
    }); }}>
      <input aria-label="단어 검색" placeholder="단어 또는 뜻 검색" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} />
      <Button type="submit">검색</Button>
      <select aria-label="단어장" value={view.filters.datasetId} onChange={event => void view.load({ ...view.filters, datasetId: event.target.value })}><option value="">전체 단어장</option>{view.page.datasetOptions?.map(book => <option key={book.id} value={book.id}>{book.label}</option>)}</select>
      <select aria-label="틀린 횟수" value={countMode} onChange={event => {
        const value = event.target.value; setCountMode(value);
        if (value !== "custom") void view.load({ ...view.filters, minWrongCount: value === "all" ? undefined : Number(value), maxWrongCount: value === "1" ? 1 : undefined });
      }}>
        <option value="all">전체 횟수</option><option value="1">1회</option><option value="2">2회 이상</option><option value="3">3회 이상</option><option value="5">5회 이상</option><option value="custom">횟수 직접 지정</option>
      </select>
      {countMode === "custom" ? <><input aria-label="최소 오답 횟수" inputMode="numeric" pattern="[1-9][0-9]*" placeholder="최소 횟수" value={minimum} onChange={event => setMinimum(event.target.value)} /><input aria-label="최대 오답 횟수" inputMode="numeric" pattern="[1-9][0-9]*" placeholder="최대 횟수" value={maximum} onChange={event => setMaximum(event.target.value)} /></> : null}
    </form>
    <div className={styles.toolbar}><StudyVisibilityControls englishHidden={englishHidden} meaningHidden={meaningHidden} canHideMeaning
      onToggleEnglish={() => display.setHidden(englishHidden ? null : "english")} onToggleMeaning={() => display.setHidden(meaningHidden ? null : "meaning")} />
      <select aria-label="정렬" value={view.filters.sort} onChange={event => void view.load({ ...view.filters, sort: event.target.value as "count" | "recent" })}><option value="count">많이 틀린 순</option><option value="recent">최근 틀린 순</option></select></div>
    <div className={styles.selection}><Button disabled={!view.fresh || !view.page.items.length} onClick={() => display.select(view.page.items)}>표시된 단어 선택</Button><span>{display.selected.size}개 뜻 선택</span><Button onClick={display.clear} disabled={!display.selected.size}>전체 선택 해제</Button></div>
    <PracticeLauncher mistakes={{ mode: "mistakes", view: view.filters.view, stateVersion: view.page.stateVersion,
      meanings: [...display.selected.values()].map(({ wordKey, meaning }) => ({ wordKey, meaningKey: meaning.meaningKey, episodeId: meaning.episodeId })) }}
      filters={view.filters} totalCount={view.page.totalCount ?? 0} disabled={!view.fresh || view.busy} privacyReady={view.fresh && !view.denied}
      onSourceChanged={() => { invalidate(); view.invalidate(); void view.retry(); }} />
    {view.error ? <div className={styles.notice} role="alert"><p>{view.error}</p><Button onClick={() => void view.retry()} disabled={view.busy}>다시 시도</Button></div> : null}
    {view.busy ? <p role="status">단어를 불러오는 중입니다.</p> : null}
    {!view.fresh ? null : <>
      <p className={styles.count}>{view.page.totalCount}개 단어 · {view.filters.view === "current" ? "현재" : "전체"} 오답 {view.filters.view === "current" ? view.page.summary?.currentWrongCount : view.page.summary?.lifetimeWrongCount}회</p>
      {!view.page.items.length ? <p>조건에 맞는 단어가 없습니다.</p> : <ul className={styles.list} aria-label="내 단어장">
        {view.page.items.map((word, index) => <li className={styles.row} data-selected={word.meanings.every(meaning => display.selected.has(meaning.meaningKey))} key={word.key}>
          <label className={styles.check}><input type="checkbox" aria-label={englishHidden ? `${index + 1}번 단어 선택` : `${word.headword} 선택`} checked={word.meanings.every(meaning => display.selected.has(meaning.meaningKey))} onChange={() => display.toggle(word)} /></label>
          <Link className={styles.wordLink} href={`/student/wordbook/${notebookWordToken(word.key)}?view=${view.filters.view}${view.filters.view === "history" ? `&upperVersion=${view.page.stateVersion}` : ""}`} prefetch={false} scroll={false} aria-label={englishHidden ? `${index + 1}번 단어 상세` : `${word.headword} 상세`}>
            <StudyBlur block concealed={englishHidden} label="영어 가림"><span className={styles.word} lang="en"><FitText>{word.headword}</FitText></span><FitText className={styles.pronunciation}><PronunciationText pronunciation={word.pronunciation} /></FitText></StudyBlur>
            <StudyBlur block concealed={meaningHidden} label="뜻 가림"><span className={styles.meaning}>{word.primaryMeaning}</span></StudyBlur>
          </Link>
          <span className={styles.wrongCount}>{view.filters.view === "current" ? word.currentWrongCount : word.lifetimeWrongCount}회{word.legacyWrongCount ? <small>이전 기록 포함</small> : null}{word.currentMissedCount ? <small>미응답 {word.currentMissedCount}회</small> : null}</span>
          <div className={styles.audio}><AudioButton variant="compact" disabled={englishHidden || !word.pronunciation.audioUrl} label={englishHidden ? "발음 가림" : `${word.headword} 듣기`}
            onClick={() => { if (!englishHidden && word.pronunciation.audioUrl) void audio.play(word.key, word.pronunciation.audioUrl); }} /></div>
          {audio.failedWord === word.key ? <p className={styles.rowError} role="alert">소리를 재생하지 못했습니다. 다시 눌러 주세요.</p> : null}
        </li>)}
      </ul>}
      {view.page.nextCursor ? <Button className={styles.more} disabled={view.busy} onClick={() => void view.more()}>10개 더보기</Button> : null}
    </>}
  </main>;
}
