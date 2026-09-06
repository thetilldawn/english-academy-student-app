import { joinSharedRead, type SharedRead } from "@/lib/network/join-shared-read";

export const PRIVATE_LIST_FRESH_MS = 15_000;
export const PRIVATE_LIST_DISPLAY_MS = 60_000;
export const PRIVATE_LIST_GC_MS = 120_000;
export type PrivateListRead<Snapshot> = { snapshot: Snapshot; savedAt: number };
export type PrivateListSeed<Snapshot> = { kind: "snapshot"; identity: string | null; userId: string; snapshot: Snapshot };
export type PrivateListResponse<Snapshot, Resume> = PrivateListSeed<Snapshot> |
  { kind: "resume"; identity: string; userId: string; value: Resume };
type Policy<Filters, Snapshot, Stored, Resume, Consumer extends string> = {
  defaultConsumer: Consumer;
  defaultFilters: (consumer: Consumer) => Filters;
  normalize: (filters: Filters) => Filters;
  key: (filters: Filters) => string;
  filters: (snapshot: Snapshot) => Filters;
  retain: (snapshot: Snapshot) => Stored;
  restore: (stored: Stored, resume: Resume) => Snapshot;
  reader: (filters: Filters, reusable: { identity: string; snapshot: Stored } | undefined, signal: AbortSignal) => Promise<PrivateListResponse<Snapshot, Resume>>;
  error: (status: 401 | 502 | 503) => Error;
  isAccessFailure: (error: unknown) => boolean;
};
const aborted = () => new DOMException("Request cancelled", "AbortError");

/** One feature/provider instance per signed-in user; never a global/server store. */
export function createPrivateListCache<Filters, Snapshot, Stored, Resume, Consumer extends string>(
  expectedUserId: string, policy: Policy<Filters, Snapshot, Stored, Resume, Consumer>, now = Date.now,
) {
  type Entry = { snapshot: Stored; savedAt: number; lastUsedAt: number; timer: ReturnType<typeof setTimeout> };
  const entries = new Map<string, Entry>();
  const pending = new Map<string, SharedRead<PrivateListRead<Snapshot>>>();
  const listeners = new Set<() => void>();
  const rememberedFilters = new Map<Consumer, Filters>();
  let identity: string | null = null;
  let revision = 0;
  let blocked = false;
  let disposed = false;
  let displayDeadlineAt = 0;
  const filtersFor = (consumer: Consumer = policy.defaultConsumer) => rememberedFilters.get(consumer) ?? policy.defaultFilters(consumer);
  const emit = () => { revision++; listeners.forEach(listener => listener()); };
  const removeEntry = (key: string) => { const entry = entries.get(key); if (entry) clearTimeout(entry.timer); entries.delete(key); };
  const cancelRequests = () => { for (const request of pending.values()) request.abort.abort(); pending.clear(); };
  const clear = () => { cancelRequests(); for (const key of entries.keys()) removeEntry(key); };
  const lock = () => { if (blocked) return; blocked = true; clear(); rememberedFilters.clear(); identity = null; emit(); };
  function store(key: string, snapshot: Snapshot) {
    removeEntry(key);
    const time = now();
    entries.set(key, { snapshot: policy.retain(snapshot), savedAt: time, lastUsedAt: time,
      timer: setTimeout(() => removeEntry(key), PRIVATE_LIST_GC_MS) });
    while (entries.size > 20) removeEntry(entries.keys().next().value!);
  }
  async function read(filtersInput: Filters, signal?: AbortSignal, force = false, consumer: Consumer = policy.defaultConsumer): Promise<PrivateListRead<Snapshot>> {
    if (disposed || signal?.aborted) throw aborted();
    if (blocked) throw policy.error(401);
    const filters = policy.normalize(filtersInput);
    rememberedFilters.set(consumer, filters);
    const key = policy.key(filters);
    const current = pending.get(key);
    if (current && !current.abort.signal.aborted && !force) return joinSharedRead(current, signal);
    if (current) { current.abort.abort(); pending.delete(key); }
    const cached = !force ? entries.get(key) : undefined;
    const usable = cached && identity && now() - cached.savedAt < PRIVATE_LIST_FRESH_MS ? cached : undefined;
    if (usable) {
      usable.lastUsedAt = now(); clearTimeout(usable.timer);
      usable.timer = setTimeout(() => removeEntry(key), PRIVATE_LIST_GC_MS);
    }
    const abort = new AbortController();
    const request: SharedRead<PrivateListRead<Snapshot>> = { abort, consumers: [], promise: Promise.resolve(undefined as never) };
    pending.set(key, request);
    const checkCurrent = () => { if (disposed || blocked || abort.signal.aborted || pending.get(key) !== request) throw aborted(); };
    request.promise = policy.reader(filters, usable && identity ? { identity, snapshot: usable.snapshot } : undefined, abort.signal).then(result => {
      checkCurrent();
      if (result.userId !== expectedUserId || (identity && result.identity !== identity)) {
        lock(); throw policy.error(401);
      }
      identity = result.identity;
      let snapshot: Snapshot;
      let savedAt: number;
      if (result.kind === "snapshot") {
        if (policy.key(policy.filters(result.snapshot)) !== key) throw policy.error(502);
        snapshot = result.snapshot; savedAt = now();
        if (identity) store(key, snapshot);
      } else {
        if (!usable || now() - usable.savedAt >= PRIVATE_LIST_DISPLAY_MS) throw policy.error(503);
        snapshot = policy.restore(usable.snapshot, result.value);
        savedAt = usable.savedAt;
      }
      rememberedFilters.set(consumer, filters);
      displayDeadlineAt = savedAt + PRIVATE_LIST_DISPLAY_MS;
      emit();
      return { snapshot, savedAt };
    }).catch(error => {
      // Check ownership before even an authentication error can affect the store.
      if (disposed || abort.signal.aborted || pending.get(key) !== request) throw aborted();
      if (policy.isAccessFailure(error) && !blocked) lock();
      if (!blocked && displayDeadlineAt) { displayDeadlineAt = now(); emit(); }
      throw error;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    return joinSharedRead(request, signal);
  }
  return {
    read, lock, cancelRequests,
    hydrate(result: PrivateListSeed<Snapshot>, consumer: Consumer = policy.defaultConsumer): PrivateListRead<Snapshot> {
      if (disposed || blocked) throw policy.error(401);
      if (result.userId !== expectedUserId || (identity && result.identity !== identity)) { lock(); throw policy.error(401); }
      identity = result.identity;
      const filters = policy.normalize(policy.filters(result.snapshot));
      rememberedFilters.set(consumer, filters);
      const savedAt = now();
      if (identity) store(policy.key(filters), result.snapshot);
      displayDeadlineAt = savedAt + PRIVATE_LIST_DISPLAY_MS;
      emit();
      return { snapshot: result.snapshot, savedAt };
    },
    rememberFilters(filters: Filters, consumer: Consumer = policy.defaultConsumer) { rememberedFilters.set(consumer, policy.normalize(filters)); },
    filtersFor,
    invalidate() { clear(); displayDeadlineAt = 0; emit(); },
    get blocked() { return blocked; },
    get revision() { return revision; },
    get lastFilters() { return filtersFor(); },
    get identity() { return identity; },
    get userId() { return expectedUserId; },
    get displayDeadlineAt() { return displayDeadlineAt; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    inspect() { return [...entries.values()].map(({ snapshot, savedAt, lastUsedAt }) => ({ snapshot, savedAt, lastUsedAt })); },
    dispose() { disposed = true; clear(); rememberedFilters.clear(); listeners.clear(); },
  };
}
