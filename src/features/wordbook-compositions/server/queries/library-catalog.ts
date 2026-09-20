import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { libraryCatalogSchema } from "../../contracts/library";

export class LibraryCatalogError extends Error {
  constructor(readonly status: 403 | 503) { super("library_catalog_unavailable"); }
}

export async function getLibraryCatalog(admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_vocabulary_library_v1");
  const parsed = libraryCatalogSchema.safeParse(data);
  if (error || !parsed.success) throw new LibraryCatalogError(error?.code === "42501" ? 403 : 503);
  return parsed.data;
}
