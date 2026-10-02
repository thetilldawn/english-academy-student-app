"use client";

import { useCallback, useState } from "react";

import type { AdminMistakePageView } from "../contracts/mistake-episode";

type WrongWordCacheEntry = {
  history: AdminMistakePageView;
  loadedAt: number;
  studentId: string;
};

export function useStudentWrongWordCache(studentId: string) {
  const [cachedEntry, setCachedEntry] = useState<WrongWordCacheEntry | null>(null);
  const entry = cachedEntry?.studentId === studentId ? cachedEntry : null;

  const cache = useCallback((loadedStudentId: string, history: AdminMistakePageView | null) => {
    if (loadedStudentId !== studentId) return;
    setCachedEntry(history ? { history, loadedAt: Date.now(), studentId } : null);
  }, [studentId]);

  return { entry, actions: { cache } };
}

export type StudentWrongWordCacheController = ReturnType<
  typeof useStudentWrongWordCache
>;
