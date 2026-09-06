"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePrivateListSession } from "@/features/session/public-client";
import { readHistoryListCache } from "../transport/history-pages";
import { createHistoryListCache, type HistoryListCache } from "./history-list-cache";
import { subscribeAdminHistoryMutation } from "./history-change-listener";

type ContextValue = { cache: HistoryListCache; ticket: object; visible: boolean; revision: number; refresh: () => void };
const Context = createContext<ContextValue | null>(null);
export const useHistoryListCache = () => useContext(Context);
export function HistoryListCacheProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <OwnedProvider key={userId} userId={userId}>{children}</OwnedProvider>;
}
function OwnedProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [cache] = useState(() => createHistoryListCache(userId, readHistoryListCache));
  const value = usePrivateListSession(cache);
  // The local receipt is dispatched BEFORE the private invalidation signal.
  useEffect(() => subscribeAdminHistoryMutation(notice => cache.noteMutation(notice.receipt.version)), [cache]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
