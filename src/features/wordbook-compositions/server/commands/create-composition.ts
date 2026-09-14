import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createCompositionSchema, createdCompositionSchema } from "../../contracts/composition";

export class CompositionSaveError extends Error {
  constructor(readonly status: 403 | 409 | 422 | 503) { super("composition_save_failed"); }
}
export async function createComposition(input: unknown, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const parsed = createCompositionSchema.safeParse(input);
  if (!parsed.success) throw new CompositionSaveError(422);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_mock_wordbook_composition_v1", { p_request: parsed.data });
  if (error) throw new CompositionSaveError(error.code === "42501" ? 403 : error.code === "40001" ? 409 : ["22023", "22P02"].includes(error.code ?? "") ? 422 : 503);
  const result = createdCompositionSchema.safeParse(data);
  if (!result.success || result.data.title !== parsed.data.title || result.data.scopeCount !== parsed.data.scopes.length) throw new CompositionSaveError(503);
  return result.data;
}
