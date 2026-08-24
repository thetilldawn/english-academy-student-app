"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";

import { loadStudentWrongWords } from "../api/wrong-word-transport";

const WRONG_HISTORY_CACHE_TTL_MS = 30_000;

export function useStudentWrongWordHistory({
  active,
  cachedAt,
  cachedHistory,
  loadErrorMessage,
  onLoaded,
  studentId,
}: {
  active: boolean;
  cachedAt: number | null;
  cachedHistory: StudentWrongWordHistory | null;
  loadErrorMessage: string;
  onLoaded: (studentId: string, history: StudentWrongWordHistory) => void;
  studentId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const requestingRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const refreshAfterRequestRef = useRef(false);

  useEffect(() => {
    const cacheIsFresh =
      cachedHistory !== null &&
      cachedAt !== null &&
      Date.now() - cachedAt < WRONG_HISTORY_CACHE_TTL_MS;
    if (
      !active ||
      (cacheIsFresh && !forceRefresh) ||
      requestingRef.current
    ) {
      return;
    }
    const controller = new AbortController();
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    requestingRef.current = true;
    setLoading(true);
    setError("");

    void loadStudentWrongWords(studentId, controller.signal)
      .then((payload) => {
        if (
          controller.signal.aborted ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }
        if (!payload.history) {
          throw new Error(payload.error ?? loadErrorMessage);
        }
        onLoaded(studentId, payload.history);
        setForceRefresh(false);
      })
      .catch((requestError: unknown) => {
        if (
          controller.signal.aborted ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : loadErrorMessage,
        );
        setForceRefresh(false);
      })
      .finally(() => {
        if (requestSequenceRef.current !== requestSequence) return;
        requestingRef.current = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (refreshAfterRequestRef.current) {
            refreshAfterRequestRef.current = false;
            setForceRefresh(true);
            setRequestVersion((value) => value + 1);
          }
        }
      });

    return () => {
      controller.abort();
      if (requestSequenceRef.current === requestSequence) {
        requestSequenceRef.current += 1;
        requestingRef.current = false;
      }
    };
  }, [
    active,
    cachedAt,
    cachedHistory,
    forceRefresh,
    loadErrorMessage,
    onLoaded,
    requestVersion,
    studentId,
  ]);

  const refresh = useCallback(() => {
    if (requestingRef.current) {
      refreshAfterRequestRef.current = true;
      return;
    }
    setForceRefresh(true);
    setRequestVersion((value) => value + 1);
  }, []);

  const isRequesting = useCallback(() => requestingRef.current, []);

  return { error, isRequesting, loading, refresh };
}
