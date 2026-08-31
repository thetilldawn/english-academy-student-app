import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { writeJsonSnapshot } from "../../test/e2e/support/atomic-json";
import {
  assertPreviewMutationEnvironment,
  assertPreviewRuntimeIdentity,
  assertReadOnlyE2EEnvironment,
  establishVercelProtectionSession,
} from "../../test/e2e/support/environment";

const previewOrigin =
  "https://english-academy-student-example1-thetilldawn-3859s-projects.vercel.app";

describe("Preview E2E 실행 경계", () => {
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
