import "server-only";
import { z } from "zod";
import { awaitWithAbortSignal } from "@/lib/network/request-policy";
import { schoolSearchMessages, schoolSearchRequestSchema, schoolSearchResponseSchema, SchoolSearchRequestError } from "../../contracts/school-search-contract";

const neisSchema = z.object({
  RESULT: z.object({ CODE: z.string() }).optional(),
  schoolInfo: z.array(z.object({
    head: z.array(z.object({ list_total_count: z.number().int().nonnegative().optional(), RESULT: z.object({ CODE: z.string() }).optional() })).optional(),
    row: z.array(z.object({
      ATPT_OFCDC_SC_CODE: z.string().min(1).max(10), SD_SCHUL_CODE: z.string().min(1).max(20),
      SCHUL_NM: z.string().trim().min(1).max(120),
      ORG_RDNMA: z.string().max(240).optional(), LCTN_SC_NM: z.string().max(80).optional(),
    })).max(20).optional(),
  })).optional(),
});

/** Caller owns administrator authorization and the whole request's deadline. */
export async function searchSchoolDirectory(query: string, signal: AbortSignal) {
  const input = schoolSearchRequestSchema.parse({ query });
  const key = process.env.NEIS_API_KEY?.trim();
  if (!key) throw new SchoolSearchRequestError(503, schoolSearchMessages.unavailable);
  const target = new URL("https://open.neis.go.kr/hub/schoolInfo");
  target.search = new URLSearchParams({ KEY: key, Type: "json", pIndex: "1", pSize: "20", SCHUL_NM: input.query }).toString();
  try {
    signal.throwIfAborted();
    const response = await awaitWithAbortSignal(fetch(target, { cache: "no-store", redirect: "error", signal }), signal);
    if (!response.ok) throw new Error("school-response");
    const parsed = neisSchema.parse(await awaitWithAbortSignal(response.json(), signal));
    if (parsed.RESULT?.CODE === "INFO-200" && !parsed.schoolInfo) return { items: [], hasMore: false };
    if (parsed.RESULT) throw new Error("school-provider-error");
    const heads = parsed.schoolInfo?.flatMap(part => part.head ?? []) ?? [];
    const total = heads.find(head => head.list_total_count !== undefined)?.list_total_count;
    const code = heads.find(head => head.RESULT)?.RESULT?.CODE;
    const rows = parsed.schoolInfo?.flatMap(part => part.row ?? []) ?? [];
    if (code !== "INFO-000" || total === undefined || rows.length !== Math.min(total, 20)
      || heads.filter(head => head.RESULT).length !== 1 || heads.filter(head => head.list_total_count !== undefined).length !== 1) throw new Error("school-response-shape");
    const items = rows.map(row => ({ id: `${row.ATPT_OFCDC_SC_CODE}:${row.SD_SCHUL_CODE}`, name: row.SCHUL_NM, region: row.ORG_RDNMA?.trim() || row.LCTN_SC_NM?.trim() || "" }));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("school-duplicate-id");
    return schoolSearchResponseSchema.parse({ items, hasMore: total > items.length });
  } catch {
    // Never return/log a fetch error containing the authenticated URL or raw provider payload.
    throw new SchoolSearchRequestError(503);
  }
}
