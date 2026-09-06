import { z } from "zod";
import { adminHistoryStatusFilters, normalizeAdminHistoryQuery, type AdminHistorySnapshot } from "./admin-history-read-model";

export const historyCacheIdentitySchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const historyCacheFiltersSchema = z.object({
  currentOnly: z.literal(false), query: z.string().max(80), statusFilter: z.enum(adminHistoryStatusFilters),
}).strict();
export const historyCacheRequestSchema = z.object({
  mode: z.literal("cache"), filters: historyCacheFiltersSchema, identity: historyCacheIdentitySchema.optional(),
}).strict();
export type HistoryCacheFilters = z.infer<typeof historyCacheFiltersSchema>;
export type HistoryCacheRequest = z.infer<typeof historyCacheRequestSchema>;
export type HistoryCacheSeed = { kind: "snapshot"; identity: string | null; userId: string; snapshot: AdminHistorySnapshot };
export type HistoryCacheResponse = HistoryCacheSeed | { kind: "resume"; identity: string; userId: string };
export const emptyHistoryCacheFilters: HistoryCacheFilters = { currentOnly: false, query: "", statusFilter: "all" };
export const normalizeHistoryCacheFilters = (filters: HistoryCacheFilters): HistoryCacheFilters => ({ ...filters, query: normalizeAdminHistoryQuery(filters.query) });
export const historyCacheFilterKey = (filters: HistoryCacheFilters) => JSON.stringify([filters.currentOnly, normalizeAdminHistoryQuery(filters.query), filters.statusFilter]);
