import "server-only";

import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class WrongWordQueueError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "invalid_selection"
      | "database",
  ) {
    super("오답 단어를 다음 시험 대기열에 추가하지 못했습니다.");
    this.name = "WrongWordQueueError";
  }
}

export async function queueStudentWrongWords(
  studentId: string,
  questionIds: string[],
  authenticatedAdmin?: AdminContext,
): Promise<string[]> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "queue_student_vocab_review_words",
    {
      p_student_id: studentId,
      p_question_ids: questionIds,
    },
  );

  if (error || !Array.isArray(data)) {
    console.error("[wrong-word-queue] database operation failed", {
      code: error?.code ?? "missing_result",
      message: error?.message ?? "queue ids were not returned",
      hint: error?.hint ?? null,
    });
    throw new WrongWordQueueError(
      error?.code === "42501"
        ? "forbidden"
        : ["22023", "P0002", "23503", "23505"].includes(
              error?.code ?? "",
            )
          ? "invalid_selection"
          : "database",
    );
  }

  if (
    data.length === 0 ||
    data.some((queueId) => typeof queueId !== "string")
  ) {
    throw new WrongWordQueueError("database");
  }

  return data as string[];
}
