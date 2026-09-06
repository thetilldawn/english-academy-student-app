"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePrivateListSession } from "@/features/session/public-client";
import { readStudentDirectoryCache } from "../transport/student-directory-cache-read";
import { createStudentDirectoryCache, type StudentDirectoryCache } from "./student-directory-cache";

type CacheContext = { cache: StudentDirectoryCache; ticket: object; visible: boolean; revision: number };
const Context = createContext<CacheContext | null>(null);
export const useStudentDirectoryCache = () => useContext(Context);

export function StudentDirectoryCacheProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <OwnedCacheProvider key={userId} userId={userId}>{children}</OwnedCacheProvider>;
}
function OwnedCacheProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [cache] = useState(() => createStudentDirectoryCache(userId, readStudentDirectoryCache));
  const value = usePrivateListSession(cache);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
