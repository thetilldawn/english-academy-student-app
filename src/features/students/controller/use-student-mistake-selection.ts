"use client";

import { useState } from "react";
import { mistakeFilterKey, type AdminMistakePageView, type MistakeFilters } from "../contracts/mistake-episode";
import { selectableMistakes } from "../domain/mistake-selection";
import type { WrongWordLevelFilter, WrongWordSelectionPurpose } from "../domain/wrong-word-selection";

export function useStudentMistakeSelection({ history, initialDatasetId, studentId }: {
  history: AdminMistakePageView | null; initialDatasetId: string; studentId: string;
}) {
  const [filters, setFilters] = useState<MistakeFilters>({ datasetId: initialDatasetId, level: "all", query: "", view: "current", sort: "count" });
  const [purpose, setPurpose] = useState<WrongWordSelectionPurpose>("next_exam");
  const matching = history && mistakeFilterKey(history.filters) === mistakeFilterKey(filters) ? history : null;
  const snapshot = JSON.stringify([studentId, mistakeFilterKey(filters), matching?.stateVersion, matching?.sourceVersion]);
  const [selection, setSelection] = useState({ snapshot, queue: [] as string[], worksheet: [] as string[] });
  // A changed student, filter, or version invalidates selection before an event can use it.
  if (selection.snapshot !== snapshot) setSelection({ snapshot, queue: [], worksheet: [] });
  const queue = selectableMistakes(matching, "next_exam"), worksheet = selectableMistakes(matching, "worksheet");
  const validSelection = selection.snapshot === snapshot ? selection : { queue: [], worksheet: [] };
  const selectedQueuedIds = validSelection.queue.filter(id => queue.has(id));
  const selectedWorksheetIds = validSelection.worksheet.filter(id => worksheet.has(id));
  const available = purpose === "next_exam" ? queue : worksheet;
  const limit = purpose === "next_exam" ? 500 : 50;
  const selectableIds = [...available.keys()].slice(0, limit);
  const selectedIds = purpose === "next_exam" ? selectedQueuedIds : selectedWorksheetIds;
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  function clearSelections() { setSelection({ snapshot, queue: [], worksheet: [] }); }
  function changeFilters(patch: Partial<MistakeFilters>) { setFilters(current => ({ ...current, ...patch })); clearSelections(); }
  function replace(ids: string[]) {
    setSelection(current => ({ ...(current.snapshot === snapshot ? current : { snapshot, queue: [], worksheet: [] }),
      [purpose === "next_exam" ? "queue" : "worksheet"]: ids }));
  }
  return {
    filters, datasetFilter: filters.datasetId, levelFilter: filters.level, query: filters.query,
    datasetOptions: history?.datasetOptions ?? [], filteredWords: matching?.items ?? [], purpose,
    selectableIds, selectedIds, selectedQueuedIds, selectedWorksheetIds, allVisibleSelected,
    selectedQueuedTargets: selectedQueuedIds.map(id => queue.get(id)!),
    selectedWorksheetTargets: selectedWorksheetIds.map(id => worksheet.get(id)!),
    worksheetSelectionLimitReached: selectedWorksheetIds.length >= 50,
    actions: {
      clearSelections, setPurpose,
      clearQueuedSelection: () => setSelection(current => ({ ...current, queue: [] })),
      clearWorksheetSelection: () => setSelection(current => ({ ...current, worksheet: [] })),
      setDatasetFilter: (datasetId: string) => changeFilters({ datasetId }),
      setQuery: (query: string) => changeFilters({ query }),
      changeLevelFilter: (level: WrongWordLevelFilter) => changeFilters({ level }),
      setView: (view: MistakeFilters["view"]) => changeFilters({ view }),
      setSort: (sort: MistakeFilters["sort"]) => changeFilters({ sort }),
      toggleQuestion: (id: string) => {
        if (!available.has(id)) return;
        replace(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : selectedIds.length < limit ? [...selectedIds, id] : selectedIds);
      },
      toggleVisible: () => replace(allVisibleSelected ? selectedIds.filter(id => !selectableIds.includes(id)) : [...new Set([...selectedIds, ...selectableIds])].slice(0, limit)),
    },
  };
}
