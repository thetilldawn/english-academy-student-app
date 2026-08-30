import "server-only";

import { cache } from "react";

import { requireAdmin } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  loadAdminMaterialSnapshot,
  toSelectableDatasetOptions,
  type AdminMaterialSnapshot,
} from "./admin-material-query";

export {
  loadAdminMaterialSnapshot,
  toSelectableDatasetOptions,
  type AdminMaterialSnapshot,
};

const loadAdminMaterialSnapshotForRscRequest = cache(
  async (adminUserId: string): Promise<AdminMaterialSnapshot> => {
    if (!adminUserId) {
      throw new Error("관리자 인증 정보가 필요합니다.");
    }
    const supabase = await createServerSupabaseClient();
    return loadAdminMaterialSnapshot(supabase);
  },
);

/** 인증된 한 RSC 요청 안에서만 단어장 목록을 중복 조회하지 않습니다. */
export async function loadCurrentAdminMaterialSnapshotForRsc(): Promise<
  AdminMaterialSnapshot
> {
  const admin = await requireAdmin();
  return loadAdminMaterialSnapshotForRscRequest(admin.userId);
}
