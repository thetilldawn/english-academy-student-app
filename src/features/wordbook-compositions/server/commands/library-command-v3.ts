import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryCommandV3ResultSchema, libraryCommandV3Schema } from "../../contracts/library-v3";
import { LibraryCommandError } from "./library-command";

export async function saveLibraryTemplateV3(input: unknown, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const parsed = libraryCommandV3Schema.safeParse(input);
  if (!parsed.success || parsed.data.action === "materialize") throw new LibraryCommandError(422);
  const command = parsed.data;
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("save_vocabulary_library_template_v3", { p_request: command });
  if (error) throw new LibraryCommandError(error.code === "42501" ? 403 : error.code === "P0002" ? 404
    : ["40001", "PT409"].includes(error.code) ? 409 : ["22023", "22P02", "22003"].includes(error.code) ? 422 : 503);
  const result = libraryCommandV3ResultSchema.safeParse(data);
  if (!result.success || result.data.createdBook) throw new LibraryCommandError(503);
  const t = result.data.template;
  if (t.templateKind !== command.templateKind || JSON.stringify(t.metadata) !== JSON.stringify(command.metadata)
    || ("templateId" in command && t.id !== command.templateId)
    || ("expectedRevision" in command && t.revision !== command.expectedRevision + 1)
    || (command.action === "copy" && t.latestVersion.sourceVersionId !== command.sourceVersionId)
    || ("previewHash" in command && t.latestVersion.contentHash !== command.previewHash)) throw new LibraryCommandError(503);
  return result.data;
}
