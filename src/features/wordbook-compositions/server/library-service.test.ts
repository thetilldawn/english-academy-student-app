import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), finalize: vi.fn(), plan: vi.fn(), requireAdmin: vi.fn(), getAdminContext: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin, getAdminContext: mocks.getAdminContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.finalize }) }));
vi.mock("./use-cases/composition-question-plan", () => ({ planCompositionQuestions: mocks.plan }));
import { EMPTY_LIBRARY_FILTERS } from "../contracts/library";
import { saveLibraryTemplate } from "./commands/library-command";
import { getLibraryCatalog } from "./queries/library-catalog";
import { GET, POST } from "@/app/api/admin/wordbook-library/route";
import { libraryJsonResponse } from "./library-json-response";
import { materializeLibraryComposition } from "./commands/materialize-composition";

const request = { action: "create", requestId: "00000000-0000-4000-8000-000000000001",
  metadata: { title: "가짜 기말", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
  recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" },
};
const template = { id: "00000000-0000-4000-8000-000000000002", revision: 1, metadata: request.metadata,
  versions: [{ id: "00000000-0000-4000-8000-000000000003", number: 1, contentHash: "a".repeat(64), recipe: request.recipe,
    includedKeys: [], sourceCount: 0, sourceVersionId: null, datasetId: null, createdAt: "2026-09-20T00:00:00Z" }],
};
beforeEach(() => { vi.resetAllMocks(); mocks.requireAdmin.mockResolvedValue({ userId: "admin" }); mocks.getAdminContext.mockResolvedValue({ userId: "admin" }); });
describe("library server and API boundaries", () => {
  it("requires authentication, rejects invalid catalogs, and never converts a failure to an empty success", async () => {
    mocks.rpc.mockResolvedValue({ data: { viewerId: "00000000-0000-4000-8000-000000000099", scopes: [], templates: [] }, error: null });
    expect(await getLibraryCatalog()).toEqual({ viewerId: "00000000-0000-4000-8000-000000000099", scopes: [], templates: [] }); expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    mocks.rpc.mockResolvedValue({ data: { viewerId: "00000000-0000-4000-8000-000000000099", scopes: [], templates: [], answers: ["secret"] }, error: null });
    await expect(getLibraryCatalog()).rejects.toMatchObject({ status: 503 });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const response = await GET(); expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("sends the validated exact request once and checks returned identity/context", async () => {
    mocks.rpc.mockResolvedValue({ data: { template }, error: null });
    expect(await saveLibraryTemplate(request)).toEqual({ template });
    expect(mocks.rpc).toHaveBeenCalledWith("save_vocabulary_library_template_v1", { p_request: request });
    await expect(saveLibraryTemplate({ ...request, dictionaryApproval: true })).rejects.toMatchObject({ status: 422 });
    mocks.rpc.mockResolvedValue({ data: { template: { ...template, metadata: { ...template.metadata, title: "다른 제목" } } }, error: null });
    await expect(saveLibraryTemplate(request)).rejects.toMatchObject({ status: 503 });
  });
  it.each([["42501", 403], ["P0002", 404], ["40001", 409], ["22023", 422], ["22P02", 422], ["22003", 422], ["XX000", 503]])("maps %s to a private %s without SQL details", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "secret-source-sql" } });
    const response = await POST(new Request("http://localhost/api/admin/wordbook-library", { method: "POST", body: JSON.stringify(request) }));
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("secret-source-sql");
  });
  it("does not read or write anything for an unauthenticated request", async () => {
    mocks.getAdminContext.mockResolvedValue(null);
    for (const r of [await GET(), await POST(new Request("http://localhost", { method: "POST", body: "{}" }))]) {
      expect(r.status).toBe(401); expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("materialized book response and recovery", () => {
  const command = { action: "materialize", requestId: request.requestId, templateId: template.id, versionId: template.versions[0]!.id, contentHash: "a".repeat(64) };
  const datasetId = "00000000-0000-4000-8000-000000000004";
  const prepared = { versionId: command.versionId, datasetId, contentHash: command.contentHash, state: "preparing", entries: [{
    id: 1, unitId: "00000000-0000-4000-8000-000000000005", sourceRow: 1, headword: "sample", primaryMeaning: "가짜", sourceKind: "legacy_vocab", sourceEntryId: 10,
    eligibleDirections: ["english_to_korean"], compositionTargetKey: "b".repeat(64), resources: { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {},
      pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null },
  }] };
  const result = { template, createdBook: { versionId: command.versionId, contentHash: command.contentHash, dataset: {
    id: datasetId, title: "가짜", displayName: "가짜", edition: null, catalogGroup: "high", materialKind: "wordbook", gradeCode: "g11", publisher: null, seriesTitle: null,
    academicYear: 2026, curriculumRevision: null, editionLabel: null, isAssignable: true, catalogSortIndex: 0, schoolName: "가짜고", schoolClassification: "school", purpose: "exam_prep", semester: 2,
    isActive: true, rowCount: 4, status: "ready", questionBankKind: "vocabulary_composition_v1", availableQuestionModes: ["book_meaning_choice"],
  } } };
  beforeEach(() => {
    mocks.plan.mockReturnValue([{ vocab_entry_id: 1 }]);
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "prepare_vocabulary_template_book_v1" ? prepared : result, error: null }));
    mocks.finalize.mockResolvedValue({ data: { ...prepared, state: "ready" }, error: null });
  });
  it("uses the validated administrator request and service-only generated plan then returns actual book metadata", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(command) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_vocabulary_template_book_v1", { p_request: command });
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith("finalize_vocabulary_composition_v1", { p_version_id: command.versionId, p_content_sha256: command.contentHash, p_questions: [{ vocab_entry_id: 1 }] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("reads a previously completed request without regenerating questions", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...prepared, state: "ready" }, error: null });
    expect(await materializeLibraryComposition(command)).toEqual(result);
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("rejects untrusted browser text and mismatched preparation, finalization, or summary identities", async () => {
    await expect(materializeLibraryComposition({ ...command, headword: "forged" })).rejects.toMatchObject({ status: 422 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { ...prepared, contentHash: "f".repeat(64) }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
    expect(mocks.finalize).not.toHaveBeenCalled();
    mocks.finalize.mockResolvedValueOnce({ data: { ...prepared, state: "ready", versionId: datasetId }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
    mocks.rpc.mockResolvedValueOnce({ data: { ...prepared, state: "ready" }, error: null }).mockResolvedValueOnce({ data: { ...result, createdBook: { ...result.createdBook, contentHash: "f".repeat(64) } }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
  });
  it("reports intervening source changes as conflicts without a usable success", async () => {
    mocks.finalize.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "secret SQL" } });
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(command) }));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("secret SQL");
    expect(mocks.rpc).not.toHaveBeenCalledWith("get_vocabulary_composition_summary_v1", expect.anything());
  });
});

it("streams a multi-version Korean catalog larger than 6MB in bounded chunks and supports cancellation", async () => {
  const value = { title: "여러 연도와 저장 버전", keys: Array.from({ length: 100_000 }, (_, n) => `${n}:한글:${"a".repeat(64)}`) };
  const response = libraryJsonResponse(value), reader = response.body!.getReader();
  const decoder = new TextDecoder(); let text = "", bytes = 0;
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; expect(chunk.value.byteLength).toBeLessThanOrEqual(65_536); bytes += chunk.value.byteLength; text += decoder.decode(chunk.value, { stream: true }); }
  text += decoder.decode(); expect(bytes).toBeGreaterThan(6 * 1024 * 1024); expect(JSON.parse(text)).toEqual(value);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const cancelled = libraryJsonResponse(value).body!.getReader(); await cancelled.read(); await cancelled.cancel(); expect((await cancelled.read()).done).toBe(true);
});
