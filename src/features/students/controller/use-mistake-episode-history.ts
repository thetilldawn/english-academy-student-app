"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import type { MistakeEpisode, MistakeEpisodeHistoryReader } from "../contracts/mistake-episode-history";
import { loadMistakeEpisodeHistory, MistakeEpisodeHistoryError } from "../transport/mistake-episode-history";

export type EpisodeHistoryInput = {
  reader: MistakeEpisodeHistoryReader; meaningKey: string; upperVersion: string; episodeCount: number;
  initial: MistakeEpisode[]; initialCursor: string | null; enabled: boolean; onInvalidated: (status: number) => void;
};
export function useMistakeEpisodeHistory(input: EpisodeHistoryInput) {
  const { meaningKey, upperVersion, episodeCount, initial, initialCursor, enabled, onInvalidated } = input;
  const kind = input.reader.kind, identity = input.reader.kind === "student" ? input.reader.identity : input.reader.studentId;
  const owner = JSON.stringify([kind, identity, meaningKey, upperVersion, initialCursor]);
  const [read, setRead] = useState({ owner, items: initial, cursor: initialCursor, busy: false, error: "", blocked: false });
  const active = useRef<{ owner: string; controller: AbortController } | null>(null);
  const state = useMemo(() => read.owner === owner ? read : { owner, items: initial, cursor: initialCursor, busy: false, error: "", blocked: false }, [read, owner, initial, initialCursor]);
  useEffect(() => () => { active.current?.controller.abort(); active.current = null;
    setRead(value => value.owner === owner && value.busy ? { ...value, busy: false } : value);
  }, [owner, enabled]);
  const loadMore = useCallback(async () => {
    if (!enabled || state.blocked || active.current || !state.cursor) return;
    const controller = new AbortController(); active.current = { owner, controller };
    setRead({ ...state, busy: true, error: "" });
    try {
      const page = await loadMistakeEpisodeHistory(kind === "student" ? { kind, identity } : { kind, studentId: identity },
        { meaningKey, upperVersion, cursor: state.cursor }, controller.signal);
      if (controller.signal.aborted || active.current?.controller !== controller) return;
      const ids = new Set(state.items.map(item => item.episodeId));
      if (page.episodeCount !== episodeCount || page.items.some(item => ids.has(item.episodeId))
        || new Set(page.items.map(item => item.episodeId)).size !== page.items.length
        || page.nextCursor === state.cursor || page.nextCursor && page.items.length !== 20
        || state.items.length + page.items.length > episodeCount || !page.nextCursor && state.items.length + page.items.length !== episodeCount)
        throw new MistakeEpisodeHistoryError(409);
      setRead({ owner, items: [...state.items, ...page.items], cursor: page.nextCursor, busy: false, error: "", blocked: false });
    } catch (error) {
      if (controller.signal.aborted || active.current?.controller !== controller) return;
      const status = error instanceof MistakeEpisodeHistoryError ? error.status : 503;
      const blocked = [401, 403, 404, 409].includes(status);
      if (kind === "admin" && (status === 401 || status === 403)) announceAdminPrivateCacheChange("identity");
      setRead({ ...state, items: blocked ? [] : state.items, cursor: blocked ? null : state.cursor, busy: false, blocked,
        error: error instanceof MistakeEpisodeHistoryError ? error.message : "오답 이력을 불러오지 못했습니다. 다시 시도해 주세요." });
      if (blocked) onInvalidated(status);
    } finally { if (active.current?.controller === controller) active.current = null; }
  }, [enabled, state, owner, kind, identity, meaningKey, upperVersion, episodeCount, onInvalidated]);
  return { ...state, busy: enabled && state.busy,
    items: enabled ? state.items : [], canLoadMore: enabled && !state.blocked && !!state.cursor, loadMore };
}
