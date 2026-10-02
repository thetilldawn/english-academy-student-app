"use client";
import { Button } from "@/design-system/primitives/button/button";
import { formatKoreanDateTime } from "@/lib/format";
import { useMistakeEpisodeHistory, type EpisodeHistoryInput } from "../../controller/use-mistake-episode-history";

export function MistakeEpisodeHistory(input: EpisodeHistoryInput) {
  const history = useMistakeEpisodeHistory(input);
  return <details><summary>오답·해결 이력 {input.episodeCount}건</summary>
    <ol>{history.items.map(episode => <li key={episode.episodeId}>{formatKoreanDateTime(episode.openedAt)} · 오답 {episode.wrongCount}회
      {episode.missedCount ? ` · 미응답 ${episode.missedCount}회` : ""} · {episode.resolvedAt ? "해결" : "복습 필요"}{episode.includesLegacy ? " · 예전 기록 포함" : ""}</li>)}</ol>
    {history.error && <p role="alert">{history.error}</p>}
    {history.canLoadMore && <Button size="small" variant="quiet" disabled={history.busy} onClick={() => void history.loadMore()}>
      {history.busy ? "불러오는 중…" : history.error ? "다시 시도" : "이전 이력 더 보기"}</Button>}
  </details>;
}
