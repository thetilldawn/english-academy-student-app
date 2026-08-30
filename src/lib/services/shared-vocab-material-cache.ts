import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";

import { getServiceSupabaseClient } from "@/lib/supabase/service";

import {
  loadAdminMaterialSnapshot,
  serializeAdminMaterialSnapshot,
  type SerializableAdminMaterialSnapshot,
} from "./admin-material-query";

export const SHARED_VOCAB_MATERIAL_CACHE_TAG =
  "shared-vocab-material-directory:v1";

export async function loadSharedVocabMaterialSnapshot(): Promise<
  SerializableAdminMaterialSnapshot
> {
  "use cache";

  cacheLife({ stale: 60, revalidate: 300, expire: 600 });
  cacheTag(SHARED_VOCAB_MATERIAL_CACHE_TAG);
  const snapshot = await loadAdminMaterialSnapshot(
    getServiceSupabaseClient(),
  );
  return serializeAdminMaterialSnapshot(snapshot);
}

export function revalidateSharedVocabMaterialCache() {
  revalidateTag(SHARED_VOCAB_MATERIAL_CACHE_TAG, "max");
}
