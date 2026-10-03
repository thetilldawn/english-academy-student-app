import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect } from "../fixtures/preview-run";
import { openSingleAssignment } from "../support/vocab-journey";
import { MAINTENANCE_PREVIEW_ORIGIN } from "../support/environment";
import type { TemplateMetadata } from "../../../src/features/wordbook-compositions/contracts/library";
import type { LibraryPreview } from "../../../src/features/wordbook-compositions/contracts/library-query";
import type { ClassifiedLibraryDetail, ClassifiedTemplateSummary, TemplateKind } from "../../../src/features/wordbook-compositions/contracts/library-v3";

const endpoint = "/api/admin/wordbook-library";
test.describe("@authenticated 유지보수 종류별 템플릿 실제 저장", () => {
  test.skip(process.env.E2E_MAINTENANCE_ROLLBACK !== "1", "유지보수 전용 실행만 허용합니다.");
  test("네 종류와 구형 미분류를 저장·재조회하고 가짜 초안을 종료한다", async ({ previewRun }) => {
    test.setTimeout(240_000);
    expect(previewRun.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
    const page = previewRun.adminPage;
    const fakeStudent = await previewRun.createStudent("m10-template-view");
    const prefix = `[M10 가짜] ${randomUUID().slice(0, 8)}`;
    const tracked = new Map<string, { title: string; revision: number; deleted: boolean }>();
    const pendingCreates = new Map<string, { viewerId: string; data: Record<string, unknown> }>();
    const evidence: unknown[] = [];
    const forbidden: string[] = [];
    page.on("request", request => {
      if (request.method() !== "POST") return;
      const pathname = new URL(request.url()).pathname;
      if (["/api/admin/assignments", "/api/admin/bulk-assignments", "/api/admin/exact-review-assignments", "/api/admin/mixed-assignments", "/api/admin/notebook-assignments"].includes(pathname)) forbidden.push(pathname);
      if (pathname === endpoint + "/commands") {
        const data = request.postDataJSON();
        if (data?.action === "materialize") forbidden.push("materialize");
        if (data?.action === "create" && data.metadata?.title?.startsWith(prefix + " ")) {
          journalCreate(data, request.headers()["x-wordbook-viewer"] ?? "");
        }
      }
    });
    const saveEvidence = () => {
      const directory = path.join(process.cwd(), "test-results", "maintenance-preview");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "종류별_템플릿.json"), JSON.stringify({ fakeStudentId: fakeStudent.id, templates: [...tracked.entries()], pendingCreates: [...pendingCreates.entries()], evidence, forbidden }, null, 2) + "\n");
    };
    page.on("response", response => {
      const request = response.request();
      if (new URL(response.url()).pathname !== endpoint + "/query" || request.method() !== "POST") return;
      const data = request.postDataJSON();
      if (data?.kind !== "templates") return;
      evidence.push({ case: "ui-template-query", search: data.search, templateKind: data.templateKind,
        status: response.status(), timing: request.timing() });
      saveEvidence();
    });
    function journalCreate(data: Record<string, unknown>, viewerId: string) {
      expect(typeof data.requestId).toBe("string");
      expect(viewerId).not.toBe("");
      pendingCreates.set(data.requestId as string, { data, viewerId });
      saveEvidence();
    }
    async function query<T>(data: unknown): Promise<T> {
      const response = await page.request.post(endpoint + "/query", { headers: { "X-Wordbook-Contract": "3" }, data });
      expect(response.status()).toBe(200);
      return await response.json() as T;
    }
    const list = (search: string, templateKind: string) => query<{ viewerId: string; items: ClassifiedTemplateSummary[] }>({ kind: "templates", search, templateKind, cursor: null, limit: 20 });
    const detail = (templateId: string) => query<ClassifiedLibraryDetail>({ kind: "detail", templateId });
    async function remember(template: ClassifiedTemplateSummary, requestId?: string) {
      expect(template.metadata.title.startsWith(prefix + " ")).toBe(true);
      tracked.set(template.id, { title: template.metadata.title, revision: template.revision, deleted: false });
      if (requestId) pendingCreates.delete(requestId);
      saveEvidence();
    }
    async function openLibrary() {
      await openSingleAssignment(page, fakeStudent);
      await page.locator('button[data-field-key="dataset"]').click();
      await page.getByRole("button", { name: "템플릿 찾기·범위로 새로 만들기", exact: true }).click();
      return page.getByRole("dialog", { name: "단어장과 템플릿", exact: true });
    }
    async function findCard(dialog: Locator, title: string, kind: string) {
      await dialog.getByRole("button", { name: "저장한 템플릿 찾기", exact: true }).click();
      await dialog.getByLabel("저장한 구성의 종류", { exact: true }).selectOption(kind);
      await dialog.getByRole("textbox", { name: "템플릿 검색", exact: true }).fill(title);
      const card = dialog.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      await expect(card).toHaveCount(1, { timeout: 20_000 });
      return card;
    }
    async function saveFromUi(dialog: Locator, action: "create" | "metadata", kind: TemplateKind | null) {
      const button = dialog.getByRole("button", { name: "템플릿 저장", exact: true });
      await expect(button).toBeEnabled();
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === endpoint + "/commands" && r.request().method() === "POST");
      await button.click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toMatchObject({ action, protocolVersion: 3, templateKind: kind });
      const result = await response.json() as { template: ClassifiedTemplateSummary; createdBook?: unknown };
      await remember(result.template, response.request().postDataJSON().requestId);
      expect(result.createdBook).toBeUndefined();
      expect(result.template.latestVersion.datasetId).toBeNull();
      await expect(dialog.getByText("템플릿을 저장했습니다.", { exact: true })).toBeVisible();
      return result.template;
    }
    try {
      let dialog = await openLibrary();
      await dialog.getByRole("button", { name: "범위로 새로 만들기", exact: true }).click();
      await dialog.getByRole("tab", { name: "수행평가", exact: true }).click();
      await dialog.getByRole("checkbox", { name: "범위를 나중에 정할 예정입니다", exact: true }).check();
      await dialog.getByRole("textbox", { name: "종류 설명 (선택)", exact: true }).fill("종류와 별도로 유지할 검토 설명");
      await dialog.getByRole("textbox", { name: "학교", exact: true }).fill("검토용 가상고");
      await dialog.getByRole("textbox", { name: "평가명", exact: true }).fill("가짜 말하기 평가");
      const title = prefix + " 종류";
      await dialog.getByRole("textbox", { name: "템플릿 이름", exact: true }).fill(title);
      let template = await saveFromUi(dialog, "create", "performance_assessment");
      const version = template.latestVersion;
      const metadata = template.metadata;
      const revisions: number[] = [template.revision];
      for (const [kind, label] of [["exam_prep", "직전대비"], ["mock_exam", "모의고사"], ["other", "기타"], ["performance_assessment", "수행평가"]] as const) {
        const card = await findCard(dialog, title, "all");
        await expect(card.getByRole("button", { name: "이 범위로 단어장 만들기", exact: true })).toBeDisabled();
        await card.getByRole("button", { name: "이름·종류·대상 수정", exact: true }).click();
        await expect(dialog.getByRole("textbox", { name: "템플릿 이름", exact: true })).toHaveValue(title);
        await dialog.getByRole("tab", { name: label, exact: true }).click();
        if (kind === "mock_exam" || kind === "other") await expect(dialog.getByRole("textbox", { name: "학교", exact: true })).toHaveCount(0);
        else await expect(dialog.getByRole("textbox", { name: kind === "exam_prep" ? "시험" : "평가명", exact: true })).toHaveValue("가짜 말하기 평가");
        const previous = template;
        template = await saveFromUi(dialog, "metadata", kind);
        expect(template.id).toBe(previous.id);
        expect(template.revision).toBe(previous.revision + 1);
        expect(template.metadata).toEqual(metadata);
        expect(template.latestVersion).toEqual(version);
        expect((await list(title, kind)).items.map(item => item.id)).toEqual([template.id]);
        revisions.push(template.revision);
      }
      evidence.push({ case: "kinds", id: template.id, kinds: ["performance_assessment", "exam_prep", "mock_exam", "other", "performance_assessment"], revisions, unchangedVersion: version.id, unchangedContentHash: version.contentHash });

      const legacyMetadata: TemplateMetadata = { title: prefix + " 미분류", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: "구형 분류를 추측하지 않는 검토" };
      const preview = await query<LibraryPreview>({ kind: "preview", selection: { mode: "criteria", criteria: { groups: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" } }, compareVersionId: null, metadata: legacyMetadata });
      const legacyCreate = { action: "create", requestId: randomUUID(), metadata: legacyMetadata, criteria: null, recipe: preview.recipe, previewHash: preview.contentHash };
      journalCreate(legacyCreate, preview.viewerId);
      const created = await page.request.post(endpoint + "/commands", { headers: { "X-Wordbook-Viewer": preview.viewerId }, data: legacyCreate });
      expect(created.status()).toBe(200);
      const legacy = (await created.json()).template as ClassifiedTemplateSummary;
      await remember(legacy, legacyCreate.requestId);
      const legacyDetail = await detail(legacy.id);
      expect(legacyDetail.template.templateKind).toBeNull();
      await page.goto("/admin/assignments");
      dialog = await openLibrary();
      const legacyCard = await findCard(dialog, legacyMetadata.title, "unclassified");
      await legacyCard.getByRole("button", { name: "이름·종류·대상 수정", exact: true }).click();
      const renamed = legacyMetadata.title + " 이름수정";
      await dialog.getByRole("textbox", { name: "템플릿 이름", exact: true }).fill(renamed);
      const savedLegacy = await saveFromUi(dialog, "metadata", null);
      expect(savedLegacy.metadata).toEqual({ ...legacyMetadata, title: renamed });
      expect(savedLegacy.latestVersion).toEqual(legacyDetail.version);
      expect((await list(renamed, "unclassified")).items.map(item => item.id)).toEqual([legacy.id]);
      expect((await list(renamed, "other")).items).toEqual([]);
      evidence.push({ case: "unclassified", id: legacy.id, versionId: legacyDetail.version.id, contentHash: legacyDetail.version.contentHash, templateKind: savedLegacy.templateKind });

      for (const [id, saved] of tracked) {
        const card = await findCard(dialog, saved.title, "all");
        await card.getByRole("button", { name: "템플릿 삭제", exact: true }).click();
        const confirmation = page.getByRole("alertdialog", { name: "템플릿을 삭제할까요?", exact: true });
        const deletion = page.waitForResponse(r => new URL(r.url()).pathname === endpoint + "/commands" && r.request().postDataJSON()?.action === "delete");
        await confirmation.getByRole("button", { name: "이 템플릿 삭제", exact: true }).click();
        const response = await deletion;
        expect(response.status()).toBe(200);
        expect((await response.json()).deleted).toEqual({ templateId: id, revision: saved.revision + 1 });
        saved.deleted = true; saveEvidence();
        expect((await list(saved.title, "all")).items).toEqual([]);
      }
      expect(forbidden).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("가짜템플릿_정리.png") });
    } finally {
      // Recover uncertain creates by the original idempotency key, never by a title search.
      const cleanupErrors: string[] = [];
      try {
        await previewRun.verifyCurrentDeployment();
        for (const [requestId, pending] of pendingCreates) {
          try {
            const recovered = await page.request.post(endpoint + "/commands", { headers: { "X-Wordbook-Viewer": pending.viewerId }, data: pending.data });
            expect(recovered.status()).toBe(200);
            await remember((await recovered.json()).template, requestId);
          } catch (error) {
            cleanupErrors.push(`create ${requestId}: ${String(error)}`);
          }
        }
        for (const [id, saved] of tracked) {
          if (saved.deleted) continue;
          try {
            const currentResponse = await page.request.post(endpoint + "/query", { headers: { "X-Wordbook-Contract": "3" }, data: { kind: "detail", templateId: id } });
            if (currentResponse.status() === 404) { saved.deleted = true; continue; }
            expect(currentResponse.status()).toBe(200);
            const current = await currentResponse.json() as ClassifiedLibraryDetail;
            expect(current.template.metadata.title.startsWith(prefix + " ")).toBe(true);
            const response = await page.request.post(endpoint + "/commands", { headers: { "X-Wordbook-Viewer": current.viewerId }, data: { action: "delete", requestId: randomUUID(), templateId: id, expectedRevision: current.template.revision } });
            expect(response.status()).toBe(200);
            expect((await response.json()).deleted.templateId).toBe(id);
            saved.deleted = true;
          } catch (error) {
            cleanupErrors.push(`delete ${id}: ${String(error)}`);
          }
        }
      } finally {
        evidence.push({ case: "cleanup", errors: cleanupErrors });
        saveEvidence();
      }
      expect(cleanupErrors).toEqual([]);
    }
  });
});
