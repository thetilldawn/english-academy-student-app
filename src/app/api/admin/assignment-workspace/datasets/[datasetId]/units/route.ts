import { z } from "zod";

import {
  AssignmentDatasetUnitsError,
  getAssignmentDatasetUnits,
} from "@/features/assignments/server/queries/assignment-dataset-units-query";
import { getAdminContext } from "@/lib/auth/admin";
import { privateJsonError } from "@/lib/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ datasetId: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) return privateJsonError("관리자 로그인이 필요합니다.", 401);
  const parsed = z.uuid().safeParse((await params).datasetId);
  if (!parsed.success) {
    return privateJsonError("단어장을 확인해 주세요.", 400);
  }
  try {
    const result = await getAssignmentDatasetUnits(parsed.data, admin);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentDatasetUnitsError) {
      return privateJsonError(
        error.message,
        error.reason === "invalid_dataset" ? 409 : 503,
      );
    }
    console.error("[assignment-dataset-units] read failed", {
      message: error instanceof Error ? error.message : "unknown",
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return privateJsonError("시험 범위를 불러오지 못했습니다.", 503);
  }
}
