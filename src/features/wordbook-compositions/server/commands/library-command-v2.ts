import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryCommandV2ResultSchema, libraryCommandV2Schema } from "../../contracts/library-command-v2";
import { LibraryCommandError } from "./library-command";

export async function saveLibraryTemplateV2(input: unknown, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const parsed = libraryCommandV2Schema.safeParse(input);
  if (!parsed.success || parsed.data.action === "materialize") throw new LibraryCommandError(422);
  const command = parsed.data;
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("save_vocabulary_library_template_v2", { p_request: command });
  if (error) throw new LibraryCommandError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "40001" ? 409 : ["22023", "22P02", "22003"].includes(error.code) ? 422 : 503);
  const result = libraryCommandV2ResultSchema.safeParse(data);
  if (!result.success) throw new LibraryCommandError(503);
  if (command.action === "delete") {
    if (!("deleted" in result.data) || result.data.deleted.templateId !== command.templateId || result.data.deleted.revision !== command.expectedRevision + 1) throw new LibraryCommandError(503);
  } else {
    if (!("template" in result.data) || result.data.createdBook) throw new LibraryCommandError(503);
    const t = result.data.template;
    if (("templateId" in command && t.id !== command.templateId) || JSON.stringify(t.metadata) !== JSON.stringify(command.metadata) ||
      ("expectedRevision" in command && t.revision !== command.expectedRevision + 1) ||
      (command.action === "copy" && t.latestVersion.sourceVersionId !== command.sourceVersionId) ||
      ("previewHash" in command && t.latestVersion.contentHash !== command.previewHash)) throw new LibraryCommandError(503);
  }
  return result.data;
}
