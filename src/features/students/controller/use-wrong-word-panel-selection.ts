"use client";

import { useCallback, useMemo, useState } from "react";

import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";

import {
  filterWrongWords,
  keepSelectableQuestionIds,
  selectableWrongWordQuestionIds,
  wrongWordDatasetOptions,
  type WrongWordLevelFilter,
  type WrongWordSelectionPurpose,
} from "../domain/wrong-word-selection";

export function useWrongWordPanelSelection({
  history,
  initialDatasetId,
}: {
  history: StudentWrongWordHistory | null;
  initialDatasetId: string;
}) {
  const [levelFilter, setLevelFilter] = useState<WrongWordLevelFilter>("all");
  const [datasetFilter, setDatasetFilterState] = useState(initialDatasetId);
  const [query, setQueryState] = useState("");
  const [purpose, setPurpose] = useState<WrongWordSelectionPurpose>("next_exam");
  const [queuedQuestionIds, setQueuedQuestionIds] = useState<string[]>([]);
  const [worksheetQuestionIds, setWorksheetQuestionIds] = useState<string[]>([]);

  const datasetOptions = useMemo(
    () => wrongWordDatasetOptions(history),
    [history],
  );
  const filteredWords = useMemo(
    () => filterWrongWords({
      history,
      datasetId: datasetFilter,
      level: levelFilter,
      query,
    }),
    [datasetFilter, history, levelFilter, query],
  );
  const selectableQueuedIds = useMemo(
    () => selectableWrongWordQuestionIds({
      words: filteredWords,
      datasetId: datasetFilter,
      purpose: "next_exam",
    }),
    [datasetFilter, filteredWords],
  );
  const selectedQueuedIds = useMemo(
    () => keepSelectableQuestionIds(queuedQuestionIds, selectableQueuedIds),
    [queuedQuestionIds, selectableQueuedIds],
  );
  const selectableWorksheetIds = useMemo(
    () => selectableWrongWordQuestionIds({
      words: filteredWords,
      datasetId: datasetFilter,
      purpose: "worksheet",
    }),
    [datasetFilter, filteredWords],
  );
  const selectedWorksheetIds = useMemo(
    () => keepSelectableQuestionIds(
      worksheetQuestionIds,
      selectableWorksheetIds,
    ),
    [selectableWorksheetIds, worksheetQuestionIds],
  );
  const selectableIds = purpose === "next_exam"
    ? selectableQueuedIds
    : selectableWorksheetIds.slice(0, 50);
  const selectedIds = purpose === "next_exam"
    ? selectedQueuedIds
    : selectedWorksheetIds;
  const allVisibleSelected = selectableIds.length > 0 &&
    selectableIds.every((questionId) => selectedIds.includes(questionId));

  const clearSelections = useCallback(() => {
    setQueuedQuestionIds([]);
    setWorksheetQuestionIds([]);
  }, []);
  const setDatasetFilter = useCallback((value: string) => {
    setDatasetFilterState(value);
    clearSelections();
  }, [clearSelections]);
  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    clearSelections();
  }, [clearSelections]);
  const changeLevelFilter = useCallback((value: WrongWordLevelFilter) => {
    setLevelFilter((current) => {
      if (current === value) return current;
      clearSelections();
      return value;
    });
  }, [clearSelections]);
  const toggleQuestion = useCallback((questionId: string) => {
    if (purpose === "next_exam") {
      setQueuedQuestionIds((current) =>
        current.includes(questionId)
          ? current.filter((value) => value !== questionId)
          : [...current, questionId]
      );
      return;
    }
    setWorksheetQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((value) => value !== questionId)
        : current.length < 50
          ? [...current, questionId]
          : current
    );
  }, [purpose]);
  const toggleVisible = useCallback(() => {
    if (purpose === "next_exam") {
      setQueuedQuestionIds(allVisibleSelected ? [] : selectableQueuedIds);
      return;
    }
    setWorksheetQuestionIds(allVisibleSelected ? [] : selectableIds);
  }, [allVisibleSelected, purpose, selectableIds, selectableQueuedIds]);

  return {
    allVisibleSelected,
    datasetFilter,
    datasetOptions,
    filteredWords,
    levelFilter,
    purpose,
    query,
    selectableIds,
    selectedIds,
    selectedQueuedIds,
    selectedWorksheetIds,
    worksheetSelectionLimitReached: selectedWorksheetIds.length >= 50,
    actions: {
      changeLevelFilter,
      clearQueuedSelection: () => setQueuedQuestionIds([]),
      clearWorksheetSelection: () => setWorksheetQuestionIds([]),
      setDatasetFilter,
      setPurpose,
      setQuery,
      toggleQuestion,
      toggleVisible,
    },
  };
}

export type WrongWordPanelSelectionController = ReturnType<
  typeof useWrongWordPanelSelection
>;
