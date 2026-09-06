import { createPrivateListCache, PRIVATE_LIST_FRESH_MS, PRIVATE_LIST_DISPLAY_MS, PRIVATE_LIST_GC_MS, type PrivateListRead } from "@/features/session/public-client";
import { StudentDirectoryRequestError, type DirectoryCacheRequest, type DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import { emptyStudentDirectoryFilters, normalizeStudentDirectoryFilters, studentDirectoryFilterKey, type StudentDirectoryFilters, type StudentDirectorySnapshot } from "../contracts/student-directory-read-model";

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
    restore(snapshot, rows) {
      const points = new Map(rows.map(row => [row.id, row.rawPoints]));
      if (points.size !== rows.length || points.size !== snapshot.page.items.length || snapshot.page.items.some(row => !points.has(row.id))) throw new StudentDirectoryRequestError(502);
      return { ...snapshot, page: { ...snapshot.page, items: snapshot.page.items.map(row => ({ ...row, rawPoints: points.get(row.id)! })) } };
    },
    async reader(filters, reusable, signal) {
      const result = await reader({ mode: "cache", filters, ...(reusable ? { identity: reusable.identity, studentIds: reusable.snapshot.page.items.map(row => row.id) } : {}) }, signal);
      return result.kind === "resume" ? { kind: "resume", identity: result.identity, userId: result.userId, value: result.points } : result;
    },
    error: status => new StudentDirectoryRequestError(status),
    isAccessFailure: error => error instanceof StudentDirectoryRequestError && [401, 403].includes(error.status),
  }, now);
}
export type StudentDirectoryCache = ReturnType<typeof createStudentDirectoryCache>;
