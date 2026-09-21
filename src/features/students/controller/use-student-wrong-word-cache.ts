"use client";

import { useCallback, useState } from "react";

import type { WrongWordPageView } from "../contracts/wrong-word-page";

type WrongWordCacheEntry = {
  history: WrongWordPageView;
  loadedAt: number;
  studentId: string;
};

export function useStudentWrongWordCache(studentId: string) {
  const [cachedEntry, setCachedEntry] = useState<WrongWordCacheEntry | null>(null);
  const entry = cachedEntry?.studentId === studentId ? cachedEntry : null;

  const cache = useCallback((loadedStudentId: string, history: WrongWordPageView | null) => {
    if (loadedStudentId !== studentId) return;
    setCachedEntry(history ? { history, loadedAt: Date.now(), studentId } : null);
  }, [studentId]);

  return { entry, actions: { cache } };
}

export type StudentWrongWordCacheController = ReturnType<
  typeof useStudentWrongWordCache
>;
