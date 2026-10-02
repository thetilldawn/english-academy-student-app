import { Checkbox } from "@/design-system/primitives/form/field";
import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";
import { formatKoreanDateTime } from "@/lib/format";
import { type AdminMistakePageView, type MistakeFilters } from "../../contracts/mistake-episode";
import { mistakeSelectionKey, selectMistakeTarget } from "../../domain/mistake-selection";
import type { WrongWordSelectionPurpose } from "../../domain/wrong-word-selection";
import styles from "./student-wrong-word-panel.module.css";
import { MistakeEpisodeHistory } from "./mistake-episode-history";

const fieldLabels = { primary_meaning: "뜻", definition: "영영 뜻", example: "예문" };
export function MistakeList({ studentId, onInvalidated, words, view, datasetFilter, disabled, purpose, selectedQuestionIds, worksheetSelectionLimitReached, onToggleQuestion }: {
  studentId: string; onInvalidated: (status: number) => void;
  words: AdminMistakePageView["items"]; view: MistakeFilters["view"]; datasetFilter: string; disabled: boolean;
  purpose: WrongWordSelectionPurpose; selectedQuestionIds: readonly string[]; worksheetSelectionLimitReached: boolean; onToggleQuestion: (id: string) => void;
}) {
  if (!words.length) return <EmptyState>{view === "current" ? "선택한 조건에 현재 오답이 없습니다. 새로 틀린 단어가 생기면 여기에 모입니다." : "선택한 조건에 지난 오답 이력이 없습니다."}</EmptyState>;
  return <div className={styles.list}>{words.map(word => <article className={styles.mistakeCard} key={word.key}>
    <header className={styles.mistakeHeading}><strong>{word.headword}</strong><span>현재 {word.currentWrongCount}회 · 누적 {word.lifetimeWrongCount}회</span></header>
    {word.meanings.map(meaning => {
      const key = mistakeSelectionKey(meaning), selected = selectedQuestionIds.includes(key);
      const target = selectMistakeTarget(meaning, datasetFilter), selectable = target && (purpose === "worksheet" || meaning.scheduling === "available");
      const status = !meaning.unresolved ? "해결됨" : !meaning.isCurrentEpisode ? "지난 구간" : meaning.scheduling === "assigned" ? "시험 배정됨" : meaning.scheduling === "queued" ? "다음 시험 대기" : "학습 필요";
      return <section className={styles.mistakeMeaning} key={meaning.meaningKey}>
        <label className={styles.mistakeChoice}><Checkbox checked={selected}
          disabled={disabled || !selectable || (purpose === "worksheet" && !selected && worksheetSelectionLimitReached)}
          onChange={() => onToggleQuestion(key)} /><span><small>{fieldLabels[meaning.testedField]}</small> {meaning.selectedText || meaning.primaryMeaning}</span>
          <span className="sr-only">{word.headword} 선택</span></label>
        <div className={styles.mistakeFacts}><StatusBadge tone={meaning.unresolved ? "warning" : "success"}>{status}</StatusBadge>
          <span>현재 {meaning.currentWrongCount}회 · 누적 {meaning.lifetimeWrongCount}회</span>
          {meaning.currentMissedCount > 0 && <span>시간초과·미제출 {meaning.currentMissedCount}회</span>}
          <span>{meaning.sources.map(source => source.label).filter((label, index, labels) => labels.indexOf(label) === index).join(" · ")}</span>
          {datasetFilter && <span>선택 자료에서 현재 {meaning.sources.filter(source => source.datasetId === datasetFilter).reduce((count, source) => count + source.currentWrongCount, 0)}회 · 누적 {meaning.sources.filter(source => source.datasetId === datasetFilter).reduce((count, source) => count + source.lifetimeWrongCount, 0)}회</span>}
          <span>{formatKoreanDateTime(meaning.lastWrongAt)}</span>
          {meaning.activeAssignment && <span>{meaning.activeAssignment.title}</span>}
        </div>
        {meaning.countQuality === "legacy-continuation" && <p className={styles.mistakeNote}>예전 기록 {meaning.legacyWrongCount}회는 새로 집계한 실제 오답 횟수와 따로 보관합니다.</p>}
        {view === "history" && meaning.episodes.length > 0 && <MistakeEpisodeHistory reader={{ kind: "admin", studentId }}
          meaningKey={meaning.meaningKey} upperVersion={meaning.stateVersion} episodeCount={meaning.episodeCount}
          initial={meaning.episodes} initialCursor={meaning.episodeNextCursor} enabled={!disabled} onInvalidated={onInvalidated} />}
      </section>;
    })}
  </article>)}</div>;
}
