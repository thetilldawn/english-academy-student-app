"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DatasetOption } from "@/lib/admin/dataset-summary";
import { loadAssignmentDatasetDirectory } from "../transport/assignment-workspace-reads";

type DatasetDirectoryState = {
  datasets: DatasetOption[];
  error: string;
  status: "idle" | "loading" | "ready" | "error";
};

const initialState: DatasetDirectoryState = {
  datasets: [],
  error: "",
  status: "idle",
};

export function useAssignmentDatasetDirectory() {
  const [state, setState] = useState(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const statusRef = useRef<DatasetDirectoryState["status"]>("idle");

  const cancel = useCallback(() => {
    versionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const load = useCallback(async (force: boolean) => {
    if (!force && ["loading", "ready"].includes(statusRef.current)) return;
    cancel();
    const version = versionRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    statusRef.current = "loading";
    setState((current) => ({ ...current, error: "", status: "loading" }));
    try {
      const result = await loadAssignmentDatasetDirectory(abort.signal);
      if (abort.signal.aborted || versionRef.current !== version) return;
      statusRef.current = "ready";
      setState({ datasets: result.datasets, error: "", status: "ready" });
    } catch (error) {
      if (abort.signal.aborted || versionRef.current !== version) return;
      statusRef.current = "error";
      setState({
        datasets: [],
        error: error instanceof Error
          ? error.message
          : "단어장 목록을 불러오지 못했습니다.",
        status: "error",
      });
    } finally {
      if (versionRef.current === version) abortRef.current = null;
    }
  }, [cancel]);
  const ensure = useCallback(() => load(false), [load]);
  const retry = useCallback(() => load(true), [load]);

  useEffect(() => cancel, [cancel]);

  return {
    ...state,
    actions: {
      ensure,
      retry,
    },
  };
}

export type AssignmentDatasetDirectoryController = ReturnType<
  typeof useAssignmentDatasetDirectory
>;
