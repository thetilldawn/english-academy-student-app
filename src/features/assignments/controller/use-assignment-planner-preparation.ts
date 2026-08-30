"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AssignmentPlannerPreparation } from "../contracts/assignment-workspace-read-model";
import { loadAssignmentPlannerPreparation } from "../transport/assignment-workspace-reads";

export type AssignmentPlannerRequest = {
  bulkFilterLabels: readonly string[];
  initialDatasetId: string;
  selectionMode: "single" | "bulk";
  studentIds: readonly string[];
};

type PreparationState =
  | { data: null; error: ""; request: null; status: "idle" }
  | {
      data: null;
      error: "";
      request: AssignmentPlannerRequest;
      status: "loading";
    }
  | {
      data: null;
      error: string;
      request: AssignmentPlannerRequest;
      status: "error";
    }
  | {
      data: AssignmentPlannerPreparation;
      error: "";
      request: AssignmentPlannerRequest;
      status: "ready";
    };

const idleState: PreparationState = {
  data: null,
  error: "",
  request: null,
  status: "idle",
};

export function useAssignmentPlannerPreparation() {
  const [state, setState] = useState<PreparationState>(idleState);
  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);

  const close = useCallback(() => {
    versionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(idleState);
  }, []);

  const open = useCallback(async (request: AssignmentPlannerRequest) => {
    versionRef.current += 1;
    const version = versionRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ data: null, error: "", request, status: "loading" });
    try {
      const data = await loadAssignmentPlannerPreparation(
        {
          initialDatasetId: request.initialDatasetId,
          studentIds: request.studentIds,
        },
        abort.signal,
      );
      if (abort.signal.aborted || versionRef.current !== version) return;
      setState({ data, error: "", request, status: "ready" });
    } catch (error) {
      if (abort.signal.aborted || versionRef.current !== version) return;
      setState({
        data: null,
        error: error instanceof Error
          ? error.message
          : "배정 준비 자료를 불러오지 못했습니다.",
        request,
        status: "error",
      });
    } finally {
      if (versionRef.current === version) abortRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    versionRef.current += 1;
    abortRef.current?.abort();
  }, []);

  return {
    ...state,
    actions: {
      close,
      open,
      retry: () => state.request ? open(state.request) : Promise.resolve(),
    },
  };
}

export type AssignmentPlannerPreparationController = ReturnType<
  typeof useAssignmentPlannerPreparation
>;
