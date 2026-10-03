import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { writeJsonSnapshot } from "../support/atomic-json";
import {
  assertPreviewMutationEnvironment,
  assertPreviewRuntimeIdentity,
  establishVercelProtectionSession,
} from "../support/environment";
import {
  cleanupPreviewStudent,
  type PreviewCleanupStudent,
} from "../support/preview-student-cleanup";

export type PreviewStudent = {
  code: string;
  displayName: string;
  id: string;
};

function safeRunPart(value: string) {
  return (
    value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 28) || "case"
  );
}

export class PreviewRun {
  readonly adminContext: BrowserContext;
  readonly adminPage: Page;
  readonly checkRunnerSha: string;
  readonly origin: string;
  readonly runId: string;
  readonly targetDeploymentSha: string;
  readonly targetGitRef: string;
  readonly browserMessages: string[] = [];
  readonly browserAdvisories: string[] = [];
  private readonly browser: Browser;
  private readonly students: PreviewCleanupStudent[] = [];
  private readonly studentContexts: BrowserContext[] = [];
  private runtimeExpected: Parameters<typeof assertPreviewRuntimeIdentity>[1];
  private readonly deploymentChecks: Array<{ deploymentHost: string; gitCommitSha: string }> = [];
  readonly expectedNetworkFailures: Array<{ pathname: string; code: string }> = [];
  readonly expectedPausedStarts: Array<{ pathname: string; status: number }> = [];
  private readonly networkFaultWindows = new Set<string>();
  private readonly pausedStartPages = new Set<Page>();

  private constructor(input: {
    adminContext: BrowserContext;
    adminPage: Page;
    browser: Browser;
    checkRunnerSha: string;
    origin: string;
    runId: string;
    targetDeploymentSha: string;
    targetGitRef: string;
    deploymentOrigin: string;
    projectRef: string;
  }) {
    this.adminContext = input.adminContext;
    this.adminPage = input.adminPage;
    this.browser = input.browser;
    this.checkRunnerSha = input.checkRunnerSha;
    this.origin = input.origin;
    this.runId = input.runId;
    this.targetDeploymentSha = input.targetDeploymentSha;
    this.targetGitRef = input.targetGitRef;
    this.runtimeExpected = {
      origin: input.origin,
      deploymentOrigin: input.deploymentOrigin,
      projectRef: input.projectRef,
      gitRef: input.targetGitRef,
      targetDeploymentSha: input.targetDeploymentSha,
    };
    this.captureBrowserMessages(this.adminPage);
  }

