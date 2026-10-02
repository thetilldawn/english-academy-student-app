import "server-only";
import { z } from "zod";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { queueMistakesSchema, type MistakeTarget } from "../../contracts/mistake-episode";

export class QueueMistakesError extends Error {
  constructor(public readonly status: 400 | 403 | 409 | 503) {
    super(status === 403 ? "관리자 권한을 다시 확인해 주세요." : status === 409 ? "오답이나 배정 상태가 바뀌었습니다. 최신 목록에서 다시 선택해 주세요."
      : status === 400 ? "선택한 뜻을 확인해 주세요." : "오답 복습 대기열을 저장하지 못했습니다. 다시 시도해 주세요.");
  }
}
export async function queueStudentMistakes(studentId: string, targets: readonly MistakeTarget[], authenticatedAdmin?: AdminContext) {
  if (!authenticatedAdmin) await requireAdmin();
  const input = queueMistakesSchema.safeParse({ targets });
  if (!z.uuid().safeParse(studentId).success || !input.success) throw new QueueMistakesError(400);
  const { data, error } = await (await createServerSupabaseClient()).rpc("queue_student_vocabulary_mistakes_v1", {
    p_student_id: studentId, p_targets: input.data.targets,
  });
  if (error) throw new QueueMistakesError(error.code === "42501" ? 403
    : ["40001", "PT409", "22023", "P0002", "23503", "23505"].includes(error.code ?? "") ? 409 : 503);
  const result = z.array(z.uuid()).min(1).max(500).safeParse(data);
  if (!result.success || result.data.length !== input.data.targets.length || new Set(result.data).size !== result.data.length) throw new QueueMistakesError(503);
  return result.data;
}
