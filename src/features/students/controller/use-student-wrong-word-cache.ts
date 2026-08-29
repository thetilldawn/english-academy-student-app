"use client";

import { useCallback, useState } from "react";

import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";

type WrongWordCacheEntry = {
  history: StudentWrongWordHistory;
  loadedAt: number;
  studentId: string;
};

export function useStudentWrongWordCache(studentId: string) {
  const [cachedEntry, setCachedEntry] = useState<WrongWordCacheEntry | null>(null);
  const entry = cachedEntry?.studentId === studentId ? cachedEntry : null;

  const cache = useCallback((loadedStudentId: string, history: StudentWrongWordHistory) => {
    if (loadedStudentId !== studentId) return;
    setCachedEntry({ history, loadedAt: Date.now(), studentId });
  }, [studentId]);

  return { entry, actions: { cache } };
}

export type StudentWrongWordCacheController = ReturnType<
  typeof useStudentWrongWordCache
>;
