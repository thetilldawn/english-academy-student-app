"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssignmentWorkspaceReadError, loadAssignmentDatasetDirectory } from "@/features/assignments/public-client";
import type { CataloguedDataset } from "@/lib/admin/dataset-catalog";

type PreparationState = {
  status: "idle" | "loading" | "ready" | "error" | "auth-error";
  datasets: CataloguedDataset[];
};
const initialState: PreparationState = { status: "idle", datasets: [] };

export function useStudentCreatePreparation() {
  const [state, setState] = useState<PreparationState>(initialState);
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const update = useCallback((next: PreparationState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const cancel = useCallback(() => {
    versionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);
  const load = useCallback(async (retry = false) => {
    if (stateRef.current.status === "loading" || (!retry && stateRef.current.status !== "idle")) return;
    cancel();
    const version = versionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    update({ status: "loading", datasets: [] });
    try {
      const result = await loadAssignmentDatasetDirectory(abort.signal);
      if (abort.signal.aborted || versionRef.current !== version) return;
      update({ status: "ready", datasets: result.datasets });
    } catch (error) {
      if (abort.signal.aborted || versionRef.current !== version) return;
      const authError = error instanceof AssignmentWorkspaceReadError && [401, 403].includes(error.status);
      update({ status: authError ? "auth-error" : "error", datasets: [] });
    } finally {
      if (versionRef.current === version) abortRef.current = null;
    }
  }, [cancel, update]);
  const changeOpen = useCallback((open: boolean) => {
    if (open) void load();
    else if (stateRef.current.status === "loading") {
      cancel();
      update(initialState);
    }
  }, [cancel, load, update]);
  useEffect(() => () => cancel(), [cancel]);
  return { ...state, actions: { changeOpen, retry: () => void load(true) } };
}
