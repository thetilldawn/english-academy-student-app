"use client";

import { useEffect, useRef, useState } from "react";

import {
  EMPTY_DATASET_FILTERS,
  rememberDatasetSelection,
  sanitizeRecentDatasetIds,
  splitRecentDatasetOptions,
  type DatasetPickerFilters,
} from "../../domain/assignment-dataset-picker";
import { datasetPickerFilterButtons, filterDatasetPickerOptions, type DatasetPickerOption } from "../../presentation/assignment-dataset-picker-view";

export const RECENT_DATASET_STORAGE_KEY = "assignment:recent-datasets:v1";

function readRecentDatasetIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_DATASET_STORAGE_KEY);
    if (!raw || raw.length > 4096) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1) return [];
    return sanitizeRecentDatasetIds("ids" in parsed ? parsed.ids : null);
  } catch {
    return [];
  }
}

export function useAssignmentDatasetPicker({
  options,
  selectedId,
  onSelect,
}: {
  options: readonly DatasetPickerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<DatasetPickerFilters>(EMPTY_DATASET_FILTERS);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const restoreFocus = useRef(false);
  const recentLoaded = useRef(false);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else if (restoreFocus.current) {
      triggerRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);

  function closePicker() {
    restoreFocus.current = true;
    setOpen(false);
  }

  function choose(id: string) {
    if (!options.some((option) => option.dataset.id === id)) return;
    const next = rememberDatasetSelection(recentIds, id);
    setRecentIds(next);
    try {
      window.localStorage.setItem(RECENT_DATASET_STORAGE_KEY, JSON.stringify({ version: 1, ids: next }));
    } catch {
      // Selection remains usable in browsers with storage disabled or full.
    }
    // The existing reducer resets range/session fields even for the same id.
    if (id !== selectedId) onSelect(id);
    closePicker();
  }

  const filtered = filterDatasetPickerOptions(options, filters);
  const groups = splitRecentDatasetOptions(filtered, recentIds);
  return {
    open, filters, groups, resultCount: filtered.length,
    buttons: datasetPickerFilterButtons(options, filters),
    triggerRef, searchRef,
    actions: {
      open: () => {
        if (!recentLoaded.current) {
          setRecentIds(readRecentDatasetIds());
          recentLoaded.current = true;
        }
        setFilters(EMPTY_DATASET_FILTERS);
        setOpen(true);
      },
      close: closePicker,
      choose,
      clear: () => setFilters(EMPTY_DATASET_FILTERS),
      changeQuery: (query: string) => setFilters((current) => ({ ...current, query })),
      changeStage: (stage: DatasetPickerFilters["stage"]) =>
        setFilters((current) => ({ ...current, stage, grade: "all" })),
      changeKind: (kind: DatasetPickerFilters["kind"]) =>
        setFilters((current) => ({ ...current, kind })),
      changeGrade: (grade: string) => setFilters((current) => ({ ...current, grade })),
      changeSchool: (school: string) => setFilters((current) => ({ ...current, school })),
      changeSemester: (semester: DatasetPickerFilters["semester"]) => setFilters((current) => ({ ...current, semester })),
    },
  };
}
