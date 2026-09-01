import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { request } from "@playwright/test";

import { writeJsonSnapshot } from "../test/e2e/support/atomic-json";
import {
  assertPreviewMutationEnvironment,
  assertPreviewRuntimeIdentity,
  vercelProtectionHeaders,
} from "../test/e2e/support/environment";
import {
  cleanupPreviewStudent,
  type PreviewCleanupStudent,
} from "../test/e2e/support/preview-student-cleanup";

type Manifest = {
  checkRunnerSha?: string | null;
  origin: string;
  runId: string;
  students: PreviewCleanupStudent[];
  targetDeploymentSha?: string | null;
  targetGitRef?: string | null;
};

type ManifestSnapshot = {
  fileName: string;
  manifest: Manifest;
  modifiedAt: number;
};

function isMissingDirectory(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function persist(directory: string, manifest: Manifest) {
  await writeJsonSnapshot(directory, manifest.runId, manifest);
}

async function createProtectionStorageState(origin: string) {
  const protectionHeaders = vercelProtectionHeaders();
  if (Object.keys(protectionHeaders).length === 0) return undefined;

  const bootstrap = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: protectionHeaders,
  });
  try {
    const response = await bootstrap.get(origin, { maxRedirects: 0 });
    if (response.status() >= 400) {
      throw new Error(
        `Vercel Preview 보호 우회 세션 생성 실패: HTTP ${response.status()}`,
      );
    }
    return await bootstrap.storageState();
  } finally {
    await bootstrap.dispose();
  }
}

async function main() {
  const environment = assertPreviewMutationEnvironment();
  const manifestDirectory = path.join(
    process.cwd(),
    "test-results",
    "e2e-manifests",
  );
  let manifestFiles: string[];
  try {
    manifestFiles = (await readdir(manifestDirectory))
      .filter((fileName) =>
        /^e2e-[a-z0-9-]+\.[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+\.json$/.test(
          fileName,
        ),
      )
      .sort();
  } catch (error) {
    if (!isMissingDirectory(error)) throw error;
    console.log("정리할 Preview E2E manifest가 없습니다.");
    return;
  }
  if (manifestFiles.length === 0) {
    console.log("정리할 Preview E2E manifest가 없습니다.");
    return;
  }

  const failures: string[] = [];
  const latestSnapshots = new Map<string, ManifestSnapshot>();
  for (const fileName of manifestFiles) {
    const filePath = path.join(manifestDirectory, fileName);
    try {
      const manifest = JSON.parse(await readFile(filePath, "utf8")) as Manifest;
      if (
        manifest.origin !== environment.origin ||
        manifest.checkRunnerSha !== environment.checkRunnerSha ||
        manifest.targetDeploymentSha !== environment.targetDeploymentSha ||
        manifest.targetGitRef !== environment.gitRef ||
        !manifest.runId ||
        !fileName.startsWith(`${manifest.runId}.`) ||
        !Array.isArray(manifest.students)
      ) {
        throw new Error("승인되지 않은 manifest 형식");
      }
      const modifiedAt = (await stat(filePath)).mtimeMs;
      const previous = latestSnapshots.get(manifest.runId);
      if (!previous || modifiedAt >= previous.modifiedAt) {
        latestSnapshots.set(manifest.runId, { fileName, manifest, modifiedAt });
      }
    } catch (error) {
      failures.push(`${fileName}:manifest`);
      console.error(
        `${fileName} 읽기 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      );
    }
  }
  if (latestSnapshots.size === 0) {
    throw new Error("정리할 수 있는 정상 Preview E2E manifest가 없습니다.");
  }

  const storageState = await createProtectionStorageState(environment.origin);
  const api = await request.newContext({
    baseURL: environment.origin,
    extraHTTPHeaders: { origin: environment.origin },
    storageState,
  });
  try {
    const identityResponse = await api.get("/api/preview-identity");
    const identityText = await identityResponse.text();
    if (identityResponse.status() !== 200) {
      throw new Error(`Preview 실행 환경 확인 실패: HTTP ${identityResponse.status()}`);
    }
    assertPreviewRuntimeIdentity(JSON.parse(identityText), environment);

    const login = await api.post("/api/admin/session", {
      data: {
        email: environment.adminEmail,
        password: environment.adminPassword,
      },
    });
    if (login.status() !== 200) {
      throw new Error(`Preview 관리자 로그인 실패: HTTP ${login.status()}`);
    }

    for (const snapshot of latestSnapshots.values()) {
      const { fileName, manifest } = snapshot;
      try {
        for (const student of manifest.students) {
          if (student.cleanup === "deleted") continue;
          try {
            await cleanupPreviewStudent(
              api,
              student,
              () => persist(manifestDirectory, manifest),
            );
          } catch {
            student.cleanup = "failed";
            failures.push(
              `${manifest.runId}:${student.id ?? student.displayName}`,
            );
            await persist(manifestDirectory, manifest);
          }
        }

        await writeJsonSnapshot(
          path.join(process.cwd(), "test-results", "e2e-receipts"),
          `${manifest.runId}-recovery`,
          manifest,
        );
      } catch (error) {
        failures.push(`${fileName}:manifest`);
        console.error(
          `${fileName} 정리 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        );
      }
    }
  } finally {
    await api.dispose();
  }

  if (failures.length > 0) {
    throw new Error(`Preview E2E 학생 ${failures.length}건 정리에 실패했습니다.`);
  }
  console.log(`Preview E2E 실행 ${latestSnapshots.size}건 정리를 확인했습니다.`);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Preview E2E 정리에 실패했습니다.",
  );
  process.exitCode = 1;
});
