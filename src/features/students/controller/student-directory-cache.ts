import { createPrivateListCache, PRIVATE_LIST_FRESH_MS, PRIVATE_LIST_DISPLAY_MS, PRIVATE_LIST_GC_MS, type PrivateListRead } from "@/features/session/public-client";
import { DIRECTORY_RESUME_MAX, StudentDirectoryRequestError, type DirectoryCacheRequest, type DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import { emptyStudentDirectoryFilters, normalizeStudentDirectoryFilters, studentDirectoryFilterKey, type StudentDirectoryFilters, type StudentDirectorySnapshot } from "../contracts/student-directory-read-model";
import { loadStudentDirectoryNextPage } from "../transport/student-directory-pages";

export const DIRECTORY_FRESH_MS = PRIVATE_LIST_FRESH_MS;
export const DIRECTORY_DISPLAY_MS = PRIVATE_LIST_DISPLAY_MS;
export const DIRECTORY_GC_MS = PRIVATE_LIST_GC_MS;
type CachedSnapshot = Omit<StudentDirectorySnapshot, "page"> & {
  page: { nextCursor: string | null; items: Omit<StudentDirectorySnapshot["page"]["items"][number], "rawPoints">[] };
};
export type DirectoryCacheRead = PrivateListRead<StudentDirectorySnapshot>;
type Reader = (input: DirectoryCacheRequest, signal: AbortSignal) => Promise<DirectoryCacheResponse>;
export type DirectoryCacheConsumer = "students" | "assignments";
type Points = Extract<DirectoryCacheResponse, { kind: "resume" }>["points"];

function stripPoints(snapshot: StudentDirectorySnapshot): CachedSnapshot {
  return { ...snapshot, page: { ...snapshot.page, items: snapshot.page.items.map(row => {
    const { rawPoints, ...metadata } = row;
    void rawPoints;
    return metadata;
  }) } };
}

export function createStudentDirectoryCache(expectedUserId: string, reader: Reader, now = Date.now) {
  return createPrivateListCache<StudentDirectoryFilters, StudentDirectorySnapshot, CachedSnapshot, Points, DirectoryCacheConsumer>(expectedUserId, {
    defaultConsumer: "students",
    defaultFilters: consumer => consumer === "assignments" ? { ...emptyStudentDirectoryFilters, status: "active" } : emptyStudentDirectoryFilters,
    normalize: normalizeStudentDirectoryFilters,
    key: studentDirectoryFilterKey,
    filters: snapshot => snapshot.filters,
    retain: stripPoints,
    sameSnapshot: (stored, snapshot) => stored.snapshotAt === snapshot.snapshotAt,
    pageCounts: snapshot => ({ students: snapshot.page.items.length }),
    async completeSnapshot(snapshot, counts, context, signal) {
      let page = snapshot.page;
      const target = Math.min(counts.students ?? 0, snapshot.totalCount);
      const cursors = new Set<string>();
      const ids = new Set(page.items.map(row => row.id));
      while (page.items.length < target && page.nextCursor) {
        if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
        const cursor = page.nextCursor;
        if (cursors.has(cursor)) throw new StudentDirectoryRequestError(502);
        cursors.add(cursor);
        const next = await loadStudentDirectoryNextPage({ mode: "page", filters: snapshot.filters, cursor,
          cacheIdentity: context.identity, cacheUserId: context.userId }, signal);
        page = { nextCursor: next.nextCursor, items: [...page.items, ...next.items.filter(row => {
          if (ids.has(row.id)) return false;
          ids.add(row.id); return true;
        })] };
      }
      return { ...snapshot, page };
    },
    restore(snapshot, rows) {
      const points = new Map(rows.map(row => [row.id, row.rawPoints]));
      if (points.size !== rows.length || points.size !== snapshot.page.items.length || snapshot.page.items.some(row => !points.has(row.id))) throw new StudentDirectoryRequestError(502);
      return { ...snapshot, page: { ...snapshot.page, items: snapshot.page.items.map(row => ({ ...row, rawPoints: points.get(row.id)! })) } };
    },
    async reader(filters, reusable, signal) {
      const result = await reader({ mode: "cache", filters, ...(reusable && reusable.snapshot.page.items.length <= DIRECTORY_RESUME_MAX ? { identity: reusable.identity, studentIds: reusable.snapshot.page.items.map(row => row.id) } : {}) }, signal);
      return result.kind === "resume" ? { kind: "resume", identity: result.identity, userId: result.userId, value: result.points } : result;
    },
    error: status => new StudentDirectoryRequestError(status),
    isAccessFailure: error => error instanceof StudentDirectoryRequestError && [401, 403].includes(error.status),
  }, now);
}
export type StudentDirectoryCache = ReturnType<typeof createStudentDirectoryCache>;
