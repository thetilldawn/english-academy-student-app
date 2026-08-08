import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { AdminContext } from "@/lib/auth/admin";
import { getGoogleDriveEnvironment } from "@/lib/env";
import {
  READING_CURRICULUM_LABELS,
  type ReadingCurriculumStage,
} from "@/lib/admin/reading-curriculum";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { exportWrongWordWorksheetRequest } from "@/lib/services/wrong-word-worksheet-service";

type StudentReadingContextRow = {
  id: string;
  display_name: string;
  school_name: string | null;
  grade_label: string | null;
  reading_context_drive_file_id: string | null;
  reading_context_content_sha256: string | null;
  reading_context_sync_status:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  reading_context_sync_revision: number;
  reading_context_latest_request_id: string | null;
  reading_context_pending_sha256: string | null;
  reading_context_sync_started_at: string | null;
};

export type StudentReadingContextSyncResult = {
  status: "not_configured" | "synced" | "unchanged" | "failed";
  revision: number;
  contentSha256: string;
  errorCode?: string;
};

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .toUpperCase();
}

function safeDriveFilename(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return normalized || "학생";
}

function driveErrorCode(error: unknown) {
  if (error instanceof Error) {
    if (error.message.startsWith("drive_")) return error.message;
    if (error.name === "AppConfigurationError") {
      return "drive_configuration_invalid";
    }
  }
  return "drive_sync_failed";
}

async function googleAccessToken(environment: NonNullable<
  ReturnType<typeof getGoogleDriveEnvironment>
>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: environment.GOOGLE_DRIVE_OAUTH_CLIENT_ID,
      client_secret: environment.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET,
      refresh_token: environment.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error("drive_oauth_failed");
  }
  return payload.access_token;
}

