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
) {
  const hydrating = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  // Client navigation/restored RSC is not current authorization.
  const [seed] = useState(() => hydrating && initialResponse && context && initialResponse.userId === context.cache.userId
    ? { ticket: context.ticket, response: initialResponse } : null);
  const [retryRequest, setRetryRequest] = useState<{ ticket?: object; id: number }>({ id: 0 });
  const attempt = retryRequest.id;
  const [state, setState] = useState<{ ticket: object; attempt: number; read?: PrivateListRead<Snapshot>; error?: Failure } | null>(() => seed
    ? { ticket: seed.ticket, attempt: 0, read: { snapshot: seed.response.snapshot, savedAt: 0 } } : null);
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
      if (!abort.signal.aborted) setState({ ticket, attempt, read });
    }).catch(error => {
      if (!abort.signal.aborted) setState(previous => ({ ticket, attempt, read: previous?.read, error: failureFor(error) }));
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
  return {
    expired,
    blocked: cache?.blocked ?? false,
    snapshot: visible && !cache?.blocked && !expired && !current?.error ? current?.read?.snapshot : undefined,
    // Only for hidden, non-interactive draft subtrees, never authorization.
    retainedSnapshot: !cache?.blocked ? state?.read?.snapshot : undefined,
    error: expired ? expiredFailure : current?.error,
    retry: () => setRetryRequest(value => ({ ticket, id: value.id + 1 })),
  };
}
