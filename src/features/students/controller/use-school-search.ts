"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { loadSchoolSearch } from "../transport/school-search";
import { SchoolSearchRequestError, schoolSearchMessages, type SchoolSearchResponse } from "../contracts/school-search-contract";

type State = SchoolSearchResponse & { ownerKey: string; active: boolean; externallyLocked: boolean; query: string; status: "idle" | "loading" | "ready" | "error" | "auth-error" };
export function useSchoolSearch({ ownerKey, value, onChange, active = true, locked = false }: {
  ownerKey: string; value: string; onChange: (value: string) => void; active?: boolean; locked?: boolean;
}) {
  const [state, setState] = useState<State>({ ownerKey, active, externallyLocked: locked, query: "", status: "idle", items: [], hasMore: false });
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expectedQuery = useRef<string | null>(null);
  const latest = useRef({ ownerKey, value, active, locked });
  const cancel = useCallback(() => { generation.current++; pending.current?.abort(); pending.current = null; if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  useLayoutEffect(() => { cancel(); return cancel; }, [ownerKey, active, locked, cancel]);
  useLayoutEffect(() => {
    latest.current = { ownerKey, value, active, locked };
    // A reset or server receipt can change the controlled value without a search action.
    if (expectedQuery.current !== null && expectedQuery.current !== value) cancel();
  }, [ownerKey, value, active, locked, cancel]);
  if (state.ownerKey !== ownerKey || state.active !== active || state.externallyLocked !== locked || state.query !== value) {
    setState({ ownerKey, active, externallyLocked: locked, query: value,
      status: state.ownerKey === ownerKey && state.status === "auth-error" ? "auth-error" : "idle", items: [], hasMore: false });
  }
  const current = state.ownerKey === ownerKey && (state.query === value || state.status === "auth-error") ? state : null;
  const status = active && current ? current.status : "idle";
  const ownLocked = locked || (state.ownerKey === ownerKey && state.status === "auth-error");
  function search(query: string, delay = 0) {
    if (!active || ownLocked) return;
    cancel();
    expectedQuery.current = query;
    const version = generation.current;
    const next = { ownerKey, active, externallyLocked: locked, query, items: [], hasMore: false };
    const isCurrent = () => generation.current === version && latest.current.ownerKey === ownerKey
      && latest.current.value === query && latest.current.active && !latest.current.locked;
    if (query.trim().length < 2) { setState({ ...next, status: "idle" }); return; }
    setState({ ...next, status: "loading" });
    timer.current = setTimeout(async () => {
      timer.current = null;
      if (!isCurrent()) return;
      const abort = new AbortController(); pending.current = abort;
      try {
        const result = await loadSchoolSearch(query, abort.signal);
        if (abort.signal.aborted || !isCurrent()) return;
        setState({ ...next, ...result, status: "ready" });
      } catch (error) {
        if (abort.signal.aborted || !isCurrent()) return;
        const auth = error instanceof SchoolSearchRequestError && [401, 403].includes(error.status);
        setState({ ...next, status: auth ? "auth-error" : "error" });
        if (auth) announceAdminPrivateCacheChange("identity");
      } finally { if (generation.current === version) pending.current = null; }
    }, delay);
  }
  return {
    value, status, locked: ownLocked, items: status === "ready" ? current!.items : [], hasMore: status === "ready" && current!.hasMore,
    message: status === "loading" ? schoolSearchMessages.loading : status === "error" ? schoolSearchMessages.error
      : ownLocked ? schoolSearchMessages.auth : status === "ready" ? (current!.items.length
        ? `학교 ${current!.items.length}곳을 찾았습니다. 지역을 확인하고 선택해 주세요.` : schoolSearchMessages.empty)
      : value.trim().length === 1 ? schoolSearchMessages.invalid : schoolSearchMessages.idle,
    actions: {
      change: (next: string) => { if (ownLocked || !active || next === value) return; onChange(next); search(next, 350); },
      choose: (id: string) => { if (!active || ownLocked) return; const item = current?.items.find(item => item.id === id); if (!item) return;
        cancel(); expectedQuery.current = null; onChange(item.name); setState({ ownerKey, active, externallyLocked: locked, query: item.name, status: "idle", items: [], hasMore: false }); },
      retry: () => search(value),
      reset: () => { cancel(); expectedQuery.current = null; setState({ ownerKey, active, externallyLocked: locked, query: "", status: ownLocked ? "auth-error" : "idle", items: [], hasMore: false }); },
    },
  };
}
export type SchoolSearchController = ReturnType<typeof useSchoolSearch>;
