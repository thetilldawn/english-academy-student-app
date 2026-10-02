"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DatasetOption } from "@/lib/admin/dataset-summary";
import { loadAssignmentDatasetDirectory } from "../transport/assignment-workspace-reads";
import { useAssignmentAuthenticationFailure } from "./assignment-authentication-boundary";

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
  const captureAuthenticationFailure = useAssignmentAuthenticationFailure();
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
    const reportAuthenticationFailure = captureAuthenticationFailure();
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
      reportAuthenticationFailure(error);
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
  }, [cancel, captureAuthenticationFailure]);
  const ensure = useCallback(() => load(false), [load]);
  const retry = useCallback(() => load(true), [load]);
  const refreshMetadata = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    cancel();
    const version = versionRef.current, abort = new AbortController();
    abortRef.current = abort;
    const abortThisRequest = () => abort.abort();
    signal.addEventListener("abort", abortThisRequest, { once: true });
    const reportAuthenticationFailure = captureAuthenticationFailure();
    try {
      const result = await loadAssignmentDatasetDirectory(abort.signal);
      signal.throwIfAborted(); abort.signal.throwIfAborted();
      if (versionRef.current !== version) throw new DOMException("Superseded", "AbortError");
      statusRef.current = "ready";
      setState({ datasets: result.datasets, error: "", status: "ready" });
      return result.datasets;
    } catch (error) {
      if (!signal.aborted && !abort.signal.aborted && versionRef.current === version) reportAuthenticationFailure(error);
      throw error;
    } finally {
      signal.removeEventListener("abort", abortThisRequest);
      if (versionRef.current === version) abortRef.current = null;
    }
  }, [cancel, captureAuthenticationFailure]);

  useEffect(() => cancel, [cancel]);

  return {
    ...state,
    actions: {
      ensure,
      retry,
      refreshMetadata,
    },
  };
}

export type AssignmentDatasetDirectoryController = ReturnType<
  typeof useAssignmentDatasetDirectory
>;
