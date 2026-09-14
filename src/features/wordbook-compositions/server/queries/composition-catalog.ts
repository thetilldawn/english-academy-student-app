import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { compositionCatalogSchema } from "../../contracts/composition";

export class CompositionCatalogError extends Error {
  constructor(readonly status: 403 | 503) { super("composition_catalog_unavailable"); }
}

export async function getCompositionCatalog(admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_mock_wordbook_scopes_v1");
  const parsed = compositionCatalogSchema.safeParse(data);
  if (error || !parsed.success) throw new CompositionCatalogError(error?.code === "42501" ? 403 : 503);
  return parsed.data;
}
