import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryCommandResultSchema, libraryCommandSchema } from "../../contracts/library";
import { latestLibraryVersion } from "../../domain/template-version";

export class LibraryCommandError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 422 | 503) { super("library_save_failed"); }
}

export async function saveLibraryTemplate(input: unknown, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const command = libraryCommandSchema.safeParse(input);
  if (!command.success) throw new LibraryCommandError(422);
  if (command.data.action === "materialize") throw new LibraryCommandError(422);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("save_vocabulary_library_template_v1", { p_request: command.data });
  if (error) throw new LibraryCommandError(error.code === "42501" ? 403 : error.code === "P0002" ? 404 :
    error.code === "40001" ? 409 : ["22023", "22P02", "22003"].includes(error.code) ? 422 : 503);
  const result = libraryCommandResultSchema.safeParse(data);
  if (!result.success) throw new LibraryCommandError(503);
  const c = command.data, t = result.data.template;
  if (("templateId" in c && t.id !== c.templateId) || ("metadata" in c && JSON.stringify(t.metadata) !== JSON.stringify(c.metadata))) {
    throw new LibraryCommandError(503);
  }
  if (c.action === "copy" && latestLibraryVersion(t).sourceVersionId !== c.sourceVersionId) throw new LibraryCommandError(503);
  if ("expectedRevision" in c && t.revision !== c.expectedRevision + 1) throw new LibraryCommandError(503);
  return result.data;
}
