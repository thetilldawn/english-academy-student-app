import "server-only";

import { z } from "zod";

import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const requestResultSchema = z
  .array(
    z
      .object({
        request_id: z.uuid(),
        item_count: z.number().int().min(1).max(50),
        content_sha256: z.string().regex(/^[A-F0-9]{64}$/),
        reused: z.boolean(),
      })
      .strict(),
  )
  .length(1);

const worksheetItemSchema = z
  .object({
    position: z.number().int().min(1).max(50),
    item_id: z.string().min(3).max(500),
    dictionary_id: z
      .string()
      .regex(/^(word|root_affix|expression):[a-z0-9][a-z0-9._'’-]*$/)
      .nullable(),
    sense_id: z.string().nullable(),
    occurrence_id: z
      .string()
      .regex(/^occ:[a-z0-9][a-z0-9._-]*$/)
      .nullable(),
    dataset_id: z.uuid(),
    vocab_entry_id: z.number().int().positive(),
    canonical_lexeme_id: z.uuid().nullable(),
    headword: z.string().min(1).max(160),
    display_gloss_ko: z.string().min(1).max(500),
    wrong_level: z.union([z.literal(1), z.literal(2)]),
    generation_status: z.enum([
      "ready",
      "needs_dictionary_link",
      "needs_meaning_review",
    ]),
    provenance_status: z.enum([
      "reviewed_for_preview_v1",
      "verified_v2",
      "legacy_backfill",
    ]),
    occurrence_content_hash: z
      .string()
      .regex(/^[A-Fa-f0-9]{64}$/)
      .nullable(),
    source_metadata: z.record(z.string(), z.unknown()),
    item_content_sha256: z.string().regex(/^[A-F0-9]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.generation_status === "ready" &&
      (value.provenance_status !== "reviewed_for_preview_v1" ||
        !value.dictionary_id ||
        !value.occurrence_id ||
        !value.occurrence_content_hash)
    ) {
      context.addIssue({
        code: "custom",
        message: "자동 생성 가능 항목의 사전·출처 근거가 불완전합니다.",
        path: ["generation_status"],
      });
    }
  });

const worksheetExportSchema = z
  .object({
    schema_version: z.literal("wrong-word-worksheet-request-v1"),
    request_id: z.uuid(),
    student_id: z.uuid(),
    request_type: z.literal("wrong_word_translation"),
    created_at_utc: z.iso.datetime({ offset: true }),
    target_profile: z
      .object({
        school_name: z.string().nullable(),
        grade_label: z.string().nullable(),
      })
      .strict(),
    item_count: z.number().int().min(1).max(50),
    items: z.array(worksheetItemSchema).min(1).max(50),
    content_sha256: z.string().regex(/^[A-F0-9]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.item_count !== value.items.length) {
      context.addIssue({
        code: "custom",
        message: "요청 문항 수와 내보내기 문항 수가 다릅니다.",
        path: ["items"],
      });
    }
    const positions = value.items.map((item) => item.position);
    const identities = value.items.map((item) => item.item_id);
    if (
      positions.some((position, index) => position !== index + 1) ||
      new Set(identities).size !== identities.length
    ) {
      context.addIssue({
        code: "custom",
        message: "내보내기 문항의 순서 또는 식별자가 올바르지 않습니다.",
        path: ["items"],
      });
    }
  });

export type WrongWordWorksheetExport = z.infer<
  typeof worksheetExportSchema
>;

export type WrongWordWorksheetRequestResult = {
  requestId: string;
  itemCount: number;
  contentSha256: string;
  reused: boolean;
};

export class WrongWordWorksheetError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "invalid_selection"
      | "not_found"
      | "database",
  ) {
    super(reason);
    this.name = "WrongWordWorksheetError";
  }
}

function worksheetErrorReason(code: string | undefined) {
  if (code === "42501") return "forbidden" as const;
  if (code === "P0002") return "not_found" as const;
  if (["22023", "23503", "23505"].includes(code ?? "")) {
    return "invalid_selection" as const;
  }
  return "database" as const;
}

export async function createWrongWordWorksheetRequest(
  studentId: string,
  questionIds: string[],
  authenticatedAdmin?: AdminContext,
): Promise<WrongWordWorksheetRequestResult> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_wrong_word_worksheet_request_v1",
    {
      p_student_id: studentId,
      p_question_ids: questionIds,
    },
  );

  if (error) {
    console.error("[wrong-word-worksheet-request] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new WrongWordWorksheetError(
      worksheetErrorReason(error.code),
    );
  }

  const parsed = requestResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new WrongWordWorksheetError("database");
  }

  const [result] = parsed.data;
  return {
    requestId: result.request_id,
    itemCount: result.item_count,
    contentSha256: result.content_sha256,
    reused: result.reused,
  };
}

export async function exportWrongWordWorksheetRequest(
  requestId: string,
  authenticatedAdmin?: AdminContext,
): Promise<WrongWordWorksheetExport> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "export_wrong_word_worksheet_request_v1",
    { p_request_id: requestId },
  );

  if (error) {
    console.error("[wrong-word-worksheet-export] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new WrongWordWorksheetError(
      worksheetErrorReason(error.code),
    );
  }

  const parsed = worksheetExportSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[wrong-word-worksheet-export] invalid projection", {
      requestId,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
      })),
    });
    throw new WrongWordWorksheetError("database");
  }

  return parsed.data;
}

export function wrongWordWorksheetFilename(
  worksheet: WrongWordWorksheetExport,
) {
  return `wrong-word-worksheet-request-v1_${worksheet.content_sha256
    .slice(0, 8)
    .toLocaleLowerCase("en-US")}.json`;
}
