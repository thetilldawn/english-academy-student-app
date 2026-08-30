import {
  AssignmentDatasetDirectoryError,
  listAssignableAssignmentDatasets,
} from "@/features/assignments/server/queries/assignment-dataset-directory-query";
import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";

export async function GET() {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);

  try {
    const result = await listAssignableAssignmentDatasets(admin);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentDatasetDirectoryError) {
      return privateJsonError(error.message, 503);
    }
    console.error("[assignment-dataset-directory] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("단어장 목록을 불러오지 못했습니다.", 503);
  }
}
