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

export type PreviewStudent = {
  code: string;
  displayName: string;
  id: string;
};

type ReceiptStudent = Omit<PreviewStudent, "code"> & {
  cleanup: "pending" | "deleted" | "failed";
};

function safeRunPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 28);
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
  private readonly browser: Browser;
  private readonly students: ReceiptStudent[] = [];
  private readonly studentContexts: BrowserContext[] = [];

  private constructor(input: {
    adminContext: BrowserContext;
    adminPage: Page;
    browser: Browser;
    checkRunnerSha: string;
    origin: string;
    runId: string;
    targetDeploymentSha: string;
    targetGitRef: string;
  }) {
    this.adminContext = input.adminContext;
    this.adminPage = input.adminPage;
    this.browser = input.browser;
    this.checkRunnerSha = input.checkRunnerSha;
    this.origin = input.origin;
    this.runId = input.runId;
    this.targetDeploymentSha = input.targetDeploymentSha;
    this.targetGitRef = input.targetGitRef;
    this.captureBrowserMessages(this.adminPage);
  }

  private captureBrowserMessages(page: Page) {
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        this.browserMessages.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      this.browserMessages.push(`pageerror: ${error.message}`);
    });
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
    const displayName = `[E2E] ${safeCase} ${this.runId}`.slice(0, 80);
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
    this.students.push({
      displayName,
      id: payload.studentId!,
      cleanup: "pending",
    });
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

  async openStudent(student: PreviewStudent) {
    const context = await this.openAnonymousContext();
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

  async openAnonymousContext() {
    const context = await this.browser.newContext({
      baseURL: this.origin,
      extraHTTPHeaders: {
        origin: this.origin,
      },
      viewport: { width: 1440, height: 1000 },
    });
    await establishVercelProtectionSession(context, process.env);
    this.studentContexts.push(context);
    return context;
  }

  async cleanup() {
    await Promise.allSettled(this.studentContexts.map((context) => context.close()));
    for (const student of [...this.students].reverse()) {
      try {
        const response = await this.adminContext.request.delete(
          `/api/admin/students/${student.id}`,
        );
        if (response.status() !== 200 && response.status() !== 404) {
          throw new Error(`가짜 학생 정리 실패: HTTP ${response.status()}`);
        }
        student.cleanup = "deleted";
      } catch {
        student.cleanup = "failed";
      }
    }
    await this.writeManifest();
    await this.writeReceipt();
    await this.adminContext.close();
    const failed = this.students.filter((student) => student.cleanup === "failed");
    if (failed.length > 0) {
      throw new Error(
        `Preview E2E 학생 ${failed.map((student) => student.id).join(", ")} 정리에 실패했습니다.`,
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
