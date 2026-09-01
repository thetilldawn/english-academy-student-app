import type { APIRequestContext } from "@playwright/test";

export type PreviewCleanupState =
  | "intended"
  | "pending"
  | "deleted"
  | "failed";

export type PreviewCleanupStudent = {
  cleanup: PreviewCleanupState;
  displayName: string;
  id: string | null;
};

type DirectoryStudent = {
  displayName: string;
  id: string;
};

type DirectorySnapshot = {
  page: {
    items: DirectoryStudent[];
    nextCursor: string | null;
  };
  totalCount: number;
};

type CleanupResolution =
  | { kind: "absent" }
  | { id: string; kind: "delete"; recovered: boolean };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const e2eDisplayNamePattern =
  /^\[E2E\] [a-z0-9-]{1,28} e2e-[a-z0-9-]{6,}(?: [a-f0-9]{6})?$/;
const cleanupStates = new Set<PreviewCleanupState>([
  "intended",
  "pending",
  "deleted",
  "failed",
]);

function assertCleanupStudent(student: PreviewCleanupStudent) {
  if (!cleanupStates.has(student.cleanup)) {
    throw new Error("가짜 학생 정리 상태가 올바르지 않습니다.");
  }
  if (!e2eDisplayNamePattern.test(student.displayName)) {
    throw new Error("가짜 학생 이름이 승인된 E2E 형식이 아닙니다.");
  }
  if (student.id !== null && !uuidPattern.test(student.id)) {
    throw new Error("가짜 학생 ID 형식이 올바르지 않습니다.");
  }
}

function parseDirectorySnapshot(value: unknown): DirectorySnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("학생 목록 응답 형식이 올바르지 않습니다.");
  }
  const snapshot = value as {
    page?: { items?: unknown; nextCursor?: unknown };
    totalCount?: unknown;
  };
  if (
    !snapshot.page ||
    !Array.isArray(snapshot.page.items) ||
    snapshot.page.nextCursor !== null ||
    !Number.isInteger(snapshot.totalCount) ||
    (snapshot.totalCount as number) < 0 ||
    snapshot.totalCount !== snapshot.page.items.length
  ) {
    throw new Error("학생 목록이 일부이거나 개수가 모호하여 정리하지 않습니다.");
  }
  const items = snapshot.page.items.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("학생 목록 항목 형식이 올바르지 않습니다.");
    }
    const candidate = item as { displayName?: unknown; id?: unknown };
    if (
      typeof candidate.displayName !== "string" ||
      typeof candidate.id !== "string" ||
      !uuidPattern.test(candidate.id)
    ) {
      throw new Error("학생 목록 항목의 이름 또는 ID 형식이 올바르지 않습니다.");
    }
    return { displayName: candidate.displayName, id: candidate.id };
  });
  return {
    page: { items, nextCursor: null },
    totalCount: snapshot.totalCount as number,
  };
}

export function resolvePreviewCleanupCandidate(
  student: PreviewCleanupStudent,
  rawSnapshot: unknown,
): CleanupResolution {
  assertCleanupStudent(student);
  const snapshot = parseDirectorySnapshot(rawSnapshot);
  if (snapshot.totalCount === 0) return { kind: "absent" };
  if (
    snapshot.totalCount !== 1 ||
    snapshot.page.items[0]?.displayName !== student.displayName
  ) {
    throw new Error("정확한 가짜 학생 이름 한 건으로 대상을 확정하지 못했습니다.");
  }
  const candidate = snapshot.page.items[0];
  if (!candidate) {
    throw new Error("정리할 가짜 학생을 찾지 못했습니다.");
  }
  if (student.id && candidate.id.toLowerCase() !== student.id.toLowerCase()) {
    throw new Error("가짜 학생 이름은 같지만 기록 ID가 달라 삭제하지 않습니다.");
  }
  return {
    id: candidate.id,
    kind: "delete",
    recovered: student.id === null,
  };
}

export async function cleanupPreviewStudent(
  api: APIRequestContext,
  student: PreviewCleanupStudent,
  persist: () => Promise<void>,
  options: { missingIdAttempts?: number; missingIdDelayMs?: number } = {},
) {
  assertCleanupStudent(student);
  const missingIdAttempts = options.missingIdAttempts ?? 8;
  const missingIdDelayMs = options.missingIdDelayMs ?? 1_000;
  if (
    !Number.isInteger(missingIdAttempts) ||
    missingIdAttempts < 1 ||
    missingIdAttempts > 30 ||
    !Number.isInteger(missingIdDelayMs) ||
    missingIdDelayMs < 0 ||
    missingIdDelayMs > 5_000
  ) {
    throw new Error("가짜 학생 정리 재확인 설정이 올바르지 않습니다.");
  }

  let resolution: CleanupResolution = { kind: "absent" };
  for (let attempt = 1; attempt <= missingIdAttempts; attempt += 1) {
    const directory = await api.post("/api/admin/students/directory", {
      data: {
        filters: {
          classGroupId: "",
          grade: "",
          query: student.displayName,
          school: "",
          status: "all",
          wordbook: "",
          wrong: "all",
        },
        mode: "initial",
      },
    });
    if (directory.status() !== 200) {
      throw new Error(`학생 목록 대조 실패: HTTP ${directory.status()}`);
    }
    const payload = (await directory.json()) as { snapshot?: unknown };
    resolution = resolvePreviewCleanupCandidate(student, payload.snapshot);
    if (resolution.kind === "delete" || student.id !== null) break;
    if (attempt < missingIdAttempts) {
      await new Promise((resolve) => setTimeout(resolve, missingIdDelayMs));
    }
  }
  if (resolution.kind === "absent") {
    if (student.id === null) {
      throw new Error(
        "ID 없는 생성 의도가 목록에서 확인되지 않아 삭제 완료로 확정하지 않습니다.",
      );
    }
    student.cleanup = "deleted";
    await persist();
    return;
  }
  if (resolution.recovered) {
    student.id = resolution.id;
    student.cleanup = "pending";
    await persist();
  }
  const deletion = await api.delete(
    `/api/admin/students/${encodeURIComponent(resolution.id)}`,
  );
  if (deletion.status() !== 200 && deletion.status() !== 404) {
    throw new Error(`가짜 학생 정리 실패: HTTP ${deletion.status()}`);
  }
  student.cleanup = "deleted";
  await persist();
}
