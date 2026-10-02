import { mistakeTarget, type AdminMistakeMeaning, type AdminMistakePageView, type MistakeTarget } from "../contracts/mistake-episode";
import type { WrongWordSelectionPurpose } from "./wrong-word-selection";

export function mistakeSelectionKey(meaning: Pick<AdminMistakeMeaning, "meaningKey" | "episodeId">) {
  return JSON.stringify([meaning.meaningKey, meaning.episodeId]);
}
export function selectMistakeTarget(meaning: AdminMistakeMeaning, datasetId: string) {
  const base = mistakeTarget(meaning);
  if (!base || !datasetId) return base;
  const source = meaning.sources.find(source => source.datasetId === datasetId && source.episodeId === meaning.episodeId);
  return source ? { ...base, sourceQuestionId: source.sourceQuestionId, sourcePhase: source.sourcePhase } : null;
}
export function selectableMistakes(page: AdminMistakePageView | null, purpose: WrongWordSelectionPurpose) {
  const targets = new Map<string, MistakeTarget>();
  for (const word of page?.items ?? []) for (const meaning of word.meanings) {
    if (purpose === "next_exam" && meaning.scheduling !== "available") continue;
    const target = selectMistakeTarget(meaning, page!.filters.datasetId);
    if (target) targets.set(mistakeSelectionKey(meaning), target);
  }
  return targets;
}
