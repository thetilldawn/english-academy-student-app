import { z } from "zod";

const positiveCount = z.number().int().min(1).max(2_147_483_647);
export const wrongWordFiltersSchema = z.object({
  datasetId: z.union([z.uuid(), z.literal("")]).default(""),
  level: z.enum(["all", "once", "repeated"]).default("all"),
  query: z.string().trim().max(200).default(""),
  minWrongCount: positiveCount.optional(),
  maxWrongCount: positiveCount.optional(),
}).strict().superRefine((value, context) => {
  if (value.level !== "all" && (value.minWrongCount !== undefined || value.maxWrongCount !== undefined)) {
    context.addIssue({ code: "custom", message: "횟수 조건을 하나만 선택해 주세요.", path: ["level"] });
  }
  if (value.minWrongCount !== undefined && value.maxWrongCount !== undefined && value.minWrongCount > value.maxWrongCount) {
    context.addIssue({ code: "custom", message: "최대 횟수는 최소 횟수 이상이어야 합니다.", path: ["maxWrongCount"] });
  }
});
export type WrongWordPageFilters = z.infer<typeof wrongWordFiltersSchema>;

/** Keep old filter keys stable for already-issued cursors; bind every new count condition. */
export function wrongWordFilterKey(input: WrongWordPageFilters) {
  // A draft can be invalid (for example, a pasted search over 200 characters).
  // Rendering/cache identity must not throw; validate only at request boundaries.
  const filters = input;
  const parts: (string | number | null)[] = [filters.datasetId, filters.level, filters.query.trim()];
  if (filters.minWrongCount !== undefined || filters.maxWrongCount !== undefined) {
    parts.push(filters.minWrongCount ?? null, filters.maxWrongCount ?? null);
  }
  return JSON.stringify(parts);
}

export function wrongWordFiltersFromSearchParams(params: URLSearchParams) {
  const numberParam = (name: string) => {
    const raw = params.get(name);
    return raw === null ? undefined : /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : Number.NaN;
  };
  return wrongWordFiltersSchema.safeParse({
    datasetId: params.get("datasetId") ?? "",
    level: params.get("level") ?? "all",
    query: params.get("query") ?? "",
    ...(params.has("minWrongCount") ? { minWrongCount: numberParam("minWrongCount") } : {}),
    ...(params.has("maxWrongCount") ? { maxWrongCount: numberParam("maxWrongCount") } : {}),
  });
}

export function wrongWordFilterSearchParams(input: WrongWordPageFilters) {
  const filters = wrongWordFiltersSchema.parse(input);
  const params = new URLSearchParams({ datasetId: filters.datasetId, level: filters.level, query: filters.query });
  if (filters.minWrongCount !== undefined) params.set("minWrongCount", String(filters.minWrongCount));
  if (filters.maxWrongCount !== undefined) params.set("maxWrongCount", String(filters.maxWrongCount));
  return params;
}

