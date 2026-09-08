"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { PrivateListRead, PrivateListSeed } from "./private-list-cache";

type EntryCache<Snapshot, Filters, Consumer extends string> = {
  readonly userId: string; readonly blocked: boolean; readonly displayDeadlineAt: number;
  hydrate: (seed: PrivateListSeed<Snapshot>, consumer?: Consumer) => PrivateListRead<Snapshot>;
  read: (filters: Filters, signal?: AbortSignal, force?: boolean, consumer?: Consumer) => Promise<PrivateListRead<Snapshot>>;
  filtersFor: (consumer?: Consumer) => Filters;
};
export type PrivateListEntryContext<Snapshot, Filters, Consumer extends string> = {
  cache: EntryCache<Snapshot, Filters, Consumer>; ticket: object; visible: boolean; revision: number;
};
const subscribeHydration = () => () => {};
const clientSnapshot = () => false;
const serverSnapshot = () => true;

export function usePrivateListEntry<Snapshot, Filters, Consumer extends string, Failure>(
  context: PrivateListEntryContext<Snapshot, Filters, Consumer> | null,
  initialResponse: PrivateListSeed<Snapshot> | undefined,
  consumer: Consumer, failureFor: (error: unknown) => Failure, expiredFailure: Failure,
  options: { retainActiveSnapshot?: boolean } = {},
) {
  const hydrating = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  // Client navigation/restored RSC is not current authorization.
  const [seed] = useState(() => hydrating && initialResponse && context && initialResponse.userId === context.cache.userId
    ? { ticket: context.ticket, response: initialResponse } : null);
  const [retryRequest, setRetryRequest] = useState<{ ticket?: object; id: number }>({ id: 0 });
  const attempt = retryRequest.id;
  const [state, setState] = useState<{
    ticket: object; attempt: number; error?: Failure;
    // A failed request must not re-label a previous success with a new ticket.
    success?: { ticket: object; read: PrivateListRead<Snapshot> };
  } | null>(() => seed ? {
    ticket: seed.ticket, attempt: 0,
    success: { ticket: seed.ticket, read: { snapshot: seed.response.snapshot, savedAt: 0 } },
  } : null);
  const [expiredAt, setExpiredAt] = useState(0);
  const cache = context?.cache;
  const ticket = context?.ticket;
  const visible = context?.visible;
  const deadline = cache?.displayDeadlineAt ?? 0;
  useEffect(() => {
    if (!cache || !ticket || !visible || cache.blocked) return;
    if (seed && seed.ticket === ticket && attempt === 0) { cache.hydrate(seed.response, consumer); return; }
    const abort = new AbortController();
    void cache.read(cache.filtersFor(consumer), abort.signal, retryRequest.ticket === ticket, consumer).then(read => {
      if (!abort.signal.aborted) setState({ ticket, attempt, success: { ticket, read } });
    }).catch(error => {
      if (!abort.signal.aborted) setState(previous => ({ ticket, attempt, success: previous?.success, error: failureFor(error) }));
    });
    return () => abort.abort();
  }, [cache, ticket, visible, attempt, retryRequest.ticket, seed, consumer, failureFor]);
  useEffect(() => {
    if (!deadline) return;
    const timer = setTimeout(() => setExpiredAt(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  const current = state && state.ticket === ticket && state.attempt === attempt ? state : null;
  const expired = Boolean(deadline && expiredAt >= deadline);
  const activeRead = visible && !cache?.blocked && state?.success?.ticket === ticket ? state?.success?.read : undefined;
  // An opted-in editor may outlive list freshness, but never its current entry
  // authorization. Navigation/visibility/identity changes still require a read.
  const snapshot = options.retainActiveSnapshot ? activeRead?.snapshot
    : activeRead && current && !expired && !current.error ? activeRead.snapshot : undefined;
  return {
    expired: expired && !current?.error,
    stale: Boolean(snapshot && expired),
    refreshing: Boolean(cache && ticket && visible && !cache.blocked && !current),
    blocked: cache?.blocked ?? false,
    snapshot,
    // Only for hidden, non-interactive draft subtrees, never authorization.
    retainedSnapshot: !cache?.blocked ? state?.success?.read.snapshot : undefined,
    error: current?.error ?? (current && expired && !snapshot ? expiredFailure : undefined),
    retry: () => setRetryRequest(value => ({ ticket, id: value.id + 1 })),
  };
}
