"use client";

import { useEffect, useState } from "react";

import type { PreviousVocabExamSource } from "../domain/vocab-previous-exam";
import { loadAssignmentPreviousExam } from "../transport/assignment-workspace-reads";

type PreviousExamResult =
  | {
      data: PreviousVocabExamSource | null;
      error: "";
      status: "ready";
    }
  | {
      data: null;
      error: string;
      status: "error";
    };

const idleResult = {
  data: null,
  error: "",
  status: "idle" as const,
};

const loadingResult = {
  data: null,
  error: "",
  status: "loading" as const,
};

export function useAssignmentPreviousExam({
  datasetId,
  enabled,
  studentId,
}: {
  datasetId: string;
  enabled: boolean;
  studentId: string;
}) {
  const [resultByRequestKey, setResultByRequestKey] = useState(
    () => new Map<string, PreviousExamResult>(),
  );
  const requestKey = studentId && datasetId ? `${studentId}:${datasetId}` : "";
  const current = enabled && requestKey
    ? resultByRequestKey.get(requestKey) ?? loadingResult
    : idleResult;

  useEffect(() => {
    if (!enabled || !requestKey || resultByRequestKey.has(requestKey)) return;
    const abort = new AbortController();
    void loadAssignmentPreviousExam(
      { datasetId, studentId },
      abort.signal,
    ).then(
      (response) => {
        if (abort.signal.aborted) return;
        setResultByRequestKey((results) => {
          const next = new Map(results);
          next.set(requestKey, {
            data: response.previousExam,
            error: "",
            status: "ready",
          });
          return next;
        });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setResultByRequestKey((results) => {
          const next = new Map(results);
          next.set(requestKey, {
            data: null,
            error: error instanceof Error
              ? error.message
              : "최근 시험을 불러오지 못했습니다.",
            status: "error",
          });
          return next;
        });
      },
    );
    return () => abort.abort();
  }, [datasetId, enabled, requestKey, resultByRequestKey, studentId]);

  return {
    ...current,
    requestKey,
    retry: () => {
      if (!requestKey) return;
      setResultByRequestKey((results) => {
        const next = new Map(results);
        next.delete(requestKey);
        return next;
      });
    },
  };
}
