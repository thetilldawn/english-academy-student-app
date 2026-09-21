import "server-only";
import { z } from "zod";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryClassificationSchema } from "../../contracts/library";
import { libraryDetailSchema, libraryPreviewSchema, libraryQuerySchema, libraryQueryResultSchema } from "../../contracts/library-query";
import { libraryTagsFromClassifications } from "../../domain/library-editor";
import { LibraryCommandError } from "../library-error";

const previewRpcSchema = libraryPreviewSchema.omit({ automaticTags: true, suggestedTitle: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
const detailRpcSchema = libraryDetailSchema.omit({ automaticTags: true, sourceTags: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
export async function queryLibrary(input: unknown, admin?: AdminContext) {
  const actor = admin ?? await requireAdmin();
  const query = libraryQuerySchema.safeParse(input);
  if (!query.success) throw new LibraryCommandError(422);
  const client = await createServerSupabaseClient();
  const response = await client.rpc("query_vocabulary_library_v1", { p_query: query.data });
  if (response.error) throw new LibraryCommandError(response.error.code === "42501" ? 403 : response.error.code === "P0002" ? 404 : response.error.code === "40001" ? 409 : ["22023", "22P02", "22003"].includes(response.error.code) ? 422 : 503);
  let data: unknown = response.data;
  if (query.data.kind === "preview") {
    const parsed = previewRpcSchema.safeParse(data);
    if (!parsed.success) throw new LibraryCommandError(503);
    const { classifications, ...preview } = parsed.data;
    const automaticTags = libraryTagsFromClassifications(classifications, query.data.metadata);
    data = { ...preview, automaticTags, suggestedTitle: automaticTags.filter(t => !t.startsWith("원자료 ") && !t.endsWith("년 준비")).join(" · ").slice(0, 100) };
  } else if (query.data.kind === "detail") {
    const parsed = detailRpcSchema.safeParse(data);
    if (!parsed.success) throw new LibraryCommandError(503);
    const { classifications, ...detail } = parsed.data;
    data = { ...detail, automaticTags: libraryTagsFromClassifications(classifications, detail.template.metadata),
      sourceTags: libraryTagsFromClassifications(classifications, { title: "", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null }) };
  }
  const result = libraryQueryResultSchema.safeParse(data);
  if (!result.success || result.data.kind !== query.data.kind || result.data.viewerId !== actor.userId) throw new LibraryCommandError(503);
  return result.data;
}
