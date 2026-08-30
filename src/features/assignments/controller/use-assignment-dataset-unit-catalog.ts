"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssignmentUnitItem } from "../catalog-types";
import { loadAssignmentDatasetUnits } from "../transport/assignment-workspace-reads";

type UnitLoadState = {
  datasetId: string;
  message: string;
  status: "idle" | "loading" | "ready" | "error";
};

export function useAssignmentDatasetUnitCatalog(
  initialUnits: readonly AssignmentUnitItem[] = [],
) {
  const initialByDataset = useMemo(() => {
    const result = new Map<string, AssignmentUnitItem[]>();
    for (const unit of initialUnits) {
      const current = result.get(unit.datasetId) ?? [];
      current.push(unit);
      result.set(unit.datasetId, current);
    }
    return result;
  }, [initialUnits]);
  const [loadedUnitsByDataset, setLoadedUnitsByDataset] = useState(
    () => new Map<string, AssignmentUnitItem[]>(),
  );
  const [state, setState] = useState<UnitLoadState>({
    datasetId: "",
    message: "",
    status: "idle",
  });
  const cacheRef = useRef(new Map<string, AssignmentUnitItem[]>());
  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);

  const unitsByDataset = useMemo(
    () => new Map([...loadedUnitsByDataset, ...initialByDataset]),
    [initialByDataset, loadedUnitsByDataset],
  );

  const cancel = useCallback(() => {
    versionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const ensureDataset = useCallback(async (datasetId: string) => {
    cancel();
    if (!datasetId) {
      setState({ datasetId: "", message: "", status: "idle" });
      return;
    }
    if (initialByDataset.has(datasetId) || cacheRef.current.has(datasetId)) {
      setState({ datasetId, message: "", status: "ready" });
      return;
    }
    const version = versionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ datasetId, message: "", status: "loading" });
    try {
      const result = await loadAssignmentDatasetUnits(datasetId, abort.signal);
      if (abort.signal.aborted || versionRef.current !== version) return;
      const next = new Map(cacheRef.current);
      next.set(result.datasetId, result.units);
      cacheRef.current = next;
      setLoadedUnitsByDataset(next);
      setState({ datasetId, message: "", status: "ready" });
    } catch (error) {
      if (abort.signal.aborted || versionRef.current !== version) return;
      setState({
        datasetId,
        message: error instanceof Error
          ? error.message
          : "시험 범위를 불러오지 못했습니다.",
        status: "error",
      });
    } finally {
      if (versionRef.current === version) abortRef.current = null;
    }
  }, [cancel, initialByDataset]);

  useEffect(() => () => cancel(), [cancel]);

  return {
    state,
    units: [...unitsByDataset.values()].flat(),
    actions: {
      cancel,
      ensureDataset,
      retry: () => ensureDataset(state.datasetId),
    },
  };
}
