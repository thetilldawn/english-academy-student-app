import "server-only";

import type { AssignmentDatasetDirectoryResponse } from "../../contracts/assignment-workspace-read-model";
import type { AdminContext } from "@/lib/auth/admin";
import { loadAdminMaterialSnapshot } from "@/lib/services/admin-material-read-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class AssignmentDatasetDirectoryError extends Error {
  constructor(message = "단어장 목록을 불러오지 못했습니다.") {
    super(message);
    this.name = "AssignmentDatasetDirectoryError";
  }
}

export async function listAssignableAssignmentDatasets(
  authenticatedAdmin: AdminContext,
): Promise<AssignmentDatasetDirectoryResponse> {
  if (!authenticatedAdmin.userId) {
    throw new AssignmentDatasetDirectoryError();
  }

  try {
    const supabase = await createServerSupabaseClient();
    const material = await loadAdminMaterialSnapshot(supabase);
    return {
      datasets: material.selectableDatasets,
    };
  } catch (error) {
    if (error instanceof AssignmentDatasetDirectoryError) throw error;
    throw new AssignmentDatasetDirectoryError();
  }
}
