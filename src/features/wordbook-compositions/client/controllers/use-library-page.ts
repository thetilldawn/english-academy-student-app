"use client";
import { useEffect, useMemo, useReducer, useState } from "react";
import { type LibraryQuery, type LibraryQueryResultOf } from "../../contracts/library-query";
import { readLibraryPage } from "../transport/library-transport";

type State<K extends LibraryQuery["kind"]> = { key: string; status: "loading" | "ready" | "error"; data: LibraryQueryResultOf<K> | null; error: string };
/** A page belongs to one exact query and viewer. Late results never replace another range. */
export function useLibraryPage<K extends LibraryQuery["kind"]>(query: Extract<LibraryQuery, { kind: K }> | null, viewerId: string | undefined,
  onError: (error: unknown) => void, onViewer?: (id: string) => void) {
  const json = JSON.stringify(query);
  const stableQuery = useMemo(() => JSON.parse(json) as typeof query, [json]);
  const [revision, reload] = useReducer((n: number) => n + 1, 0);
  const [cursor, setCursor] = useState<{ key: string; value: unknown } | null>(null);
  const key = JSON.stringify([json, viewerId, revision]);
  const [state, setState] = useState<State<K>>({ key: "", status: "loading", data: null, error: "" });
  const currentCursor = cursor?.key === key ? cursor.value : null;
  useEffect(() => {
    if (!stableQuery) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const input = "cursor" in stableQuery ? { ...stableQuery, cursor: currentCursor } : stableQuery;
      void readLibraryPage(input as typeof stableQuery, controller.signal, viewerId).then(data => {
        if (controller.signal.aborted) return;
        onViewer?.(data.viewerId);
        setState(old => {
          if (currentCursor && old.key === key && old.data && "items" in old.data && "items" in data) {
            return { key, status: "ready", error: "", data: { ...data, items: [...old.data.items, ...data.items] } as typeof data };
          }
          if (currentCursor && old.key === key && old.data && "facets" in old.data && "facets" in data) {
            return { key, status: "ready", error: "", data: { ...data, facets: { ...data.facets, books: [...old.data.facets.books, ...data.facets.books] } } as typeof data };
          }
          return { key, status: "ready", data, error: "" };
        });
      }).catch(error => {
        if (controller.signal.aborted) return;
        onError(error); setState(old => ({ key, status: "error", data: currentCursor && old.key === key ? old.data : null,
          error: error instanceof Error ? error.message : "자료를 불러오지 못했습니다. 다시 시도해 주세요." }));
      });
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [key, stableQuery, viewerId, currentCursor, onError, onViewer]);
  const data = stableQuery && state.key === key ? state.data : null;
  const status = !stableQuery ? "idle" : state.key === key ? state.status : "loading";
  return { data, status, error: state.key === key ? state.error : "", reload, more: () => {
    if (data && "nextCursor" in data && data.nextCursor && status === "ready") {
      setState(s => ({ ...s, status: "loading" })); setCursor({ key, value: data.nextCursor });
    }
  } };
}
