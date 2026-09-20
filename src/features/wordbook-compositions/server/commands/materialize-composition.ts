import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { libraryCommandSchema, libraryCommandResultSchema } from "../../contracts/library";
import { compositionPreparationSchema } from "../../contracts/library-materialization";
import { planCompositionQuestions } from "../use-cases/composition-question-plan";
import { LibraryCommandError } from "./library-command";

export async function materializeLibraryComposition(input: unknown, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const parsed = libraryCommandSchema.safeParse(input);
  if (!parsed.success || parsed.data.action !== "materialize") throw new LibraryCommandError(422);
  const command = parsed.data;
  const client = await createServerSupabaseClient();
  const preparation = await client.rpc("prepare_vocabulary_template_book_v1", { p_request: command });
  if (preparation.error) throw new LibraryCommandError(preparation.error.code === "42501" ? 403 : preparation.error.code === "P0002" ? 404 : preparation.error.code === "40001" ? 409 : preparation.error.code === "22023" ? 422 : 503);
  const prepared = compositionPreparationSchema.safeParse(preparation.data);
  if (!prepared.success || prepared.data.versionId !== command.versionId || prepared.data.contentHash !== command.contentHash) throw new LibraryCommandError(503);
  if (prepared.data.state !== "ready") {
    const questions = planCompositionQuestions(prepared.data);
    const finalized = await getServiceSupabaseClient().rpc("finalize_vocabulary_composition_v1", { p_version_id: command.versionId, p_content_sha256: command.contentHash, p_questions: questions });
    if (finalized.error) throw new LibraryCommandError(finalized.error.code === "40001" ? 409 : finalized.error.code === "22023" ? 422 : 503);
    const fixed = compositionPreparationSchema.safeParse(finalized.data);
    if (!fixed.success || fixed.data.state !== "ready" || fixed.data.versionId !== command.versionId || fixed.data.datasetId !== prepared.data.datasetId || fixed.data.contentHash !== command.contentHash) throw new LibraryCommandError(503);
  }
  const response = await client.rpc("get_vocabulary_composition_summary_v1", { p_version_id: command.versionId });
  const result = libraryCommandResultSchema.safeParse(response.data);
  if (response.error || !result.success || result.data.template.id !== command.templateId || result.data.createdBook?.versionId !== command.versionId || result.data.createdBook.contentHash !== command.contentHash || result.data.createdBook.dataset.id !== prepared.data.datasetId) throw new LibraryCommandError(503);
  return result.data;
}
