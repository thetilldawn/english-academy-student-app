import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { writeJsonSnapshot } from "../../test/e2e/support/atomic-json";
import { assertMaintenanceRunnerSource } from "../../test/e2e/support/runner-source.mjs";
import {
  assertPreviewMutationEnvironment,
  assertPreviewRuntimeIdentity,
  assertReadOnlyE2EEnvironment,
  establishVercelProtectionSession,
  MAINTENANCE_PREVIEW_ORIGIN,
} from "../../test/e2e/support/environment";
import {
  cleanupPreviewStudent,
  resolvePreviewCleanupCandidate,
  type PreviewCleanupStudent,
} from "../../test/e2e/support/preview-student-cleanup";

const previewOrigin =
  "https://english-academy-student-example1-thetilldawn-3859s-projects.vercel.app";

describe("유지보수 검사 도구와 배포 코드 구분", () => {
  const environment = { E2E_MAINTENANCE_ROLLBACK: "1", E2E_ALLOW_RUNNER_TOOLS_ONLY: "1",
    PLAYWRIGHT_BASE_URL: MAINTENANCE_PREVIEW_ORIGIN, E2E_EXPECTED_GIT_REF: "codex/vocabulary-templates-20260920" };
  it("커밋된 검사만 다르고 제품이 같으면 두 SHA를 따로 기록할 수 있다", () => {
    expect(() => assertMaintenanceRunnerSource({ environment, changed: ["test/e2e/support/vocab-journey.ts"], dirty: ["00_앱_인계서.md"] })).not.toThrow();
  });
  it.each(["src/app/page.tsx", "supabase/migrations/change.sql", "package.json", "next.config.ts", "public/quiz-offline-sw.js"])("제품·빌드 변경은 거절한다: %s", file => {
    expect(() => assertMaintenanceRunnerSource({ environment, changed: [file], dirty: [] })).toThrow();
  });
  it("미커밋 검사 코드도 거절한다", () => {
    expect(() => assertMaintenanceRunnerSource({ environment, changed: ["test/e2e/support/vocab-journey.ts"], dirty: ["test/e2e/support/vocab-journey.ts"] })).toThrow();
  });
  it("일반 검사나 다른 주소에는 예외를 허용하지 않는다", () => {
    for (const replacement of [{ E2E_MAINTENANCE_ROLLBACK: "0" }, { PLAYWRIGHT_BASE_URL: previewOrigin }])
      expect(() => assertMaintenanceRunnerSource({ environment: { ...environment, ...replacement }, changed: ["test/e2e/support/vocab-journey.ts"], dirty: [] })).toThrow();
  });
});

