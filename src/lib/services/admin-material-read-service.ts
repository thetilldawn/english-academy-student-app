import "server-only";

import { requireAdmin } from "@/lib/auth/admin";

import {
  hydrateAdminMaterialSnapshot,
  loadAdminMaterialSnapshot,
  toSelectableDatasetOptions,
  type AdminMaterialSnapshot,
} from "./admin-material-query";
import { loadSharedVocabMaterialSnapshot } from "./shared-vocab-material-cache";

export {
  loadAdminMaterialSnapshot,
  toSelectableDatasetOptions,
  type AdminMaterialSnapshot,
};

/** 인증 뒤 공용 단어장 목록만 요청 간 재사용합니다. */
export async function loadCurrentAdminMaterialSnapshotForRsc(): Promise<
  AdminMaterialSnapshot
> {
  await requireAdmin();
  return hydrateAdminMaterialSnapshot(
    await loadSharedVocabMaterialSnapshot(),
  );
}
