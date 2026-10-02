import "server-only";
import { z } from "zod";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryClassificationSchema } from "../../contracts/library";
import { libraryDetailSchema, libraryPreviewSchema, libraryQuerySchema, libraryQueryResultSchema } from "../../contracts/library-query";
import { libraryTagsFromClassifications } from "../../domain/library-editor";
import { LibraryCommandError } from "../library-error";
import { classifiedDetailSchema, classifiedPreviewSchema, classifiedQueryResultSchema } from "../../contracts/library-v3";

const previewRpcSchema = libraryPreviewSchema.omit({ automaticTags: true, suggestedTitle: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
const detailRpcSchema = libraryDetailSchema.omit({ automaticTags: true, sourceTags: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
const classifiedDetailRpcSchema = classifiedDetailSchema.omit({ automaticTags: true, sourceTags: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
const classifiedPreviewRpcSchema = classifiedPreviewSchema.omit({ automaticTags: true, suggestedTitle: true }).extend({ classifications: z.array(libraryClassificationSchema).max(2000) }).strict();
export async function queryLibrary(input: unknown, admin?: AdminContext, classified = false) {
  const actor = admin ?? await requireAdmin();
  const query = libraryQuerySchema.safeParse(input);
  if (!query.success) throw new LibraryCommandError(422);
  if (!classified && query.data.kind === "templates" && query.data.templateKind !== undefined) throw new LibraryCommandError(422);
  const client = await createServerSupabaseClient();
  const request = classified && query.data.kind === "templates" ? { ...query.data, templateKind: query.data.templateKind ?? "all" } : query.data;
  const response = await client.rpc(classified ? "query_vocabulary_library_v2" : "query_vocabulary_library_v1", { p_query: request });
  if (response.error) throw new LibraryCommandError(response.error.code === "42501" ? 403 : response.error.code === "P0002" ? 404 : (response.error.code === "40001" || response.error.code === "PT409") ? 409 : ["22023", "22P02", "22003"].includes(response.error.code) ? 422 : 503);
  let data: unknown = response.data;
  if (query.data.kind === "preview") {
    const parsed = (classified ? classifiedPreviewRpcSchema : previewRpcSchema).safeParse(data);
    if (!parsed.success) throw new LibraryCommandError(503);
    const { classifications, ...preview } = parsed.data;
    const automaticTags = libraryTagsFromClassifications(classifications, query.data.metadata);
    data = { ...preview, automaticTags, suggestedTitle: automaticTags.filter(t => !t.startsWith("원자료 ") && !t.endsWith("년 준비")).join(" · ").slice(0, 100) };
  } else if (query.data.kind === "detail") {
    const parsed = (classified ? classifiedDetailRpcSchema : detailRpcSchema).safeParse(data);
    if (!parsed.success) throw new LibraryCommandError(503);
    const { classifications, ...detail } = parsed.data;
    data = { ...detail, automaticTags: libraryTagsFromClassifications(classifications, detail.template.metadata),
      sourceTags: libraryTagsFromClassifications(classifications, { title: "", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null }) };
  }
  const result = (classified ? classifiedQueryResultSchema : libraryQueryResultSchema).safeParse(data);
  if (!result.success || result.data.kind !== query.data.kind || result.data.viewerId !== actor.userId) throw new LibraryCommandError(503);
  return result.data;
}