async function driveFile(
  accessToken: string,
  fileId: string,
): Promise<{
  id: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
} | null> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents,trashed,appProperties&supportsAllDrives=true`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("drive_file_lookup_failed");
  return (await response.json()) as {
    id: string;
    parents?: string[];
    trashed?: boolean;
    appProperties?: Record<string, string>;
  };
}

async function findDriveFile(input: {
  accessToken: string;
  rootFolderId: string;
  studentRef: string;
}) {
  const escapedRef = input.studentRef.replace(/['\\]/g, "\\$&");
  const escapedParent = input.rootFolderId.replace(/['\\]/g, "\\$&");
  const query = [
    `'${escapedParent}' in parents`,
    "trashed = false",
    `appProperties has { key='studentRef' and value='${escapedRef}' }`,
    "appProperties has { key='fileRole' and value='readingContext' }",
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,parents,trashed)");
  url.searchParams.set("pageSize", "2");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("drive_file_search_failed");
  const payload = (await response.json()) as {
    files?: Array<{ id: string; parents?: string[]; trashed?: boolean }>;
  };
  if ((payload.files?.length ?? 0) > 1) {
    throw new Error("drive_duplicate_context_files");
  }
  return payload.files?.[0] ?? null;
}

async function writeDriveJson(input: {
  accessToken: string;
  rootFolderId: string;
  fileId: string | null;
  filename: string;
  studentRef: string;
  contentSha256: string;
  json: string;
}) {
  let existing = input.fileId
    ? await driveFile(input.accessToken, input.fileId)
    : null;
  if (existing?.trashed) existing = null;
  if (
    existing &&
    !(existing.parents ?? []).includes(input.rootFolderId)
  ) {
    throw new Error("drive_file_outside_root");
  }
  if (
    existing &&
    (existing.appProperties?.studentRef !== input.studentRef ||
      existing.appProperties?.fileRole !== "readingContext")
  ) {
    throw new Error("drive_file_identity_mismatch");
  }
  existing ??= await findDriveFile({
    accessToken: input.accessToken,
    rootFolderId: input.rootFolderId,
    studentRef: input.studentRef,
  });

  const metadata = {
    name: input.filename,
    mimeType: "application/json",
    ...(existing ? {} : { parents: [input.rootFolderId] }),
    appProperties: {
      studentRef: input.studentRef,
      fileRole: "readingContext",
      contentSha256: input.contentSha256,
    },
  };
  const boundary = `student-reading-context-${randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    input.json,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const base = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}`
    : "https://www.googleapis.com/upload/drive/v3/files";
  const response = await fetch(
    `${base}?uploadType=multipart&fields=id,parents&supportsAllDrives=true`,
    {
      method: existing ? "PATCH" : "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("drive_file_write_failed");
  const written = (await response.json()) as {
    id?: string;
    parents?: string[];
  };
  if (!written.id || !(written.parents ?? []).includes(input.rootFolderId)) {
    throw new Error("drive_file_parent_mismatch");
  }
  return written.id;
}

export async function syncStudentReadingContext(input: {
  studentId: string;
  requestId: string;
  curriculumStage: ReadingCurriculumStage;
  admin: AdminContext;
}): Promise<StudentReadingContextSyncResult> {
  const worksheet = await exportWrongWordWorksheetRequest(
    input.requestId,
    input.admin,
  );
  if (worksheet.student_id !== input.studentId) {
    throw new Error("worksheet_student_mismatch");
  }

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, display_name, school_name, grade_label, reading_context_drive_file_id, reading_context_content_sha256, reading_context_sync_status, reading_context_sync_revision, reading_context_latest_request_id, reading_context_pending_sha256, reading_context_sync_started_at",
    )
    .eq("id", input.studentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new Error("student_reading_context_not_found");
  const student = data as StudentReadingContextRow;
  const { data: wrongCountRows, error: wrongCountError } = await supabase
    .from("worksheet_request_items")
    .select("item_identity, wrong_count_snapshot")
    .eq("request_id", input.requestId);
  if (wrongCountError) {
    throw new Error("student_reading_context_wrong_counts_failed");
  }
  const wrongCountByIdentity = new Map(
    (wrongCountRows ?? []).map((row) => [
      row.item_identity,
      row.wrong_count_snapshot,
    ]),
  );

  const payloadWithoutHash = {
    schema_version: "student-reading-context-v1" as const,
    student_ref: student.id,
    student: {
      name: student.display_name,
      school: student.school_name,
      grade: student.grade_label,
    },
    curriculum: {
      stage: input.curriculumStage,
      label: READING_CURRICULUM_LABELS[input.curriculumStage],
    },
    worksheet_scope: {
      request_id: worksheet.request_id,
      selected_at_utc: worksheet.created_at_utc,
      item_count: worksheet.item_count,
    },
    wrong_words: worksheet.items.map((item) => ({
      dictionary_id: item.dictionary_id,
      sense_id: item.sense_id,
      occurrence_id: item.occurrence_id,
      headword: item.headword,
      display_gloss_ko: item.display_gloss_ko,
      wrong_count: wrongCountByIdentity.get(item.item_id) ?? item.wrong_level,
      wrong_level: item.wrong_level,
      source_metadata: item.source_metadata,
      provenance_status: item.provenance_status,
      generation_status: item.generation_status,
    })),
    source: {
      worksheet_content_sha256: worksheet.content_sha256,
    },
  };
  const contentSha256 = sha256(stableJson(payloadWithoutHash));
  const json = stableJson({
    ...payloadWithoutHash,
    content_sha256: contentSha256,
  });
  const revision = student.reading_context_sync_revision + 1;
  let environment: ReturnType<typeof getGoogleDriveEnvironment> = null;
  let environmentErrorCode: string | null = null;
  try {
    environment = getGoogleDriveEnvironment();
  } catch (configurationError) {
    environmentErrorCode = driveErrorCode(configurationError);
  }

  if (
    student.reading_context_content_sha256 === contentSha256 &&
    student.reading_context_sync_status === "synced"
  ) {
    if (input.curriculumStage !== "undecided") {
      await supabase
        .from("students")
        .update({ reading_curriculum_stage: input.curriculumStage })
        .eq("id", student.id)
        .is("deleted_at", null);
    }
    return {
      status: "unchanged",
      revision: student.reading_context_sync_revision,
      contentSha256,
    };
  }

  const syncStartedAt = student.reading_context_sync_started_at
    ? Date.parse(student.reading_context_sync_started_at)
    : Number.NaN;
  if (
    Number.isFinite(syncStartedAt) &&
    Date.now() - syncStartedAt < 5 * 60 * 1000
  ) {
    throw new Error("drive_sync_in_progress");
  }

  const initialStatus = environmentErrorCode
    ? "failed"
    : environment
      ? "not_synced"
      : "not_configured";
  const startedAt = environment ? new Date().toISOString() : null;
  const { data: reserved, error: reserveError } = await supabase
    .from("students")
    .update({
      reading_curriculum_stage: input.curriculumStage,
      reading_context_sync_status: initialStatus,
      reading_context_sync_revision: revision,
      reading_context_latest_request_id: input.requestId,
      reading_context_pending_sha256: contentSha256,
      reading_context_sync_started_at: startedAt,
      reading_context_sync_error_code:
        environmentErrorCode ?? (environment ? null : "drive_not_configured"),
    })
    .eq("id", student.id)
    .eq("reading_context_sync_revision", student.reading_context_sync_revision)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (reserveError || !reserved) {
    throw new Error("student_reading_context_conflict");
  }

  if (environmentErrorCode) {
    return {
      status: "failed",
      revision,
      contentSha256,
      errorCode: environmentErrorCode,
    };
  }

  if (!environment) {
    return {
      status: "not_configured",
      revision,
      contentSha256,
      errorCode: "drive_not_configured",
    };
  }

  try {
    const accessToken = await googleAccessToken(environment);
    const fileId = await writeDriveJson({
      accessToken,
      rootFolderId: environment.GOOGLE_DRIVE_STUDENT_ROOT_FOLDER_ID,
      fileId: student.reading_context_drive_file_id,
      filename: `${safeDriveFilename(student.display_name)}__${student.id.slice(0, 8)}__해석시험지_AI입력.json`,
      studentRef: student.id,
      contentSha256,
      json,
    });
    const { error: completeError } = await supabase
      .from("students")
      .update({
        reading_context_drive_file_id: fileId,
        reading_context_content_sha256: contentSha256,
        reading_context_sync_status: "synced",
        reading_context_pending_sha256: null,
        reading_context_sync_started_at: null,
        reading_context_synced_at: new Date().toISOString(),
        reading_context_sync_error_code: null,
      })
      .eq("id", student.id)
      .eq("reading_context_sync_revision", revision)
      .eq("reading_context_latest_request_id", input.requestId)
      .select("id")
      .maybeSingle();
    if (completeError) throw new Error("drive_sync_state_write_failed");
    const { data: completedState } = await supabase
      .from("students")
      .select("reading_context_sync_status, reading_context_sync_revision")
      .eq("id", student.id)
      .maybeSingle();
    if (
      completedState?.reading_context_sync_revision !== revision ||
      completedState?.reading_context_sync_status !== "synced"
    ) {
      throw new Error("drive_sync_superseded");
    }
    return { status: "synced", revision, contentSha256 };
  } catch (syncError) {
    const errorCode = driveErrorCode(syncError);
    await supabase
      .from("students")
      .update({
        reading_context_sync_status: "failed",
        reading_context_sync_started_at: null,
        reading_context_sync_error_code: errorCode,
      })
      .eq("id", student.id)
      .eq("reading_context_sync_revision", revision)
      .eq("reading_context_latest_request_id", input.requestId);
    console.error("[student-reading-context] drive sync failed", {
      studentId: student.id,
      requestId: input.requestId,
      revision,
      errorCode,
    });
    return {
      status: "failed",
      revision,
      contentSha256,
      errorCode,
    };
  }
}
