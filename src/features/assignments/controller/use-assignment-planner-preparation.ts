"use client";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { subscribeStudentProfileUpdated, useStudentDirectoryCache } from "@/features/students/public-client";
import { PRIVATE_LIST_FRESH_MS, subscribeAdminPrivateCacheChanges } from "@/features/session/public-client";

import type { AssignmentPlannerPreparation } from "../contracts/assignment-workspace-read-model";
import { loadAssignmentPlannerPreparation } from "../transport/assignment-workspace-reads";
import { useAssignmentAuthenticationFailure } from "./assignment-authentication-boundary";

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

export const AssignmentPreparationChangedContext = createContext<() => void>(() => undefined);

export function useAssignmentPlannerPreparation(interactionAllowed = true) {
  const cache = useStudentDirectoryCache()?.cache;
  const captureAuthenticationFailure = useAssignmentAuthenticationFailure();
  const [state, setState] = useState<PreparationState>(idleState);
  const abortRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const saved = useRef<{ key: string; data: AssignmentPlannerPreparation; at: number } | null>(null);
  const invalidationRevision = useRef(0);
  const invalidate = useCallback(() => { saved.current = null; invalidationRevision.current += 1; }, []);
  useEffect(() => subscribeAdminPrivateCacheChanges(invalidate), [invalidate]);

  useEffect(() => subscribeStudentProfileUpdated(profile => {
    invalidate();
    setState(current => current.status !== "ready" || !current.data.students.some(student => student.id === profile.id)
      ? current : { ...current, data: { ...current.data, students: current.data.students.map(student =>
        student.id === profile.id ? { ...student, ...profile } : student) } });
  }), [invalidate]);

  const close = useCallback(() => {
    versionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(idleState);
  }, []);

  const open = useCallback(async (request: AssignmentPlannerRequest, force = false) => {
    if (!interactionAllowed || cache?.blocked) return;
    const reportAuthenticationFailure = captureAuthenticationFailure();
    versionRef.current += 1;
    const version = versionRef.current;
    const sourceRevision = invalidationRevision.current;
    abortRef.current?.abort();
    const identity = cache?.identity;
    const key = JSON.stringify([identity, request.initialDatasetId, request.studentIds]);
    if (!force && identity && saved.current?.key === key && Date.now() - saved.current.at < PRIVATE_LIST_FRESH_MS) {
      abortRef.current = null;
      setState({ data: saved.current.data, error: "", request, status: "ready" });
      return;
    }
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
      if (cache?.blocked || cache?.identity !== identity) { setState(idleState); return; }
      if (sourceRevision !== invalidationRevision.current) throw new Error("준비하는 동안 학생 또는 배정 자료가 바뀌었습니다. 다시 불러와 주세요.");
      if (identity) saved.current = { key, data, at: Date.now() };
      setState({ data, error: "", request, status: "ready" });
    } catch (error) {
      if (abort.signal.aborted || versionRef.current !== version) return;
      reportAuthenticationFailure(error);
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
  }, [captureAuthenticationFailure, cache, interactionAllowed]);

  useEffect(() => () => {
    versionRef.current += 1;
    abortRef.current?.abort();
  }, []);

  return {
    ...state,
    actions: {
      close,
      open,
      invalidate,
      retry: () => { invalidate(); return state.request ? open(state.request, true) : Promise.resolve(); },
    },
  };
}

export type AssignmentPlannerPreparationController = ReturnType<
  typeof useAssignmentPlannerPreparation
>;