describe("Preview E2E 실행 경계", () => {
  it("명세의 고정 주소 한 개만 허용하고 비슷한 다른 별칭은 거절한다", () => {
    expect(assertReadOnlyE2EEnvironment({ PLAYWRIGHT_BASE_URL: MAINTENANCE_PREVIEW_ORIGIN }).target).toBe("preview");
    expect(() => assertReadOnlyE2EEnvironment({ PLAYWRIGHT_BASE_URL: MAINTENANCE_PREVIEW_ORIGIN.replace("d9206d", "another") })).toThrow(/Preview 주소/);
  });

  it("고정 주소 쓰기는 승인 브랜치와 실제 개별 배포 주소가 추가로 필요하다", () => {
    const input = {
      PLAYWRIGHT_BASE_URL: MAINTENANCE_PREVIEW_ORIGIN,
      E2E_EXPECTED_PREVIEW_ORIGIN: MAINTENANCE_PREVIEW_ORIGIN,
      E2E_EXPECTED_DEPLOYMENT_ORIGIN: previewOrigin,
      E2E_EXPECTED_GIT_REF: "codex/vocabulary-templates-20260920",
      E2E_EXPECTED_SUPABASE_PROJECT_REF: "wojxpruvbjzbhrpmsbuy",
      E2E_ALLOW_PREVIEW_MUTATION: "1",
      E2E_TARGET_DEPLOYMENT_SHA: "2".repeat(40),
      E2E_CHECK_RUNNER_SHA: "1".repeat(40),
      PREVIEW_E2E_ADMIN_EMAIL: "preview-admin@example.com",
      PREVIEW_E2E_ADMIN_PASSWORD: "fake-only",
    };
    expect(assertPreviewMutationEnvironment(input).deploymentOrigin).toBe(previewOrigin);
    expect(() => assertPreviewMutationEnvironment({ ...input, E2E_EXPECTED_DEPLOYMENT_ORIGIN: undefined })).toThrow(/개별 Preview/);
    expect(() => assertPreviewMutationEnvironment({ ...input, E2E_EXPECTED_GIT_REF: "codex/other" })).toThrow(/승인 브랜치/);
    expect(() => assertPreviewMutationEnvironment({ ...input, E2E_EXPECTED_DEPLOYMENT_ORIGIN: "https://english-academy-student-app.vercel.app" })).toThrow(/개별 Preview/);
  });

  it("같은 주소와 SHA라도 승인한 배포와 다르면 교체/정리 검사를 거절한다", () => {
    const expected = {
      origin: MAINTENANCE_PREVIEW_ORIGIN,
      deploymentOrigin: previewOrigin,
      gitRef: "codex/vocabulary-templates-20260920",
      projectRef: "wojxpruvbjzbhrpmsbuy",
      targetDeploymentSha: "2".repeat(40),
    };
    const identity = { deploymentHost: new URL(previewOrigin).hostname,
      gitCommitRef: expected.gitRef, gitCommitSha: expected.targetDeploymentSha,
      supabaseProjectRef: expected.projectRef, vercelEnvironment: "preview" };
    expect(assertPreviewRuntimeIdentity(identity, expected).deploymentHost).toBe(identity.deploymentHost);
    expect(() => assertPreviewRuntimeIdentity(identity, { ...expected, deploymentOrigin: previewOrigin.replace("example1", "example2") })).toThrow(/실제 Preview 환경/);
    expect(() => assertPreviewRuntimeIdentity(identity, { ...expected, targetDeploymentSha: "3".repeat(40) })).toThrow(/실제 Preview 환경/);
    expect(() => assertPreviewRuntimeIdentity({ ...identity, vercelEnvironment: "production" }, expected)).toThrow(/실제 Preview 환경/);
  });

  it("로컬 읽기 검사와 승인된 Preview 읽기 검사만 허용한다", () => {
    expect(assertReadOnlyE2EEnvironment({}).target).toBe("local");
    expect(
      assertReadOnlyE2EEnvironment({ PLAYWRIGHT_BASE_URL: previewOrigin }).target,
    ).toBe("preview");
  });

  it("Production 주소와 임의 Vercel 주소를 거부한다", () => {
    expect(() =>
      assertReadOnlyE2EEnvironment({
        PLAYWRIGHT_BASE_URL:
          "https://english-academy-student-app.vercel.app",
      }),
    ).toThrow(/Preview 주소/);
    expect(() =>
      assertReadOnlyE2EEnvironment({
        PLAYWRIGHT_BASE_URL: "https://unrelated.vercel.app",
      }),
    ).toThrow(/Preview 주소/);
  });

  it("쓰기 검사는 주소·DB·명시적 승인이 모두 일치해야 한다", () => {
    const approved = {
      E2E_ALLOW_PREVIEW_MUTATION: "1",
      E2E_CHECK_RUNNER_SHA: "1111111111111111111111111111111111111111",
      E2E_EXPECTED_GIT_REF: "codex/approved-preview-e2e",
      E2E_EXPECTED_PREVIEW_ORIGIN: previewOrigin,
      E2E_EXPECTED_SUPABASE_PROJECT_REF: "wojxpruvbjzbhrpmsbuy",
      E2E_TARGET_DEPLOYMENT_SHA: "2222222222222222222222222222222222222222",
      PLAYWRIGHT_BASE_URL: previewOrigin,
      PREVIEW_E2E_ADMIN_EMAIL: "preview-admin@example.com",
      PREVIEW_E2E_ADMIN_PASSWORD: "secret-password",
    };
    expect(assertPreviewMutationEnvironment(approved).projectRef).toBe(
      "wojxpruvbjzbhrpmsbuy",
    );
    expect(() =>
      assertPreviewMutationEnvironment({
        ...approved,
        E2E_EXPECTED_SUPABASE_PROJECT_REF: "xdxhswjgksukjmpbzqgz",
      }),
    ).toThrow(/Preview DB/);
    expect(() =>
      assertPreviewMutationEnvironment({
        ...approved,
        E2E_ALLOW_PREVIEW_MUTATION: "0",
      }),
    ).toThrow(/승인/);
  });

  it("원격 배포가 보고한 실제 환경·DB·호스트까지 모두 대조한다", () => {
    expect(
      assertPreviewRuntimeIdentity(
        {
          deploymentHost: new URL(previewOrigin).hostname,
          gitCommitRef: "codex/approved-preview-e2e",
          gitCommitSha: "2222222222222222222222222222222222222222",
          supabaseProjectRef: "wojxpruvbjzbhrpmsbuy",
          vercelEnvironment: "preview",
        },
        {
          gitRef: "codex/approved-preview-e2e",
          origin: previewOrigin,
          projectRef: "wojxpruvbjzbhrpmsbuy",
          targetDeploymentSha: "2222222222222222222222222222222222222222",
        },
      ).vercelEnvironment,
    ).toBe("preview");
    expect(() =>
      assertPreviewRuntimeIdentity(
        {
          deploymentHost: new URL(previewOrigin).hostname,
          gitCommitRef: "codex/approved-preview-e2e",
          gitCommitSha: "2222222222222222222222222222222222222222",
          supabaseProjectRef: "xdxhswjgksukjmpbzqgz",
          vercelEnvironment: "production",
        },
        {
          gitRef: "codex/approved-preview-e2e",
          origin: previewOrigin,
          projectRef: "wojxpruvbjzbhrpmsbuy",
          targetDeploymentSha: "2222222222222222222222222222222222222222",
        },
      ),
    ).toThrow(/실제 Preview 환경/);
  });

  it("Vercel 보호 우회 비밀은 승인된 origin의 쿠키 생성 요청 한 번에만 쓴다", async () => {
    const get = vi.fn().mockResolvedValue({ status: () => 200 });
    const context = { request: { get } } as unknown as BrowserContext;
    await establishVercelProtectionSession(context, {
      PLAYWRIGHT_BASE_URL: previewOrigin,
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(previewOrigin, {
      headers: {
        "x-vercel-protection-bypass": "bypass-secret",
        "x-vercel-set-bypass-cookie": "true",
        "x-vercel-skip-toolbar": "1",
      },
      maxRedirects: 0,
    });
  });

  it("가짜 학생 생성 실패 로그에 응답 본문이나 접속코드를 포함하지 않는다", async () => {
    const fixtureSource = await readFile(
      path.join(process.cwd(), "test/e2e/fixtures/preview-run.ts"),
      "utf8",
    );
    expect(fixtureSource).not.toContain("expect(response.status(), responseText)");
    expect(fixtureSource).not.toContain("expect(payload.code).toMatch");
    expect(fixtureSource).not.toMatch(/throw new Error\([^\n]*response\.text/);
  });

  it("가짜 학생 생성 요청 전부터 복구 가능한 의도를 기록한다", async () => {
    const fixtureSource = await readFile(
      path.join(process.cwd(), "test/e2e/fixtures/preview-run.ts"),
      "utf8",
    );
    const intent = fixtureSource.indexOf('cleanup: "intended"');
    const manifest = fixtureSource.indexOf("await this.writeManifest()", intent);
    const creation = fixtureSource.indexOf(
      'request.post("/api/admin/students"',
      intent,
    );
    expect(intent).toBeGreaterThan(-1);
    expect(manifest).toBeGreaterThan(intent);
    expect(creation).toBeGreaterThan(manifest);
  });

  it("정리 대상은 정확한 이름 한 건과 기록 ID가 모두 맞아야 한다", () => {
    const student: PreviewCleanupStudent = {
      cleanup: "pending",
      displayName: "[E2E] cleanup e2e-run-123456 abc123",
      id: "11111111-1111-4111-8111-111111111111",
    };
    const page = {
      page: {
        items: [{ displayName: student.displayName, id: student.id }],
        nextCursor: null,
      },
      totalCount: 1,
    };
    expect(resolvePreviewCleanupCandidate(student, page)).toEqual({
      id: student.id,
      kind: "delete",
      recovered: false,
    });
    expect(() =>
      resolvePreviewCleanupCandidate(student, {
        ...page,
        page: {
          items: [
            {
              displayName: student.displayName,
              id: "22222222-2222-4222-8222-222222222222",
            },
          ],
          nextCursor: null,
        },
      }),
    ).toThrow(/ID/);
  });

  it("생성 응답 전에 중단돼도 유일한 정확한 이름을 ID로 저장한 뒤 삭제한다", async () => {
    const student: PreviewCleanupStudent = {
      cleanup: "intended",
      displayName: "[E2E] recovery e2e-run-123456 def456",
      id: null,
    };
    const recoveredId = "33333333-3333-4333-8333-333333333333";
    const order: string[] = [];
    const api = {
      delete: vi.fn(async () => {
        order.push("delete");
        return { status: () => 200 };
      }),
      post: vi.fn(async () => ({
        json: async () => ({
          snapshot: {
            page: {
              items: [{ displayName: student.displayName, id: recoveredId }],
              nextCursor: null,
            },
            totalCount: 1,
          },
        }),
        status: () => 200,
      })),
    };
    await cleanupPreviewStudent(
      api as never,
      student,
      async () => {
        order.push(`persist:${student.id ?? "none"}:${student.cleanup}`);
      },
    );
    expect(order).toEqual([
      `persist:${recoveredId}:pending`,
      "delete",
      `persist:${recoveredId}:deleted`,
    ]);
  });

  it("ID 없는 생성 의도가 아직 안 보이면 재확인 뒤에도 삭제 완료로 오인하지 않는다", async () => {
    const student: PreviewCleanupStudent = {
      cleanup: "intended",
      displayName: "[E2E] delayed e2e-run-123456 fedcba",
      id: null,
    };
    const persist = vi.fn(async () => undefined);
    const api = {
      delete: vi.fn(),
      post: vi.fn(async () => ({
        json: async () => ({
          snapshot: {
            page: { items: [], nextCursor: null },
            totalCount: 0,
          },
        }),
        status: () => 200,
      })),
    };
    await expect(
      cleanupPreviewStudent(api as never, student, persist, {
        missingIdAttempts: 2,
        missingIdDelayMs: 0,
      }),
    ).rejects.toThrow(/삭제 완료로 확정하지 않습니다/);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.delete).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(student.cleanup).toBe("intended");
  });

  it("Preview 비밀을 쓰는 workflow는 신뢰된 main 이벤트 SHA로만 실행한다", async () => {
    const [fullWorkflow, smokeWorkflow] = await Promise.all([
      readFile(
        path.join(process.cwd(), ".github/workflows/preview-full-e2e.yml"),
        "utf8",
      ),
      readFile(
        path.join(process.cwd(), ".github/workflows/preview-smoke.yml"),
        "utf8",
      ),
    ]);
    for (const workflow of [fullWorkflow, smokeWorkflow]) {
      expect(workflow).toContain("github.ref == 'refs/heads/main'");
      expect(workflow).toContain("ref: ${{ github.sha }}");
      expect(workflow).not.toContain("ref: main");
    }
    expect(fullWorkflow).not.toContain("compareCommitsWithBasehead");
    expect(fullWorkflow.match(/branch\.commit\.sha\.toLowerCase\(\)/g)).toHaveLength(
      2,
    );
    expect(fullWorkflow).toContain("완료 시점 Preview HEAD 재확인");
    expect(smokeWorkflow).toContain("PREVIEW_SMOKE_ALLOWED_GIT_REF");
    expect(smokeWorkflow).toContain("branch.protected !== true");
    expect(smokeWorkflow.match(/branch\.commit\.sha\.toLowerCase\(\)/g)).toHaveLength(
      2,
    );
    expect(smokeWorkflow).toContain("완료 시점 Preview smoke HEAD 재확인");
  });

  it("PR 검사 범위에는 관리자 proxy와 Vercel 설정이 포함된다", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github/workflows/pr-fast.yml"),
      "utf8",
    );
    expect(workflow).toContain("proxy\\.ts$");
    expect(workflow).toContain("vercel\\.json$");
  });

  it("로컬 smoke는 기존 포트의 서버를 검사 대상으로 재사용하지 않는다", async () => {
    const runner = await readFile(
      path.join(process.cwd(), "scripts/run-playwright-suite.mjs"),
      "utf8",
    );
    expect(runner).toContain("assertLocalPortAvailable(localHost, localPort)");
    expect(runner).toContain('error.code === "EADDRINUSE"');
    expect(runner).toContain("waitForServer(localOrigin, localServer)");
    expect(runner).toContain('includes("Ready in")');
    expect(runner).toContain('["ignore", "pipe", "pipe"]');
  });

  it("실패 E2E는 오류 표시와 함께 배정 저장 요청 0건을 확인한다", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "test/e2e/authenticated/vocab-assignment.spec.ts",
      ),
      "utf8",
    );
    expect(source).toContain("trackAdminAssignmentMutations");
    expect(source.match(/mutations\.assertNone\(\)/g)).toHaveLength(3);
    expect(source).toContain('"/api/admin/bulk-assignments"');
    expect(source).toContain('"/api/admin/exact-review-assignments"');
    expect(source).toContain('route.abort("blockedbyclient")');
    expect(source).toContain("setTimeout(resolve, 750)");
  });

  it("키보드 검사는 초점 이동뿐 아니라 실제 표시선도 확인한다", async () => {
    const source = await readFile(
      path.join(process.cwd(), "test/e2e/support/page-quality.ts"),
      "utf8",
    );
    expect(source).toContain("outlineStyle");
    expect(source).toContain("outlineWidth");
    expect(source).toContain("boxShadow");
    expect(source).toContain("blurredStyle");
    expect(source).toContain("indicator.hasOutline || indicator.hasBoxShadow");
  });

  it("정리 manifest를 동시에 저장해도 완전한 스냅샷을 각각 남긴다", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "preview-e2e-json-"));
    try {
      await Promise.all([
        writeJsonSnapshot(directory, "manifest", { version: 1 }),
        writeJsonSnapshot(directory, "manifest", { version: 2 }),
      ]);
      const snapshots = (await readdir(directory)).filter((fileName) =>
        fileName.endsWith(".json"),
      );
      expect(snapshots).toHaveLength(2);
      const versions = await Promise.all(
        snapshots.map(async (fileName) => {
          const result = JSON.parse(
            await readFile(path.join(directory, fileName), "utf8"),
          ) as { version: number };
          return result.version;
        }),
      );
      expect(versions.sort()).toEqual([1, 2]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
