import type { AdminMistakeMeaning, AdminMistakePage, AdminMistakePageView, MistakeFilters } from "../contracts/mistake-episode";
export const fakeId = (n: number) => `a3030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const mistakeTestFilters: MistakeFilters = { datasetId: "", level: "all", query: "", view: "current", sort: "count" };
export function fakeMeaning(n = 1): AdminMistakeMeaning {
  return {
    meaningKey: n.toString(16).padStart(64, "0"), episodeId: fakeId(100 + n), stateVersion: "1",
    currentWrongCount: 1, lifetimeWrongCount: 2, currentMissedCount: 0, lifetimeMissedCount: 0, legacyWrongCount: 0,
    countQuality: "exact", unresolved: true, resolvedAt: null, lastWrongAt: "2026-10-02T00:00:00Z",
    testedField: "primary_meaning", identityKind: "frozen-selection-v1", selectedText: `선택 뜻 ${n}`, primaryMeaning: "기본 뜻",
    episodeCount: 1, episodes: [], episodeNextCursor: null, sourceEntryId: n, sourceDatasetId: fakeId(10), sourceLabel: "가짜 자료",
    queueId: null, reviewDraftId: null, isCurrentEpisode: true, scheduling: "available", activeAssignment: null,
    sourceQuestionId: fakeId(200 + n), sourceAttemptId: fakeId(300 + n), sourcePhase: "initial",
    sources: [{ datasetId: fakeId(10), entryId: n, label: "가짜 자료", currentWrongCount: 1, lifetimeWrongCount: 2,
      currentMissedCount: 0, lifetimeMissedCount: 0, lastWrongAt: "2026-10-02T00:00:00Z", sourceQuestionId: fakeId(200 + n),
      sourcePhase: "initial", episodeId: fakeId(100 + n) }],
  };
}
export function fakeMistakePage(n = 1): AdminMistakePage {
  const meaning = fakeMeaning(n);
  return { view: "current", stateVersion: "1", sourceVersion: "a".repeat(64), totalCount: 2, nextCursor: "next",
    summary: { wordCount: 2, currentWrongCount: 2, lifetimeWrongCount: 4, currentMissedCount: 0, legacyWrongCount: 0 },
    datasetOptions: [{ id: fakeId(10), label: "가짜 자료" }], reviewDrafts: [], schedulingBasis: "current", schedulingAsOf: "2026-10-02T00:00:00Z",
    items: [{ key: `word:${n}`, sourceVersion: "a".repeat(64), headword: `fakeword${n}`, primaryMeaning: "기본 뜻",
      currentWrongCount: 1, lifetimeWrongCount: 2, currentMissedCount: 0, lifetimeMissedCount: 0,
      legacyWrongCount: 0, lastWrongAt: meaning.lastWrongAt, meanings: [meaning] }],
  };
}
export function fakeMistakeView(n = 1): AdminMistakePageView {
  const page = fakeMistakePage(n);
  return { ...page, filters: mistakeTestFilters, summary: page.summary!, totalCount: page.totalCount!, datasetOptions: page.datasetOptions!, reviewDrafts: page.reviewDrafts! };
}