  private captureBrowserMessages(page: Page) {
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        const preload = /^The resource (https:\/\/[^ ]+\/_next\/static\/css\/[0-9a-f]+\.css) was preloaded using link preload but not used within a few seconds from the window's load event\. Please make sure it has an appropriate `as` value and it is preloaded intentionally\.$/.exec(message.text());
        if (message.type() === "warning" && preload && new URL(preload[1]).origin === this.origin) {
          // Retain the observed Next navigation hint separately from app failures.
          this.browserAdvisories.push(message.text());
          return;
        }
        const location = message.location().url;
        let pathname = "";
        try { pathname = new URL(location).pathname; } catch { /* Non-URL console locations remain visible errors. */ }
        const code = /net::(ERR_FAILED|ERR_INTERNET_DISCONNECTED|ERR_ABORTED)/.exec(message.text())?.[1];
        if (message.type() === "error" && this.pausedStartPages.has(page) &&
          pathname === "/api/student/local-quiz" &&
          message.text() === "Failed to load resource: the server responded with a status of 503 ()") {
          this.expectedPausedStarts.push({ pathname, status: 503 });
          return;
        }
        if (code && this.networkFaultWindows.has(pathname)) {
          this.expectedNetworkFailures.push({ pathname, code });
          return;
        }
        this.browserMessages.push(`console.${message.type()} ${pathname}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      this.browserMessages.push(`pageerror: ${error.message}`);
    });
  }

  allowQuizNetworkFaults() {
    const pathname = "/api/student/local-quiz";
    this.networkFaultWindows.add(pathname);
    return () => { this.networkFaultWindows.delete(pathname); };
  }

  allowPausedQuizStarts(page: Page) {
    expect(this.studentContexts).toContain(page.context());
    this.pausedStartPages.add(page);
    return () => { this.pausedStartPages.delete(page); };
  }

  static async start(browser: Browser, workerIndex: number) {
    const environment = assertPreviewMutationEnvironment();
    const runId = [
      "e2e",
      Date.now().toString(36),
      workerIndex,
      randomBytes(3).toString("hex"),
    ].join("-");
    const adminContext = await browser.newContext({
      baseURL: environment.origin,
      extraHTTPHeaders: {
        origin: environment.origin,
      },
      viewport: { width: 1440, height: 1000 },
    });
    await establishVercelProtectionSession(adminContext, process.env);
    const adminPage = await adminContext.newPage();
    const identityResponse = await adminContext.request.get(
      "/api/preview-identity",
    );
    const identityText = await identityResponse.text();
    expect(identityResponse.status(), identityText).toBe(200);
    assertPreviewRuntimeIdentity(JSON.parse(identityText), environment);
    const run = new PreviewRun({
      adminContext,
      adminPage,
      browser,
      checkRunnerSha: environment.checkRunnerSha,
      origin: environment.origin,
      runId,
      targetDeploymentSha: environment.targetDeploymentSha,
      targetGitRef: environment.gitRef,
      deploymentOrigin: environment.deploymentOrigin,
      projectRef: environment.projectRef,
    });
    await run.loginAdmin(environment.adminEmail, environment.adminPassword);
    return run;
  }

  private async loginAdmin(email: string, password: string) {
    await this.adminPage.goto("/admin/login");
    await this.adminPage.getByRole("textbox", { name: "관리자 이메일" }).fill(email);
    await this.adminPage.getByLabel("비밀번호").fill(password);
    await Promise.all([
      this.adminPage.waitForURL(/\/admin(?:\/)?$/),
      this.adminPage
        .getByRole("button", { name: "관리자 로그인", exact: true })
        .click(),
    ]);
  }

  async createStudent(caseName: string): Promise<PreviewStudent> {
    const safeCase = safeRunPart(caseName);
    const creationNonce = randomBytes(3).toString("hex");
    const displayName = `[E2E] ${safeCase} ${this.runId} ${creationNonce}`.slice(
      0,
      80,
    );
    const receipt: PreviewCleanupStudent = {
      cleanup: "intended",
      displayName,
      id: null,
    };
    this.students.push(receipt);
    await this.writeManifest();
    const response = await this.adminContext.request.post("/api/admin/students", {
      data: {
        currentVocabDatasetId: null,
        displayName,
        gradeLabel: "고3",
        note: `preview-auth-e2e-v2:${this.runId}:${safeCase}`,
        schoolName: "미리보기고",
      },
    });
    const responseText = await response.text();
    expect(
      response.status(),
      `가짜 학생 생성 실패: HTTP ${response.status()}`,
    ).toBe(201);
    const payload = JSON.parse(responseText) as {
      code?: string;
      studentId?: string;
    };
    expect(payload.studentId).toMatch(/^[0-9a-f-]{36}$/);
    receipt.id = payload.studentId!;
    receipt.cleanup = "pending";
    await this.writeManifest();
    expect(
      /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/.test(payload.code ?? ""),
      "학생 접속코드 형식이 올바르지 않습니다.",
    ).toBe(true);
    const student = {
      code: payload.code!,
      displayName,
      id: payload.studentId!,
    };
    return student;
  }

  async openStudent(student: PreviewStudent, viewport?: { width: number; height: number }) {
    const context = await this.openAnonymousContext(viewport);
    const page = await context.newPage();
    this.captureBrowserMessages(page);
    await page.goto("/");
    await page.getByRole("textbox", { name: "학생 접속코드" }).fill(student.code);
    await Promise.all([
      page.waitForURL(/\/student(?:\/)?$/),
      page.getByRole("button", { name: "인증", exact: true }).click(),
    ]);
    await expect(
      page.getByRole("banner").getByText(student.displayName, { exact: false }),
    ).toBeVisible();
    return page;
  }

  async openAnonymousContext(viewport?: { width: number; height: number }) {
    const context = await this.browser.newContext({
      baseURL: this.origin,
      extraHTTPHeaders: {
        origin: this.origin,
      },
      viewport: viewport ?? { width: 1440, height: 1000 },
    });
    await establishVercelProtectionSession(context, process.env);
    this.studentContexts.push(context);
    return context;
  }

  async openStudentTab(existing: Page) {
    expect(this.studentContexts).toContain(existing.context());
    const page = await existing.context().newPage();
    this.captureBrowserMessages(page);
    return page;
  }

  async verifyCurrentDeployment(next?: { deploymentOrigin: string; targetDeploymentSha: string }) {
    const expected = next ? { ...this.runtimeExpected, ...next } : this.runtimeExpected;
    const response = await this.adminContext.request.get("/api/preview-identity");
    expect(response.status(), "Preview 환경 재확인 실패").toBe(200);
    const identity = assertPreviewRuntimeIdentity(await response.json(), expected);
    this.runtimeExpected = expected;
    this.deploymentChecks.push({ deploymentHost: identity.deploymentHost, gitCommitSha: identity.gitCommitSha });
    return identity;
  }

  async cleanup() {
    await Promise.allSettled(this.studentContexts.map((context) => context.close()));
    // Never delete through an alias that moved to an unapproved deployment.
    try {
      await this.verifyCurrentDeployment();
    } catch {
      await this.writeManifest();
      await this.writeReceipt();
      await this.adminContext.close();
      throw new Error("Preview 환경이 달라 정리를 중단했습니다. 가짜 학생 복구 명세를 보존했습니다.");
    }
    for (const student of [...this.students].reverse()) {
      try {
        await cleanupPreviewStudent(
          this.adminContext.request,
          student,
          () => this.writeManifest(),
        );
      } catch {
        student.cleanup = "failed";
        await this.writeManifest().catch(() => undefined);
      }
    }
    await this.writeManifest();
    await this.writeReceipt();
    await this.adminContext.close();
    const failed = this.students.filter((student) => student.cleanup === "failed");
    if (failed.length > 0) {
      throw new Error(
        `Preview E2E 학생 ${failed
          .map((student) => student.id ?? student.displayName)
          .join(", ")} 정리에 실패했습니다.`,
      );
    }
    if (this.browserMessages.length > 0) {
      throw new Error(
        `Preview E2E 브라우저 warning/error:\n${this.browserMessages.join("\n")}`,
      );
    }
  }

  private async writeReceipt() {
    await writeJsonSnapshot(
      path.join(process.cwd(), "test-results", "e2e-receipts"),
      `${this.runId}-receipt`,
      {
        checkRunnerSha: this.checkRunnerSha,
        browserAdvisories: this.browserAdvisories,
        browserErrors: this.browserMessages,
        deploymentChecks: this.deploymentChecks,
        expectedNetworkFailures: this.expectedNetworkFailures,
        expectedPausedStarts: this.expectedPausedStarts,
        origin: this.origin,
        runId: this.runId,
        students: this.students,
        targetDeploymentSha: this.targetDeploymentSha,
        targetGitRef: this.targetGitRef,
      },
    );
  }

  private async writeManifest() {
    await writeJsonSnapshot(
      path.join(process.cwd(), "test-results", "e2e-manifests"),
      this.runId,
      {
        checkRunnerSha: this.checkRunnerSha,
        deploymentChecks: this.deploymentChecks,
        origin: this.origin,
        runId: this.runId,
        students: this.students,
        targetDeploymentSha: this.targetDeploymentSha,
        targetGitRef: this.targetGitRef,
      },
    );
  }
}

type TestFixtures = Record<never, never>;

export const test = base.extend<TestFixtures, { previewRun: PreviewRun }>({
  previewRun: [
    async ({ browser }, provide, workerInfo) => {
      const run = await PreviewRun.start(browser, workerInfo.workerIndex);
      try {
        await provide(run);
      } finally {
        await run.cleanup();
      }
    },
    { scope: "worker" },
  ],
});

export { expect };
