import { joinSharedRead, type SharedRead } from "@/lib/network/join-shared-read";
import { normalizeAdminHistoryQuery, type AdminHistorySectionRefreshRequest, type AdminHistorySnapshot } from "../contracts/admin-history-read-model";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";
import { isHistorySnapshotAtLeast } from "../domain/history-snapshot-version";
import { loadAdminHistorySnapshot } from "../transport/history-pages";

/** Owned by one rendered group collection; retains only in-flight reads. */
export function createHistoryRefreshCoordinator(reader = loadAdminHistorySnapshot) {
  const pending = new Map<string, SharedRead<AdminHistorySnapshot>>();
  const readFreshSection = async (input: AdminHistorySectionRefreshRequest, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    const request = { mode: "initial" as const, currentOnly: input.currentOnly,
      query: normalizeAdminHistoryQuery(input.query), statusFilter: input.statusFilter };
    const key = JSON.stringify([request.currentOnly, request.query, request.statusFilter, input.snapshotAt]);
    let task = pending.get(key);
    if (!task || task.abort.signal.aborted) {
      const abort = new AbortController();
      task = { abort, consumers: [], promise: Promise.resolve(undefined as never) };
      const owned = task;
      pending.set(key, owned);
      owned.promise = reader(request, abort.signal).then(snapshot => {
        if (abort.signal.aborted || pending.get(key) !== owned) throw new DOMException("Request cancelled", "AbortError");
        if (!isHistorySnapshotAtLeast(snapshot.snapshotAt, input.snapshotAt)) {
          throw new AdminHistoryRequestError("invalid-response");
        }
        return snapshot;
      }).finally(() => { if (pending.get(key) === owned) pending.delete(key); });
    }
    const snapshot = await joinSharedRead(task, signal);
    const section = snapshot.sections.find(value => value.groupKey === input.groupKey);
    if (!section) throw new AdminHistoryRequestError("invalid-response");
    return section;
  };
  return { readFreshSection, cancelAll() { for (const task of pending.values()) task.abort.abort(); pending.clear(); } };
}

export type HistoryFreshSectionReader = ReturnType<typeof createHistoryRefreshCoordinator>["readFreshSection"];
