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
import { sendLibraryCommand } from "../client/transport/library-transport";

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
  it("rejects a continuation belonging to the previous login before any database operation", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000098" });
    const response = await POST(new Request("http://localhost", { method: "POST", headers: { "X-Wordbook-Viewer": "00000000-0000-4000-8000-000000000099" }, body: JSON.stringify(request) }));
    expect(response.status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
});

describe("materialized book response and recovery", () => {
  const command = { action: "materialize" as const, requestId: request.requestId, templateId: template.id, versionId: template.versions[0]!.id, contentHash: "a".repeat(64) };
  const datasetId = "00000000-0000-4000-8000-000000000004";
  const prepared = { versionId: command.versionId, datasetId, contentHash: command.contentHash, state: "preparing", entries: [{
    id: 1, unitId: "00000000-0000-4000-8000-000000000005", sourceRow: 1, headword: "sample", primaryMeaning: "가짜", sourceKind: "legacy_vocab", sourceEntryId: 10,
    eligibleDirections: ["english_to_korean"], compositionTargetKey: "b".repeat(64),
  }] };
  const step = { versionId: command.versionId, datasetId, contentHash: command.contentHash, state: "preparing", stage: "prepared", done: 1, total: 1, needsQuestions: false };
  const completed = { ...step, state: "ready", stage: "complete" };
  const result = { template, createdBook: { versionId: command.versionId, contentHash: command.contentHash, dataset: {
    id: datasetId, title: "가짜", displayName: "가짜", edition: null, catalogGroup: "high", materialKind: "wordbook", gradeCode: "g11", publisher: null, seriesTitle: null,
    academicYear: 2026, curriculumRevision: null, editionLabel: null, isAssignable: true, catalogSortIndex: 0, schoolName: "가짜고", schoolClassification: "school", purpose: "exam_prep", semester: 2,
    isActive: true, rowCount: 4, status: "ready", questionBankKind: "vocabulary_composition_v1", availableQuestionModes: ["book_meaning_choice"],
  } } };
  beforeEach(() => {
    mocks.plan.mockReturnValue([{ vocab_entry_id: 1 }]);
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "advance_vocabulary_template_book_v1" ? step : name === "prepare_vocabulary_template_question_input_v1" ? prepared : result, error: null }));
    mocks.finalize.mockResolvedValueOnce({ data: { ...step, needsQuestions: true }, error: null }).mockResolvedValue({ data: completed, error: null });
  });
  it("uses the validated administrator request and service-only generated plan then returns actual book metadata", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(command) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_vocabulary_template_question_input_v1", { p_request: command });
    expect(mocks.rpc).toHaveBeenCalledWith("advance_vocabulary_template_book_v1", { p_request: command });
    expect(mocks.finalize).toHaveBeenLastCalledWith("advance_vocabulary_composition_questions_v1", { p_version_id: command.versionId, p_content_sha256: command.contentHash, p_questions: [{ vocab_entry_id: 1 }] });
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("reads a previously completed request without regenerating questions", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: completed, error: null });
    expect(await materializeLibraryComposition(command)).toEqual(result);
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("accepts another administrator completing the shared template between progress and preparation", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "advance_vocabulary_template_book_v1" ? step : name === "prepare_vocabulary_template_question_input_v1" ? { ...prepared, state: "ready" } : result, error: null }));
    expect(await materializeLibraryComposition(command)).toEqual(result);
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.finalize).toHaveBeenCalledOnce();
  });
  it("rejects untrusted browser text and mismatched preparation, finalization, or summary identities", async () => {
    await expect(materializeLibraryComposition({ ...command, headword: "forged" })).rejects.toMatchObject({ status: 422 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { ...step, contentHash: "f".repeat(64) }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
    expect(mocks.finalize).not.toHaveBeenCalled();
    mocks.finalize.mockReset().mockResolvedValueOnce({ data: { ...completed, versionId: datasetId }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
    mocks.finalize.mockResolvedValueOnce({ data: { ...completed, done: 2 }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
    mocks.rpc.mockResolvedValueOnce({ data: completed, error: null }).mockResolvedValueOnce({ data: { ...result, createdBook: { ...result.createdBook, contentHash: "f".repeat(64) } }, error: null });
    await expect(materializeLibraryComposition(command)).rejects.toMatchObject({ status: 503 });
  });
  it("reports intervening source changes as conflicts without a usable success", async () => {
    mocks.finalize.mockReset().mockResolvedValueOnce({ data: null, error: { code: "40001", message: "secret SQL" } });
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(command) }));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("secret SQL");
    expect(mocks.rpc).not.toHaveBeenCalledWith("get_vocabulary_composition_summary_v1", expect.anything());
  });
  it("preserves committed progress when authorization disappears inside the first HTTP request", async () => {
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: { ...step, stage: "entries", done: 500, total: 1000 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(command) }));
    expect(response.status).toBe(403); expect(response.headers.get("X-Wordbook-Progress")).toBe("confirmed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    try { await expect(sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ status: 403, progressConfirmed: true }); }
    finally { vi.unstubAllGlobals(); }
  });
  it("bounds each request and resumes a saved question plan without generating random choices again", async () => {
    mocks.rpc.mockReset().mockImplementation(async () => ({ data: { ...step, stage: "entries", done: mocks.rpc.mock.calls.length * 500, total: 5000 }, error: null }));
    expect(await materializeLibraryComposition(command)).toMatchObject({ kind: "materializing", stage: "entries", done: 2000, requestId: command.requestId });
    expect(mocks.rpc).toHaveBeenCalledTimes(4); expect(mocks.plan).not.toHaveBeenCalled();
    mocks.rpc.mockReset().mockImplementation(async (name: string) => ({ data: name === "advance_vocabulary_template_book_v1" ? step : result, error: null }));
    mocks.finalize.mockReset().mockResolvedValueOnce({ data: { ...step, stage: "questions", done: 1000, total: 1000 }, error: null }).mockResolvedValueOnce({ data: completed, error: null });
    expect(await materializeLibraryComposition(command)).toEqual(result); expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.finalize.mock.calls.every(call => call[1].p_questions === null)).toBe(true);
  });
  it("resumes the first accepted plan when two administrators submit different random plans concurrently", async () => {
    mocks.finalize.mockReset().mockResolvedValueOnce({ data: { ...step, needsQuestions: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "40001", message: "composition_question_plan_changed" } })
      .mockResolvedValueOnce({ data: completed, error: null });
    expect(await materializeLibraryComposition(command)).toEqual(result);
    expect(mocks.plan).toHaveBeenCalledOnce(); expect(mocks.finalize).toHaveBeenCalledTimes(3);
    expect(mocks.finalize.mock.calls[2]![1].p_questions).toBeNull();
  });
  it("continues the exact browser command only after validated progress and stops on uncertain outcomes", async () => {
    const progress = { ...step, kind: "materializing", requestId: command.requestId, templateId: command.templateId };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(progress)).mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).toEqual(result);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(call => call[1].body)).toEqual([JSON.stringify(command), JSON.stringify(command)]);
      expect(fetchMock.mock.calls.every(call => call[1].headers["X-Wordbook-Viewer"] === "00000000-0000-4000-8000-000000000099")).toBe(true);
      fetchMock.mockReset().mockResolvedValueOnce(Response.json(progress)).mockResolvedValueOnce(Response.json({}, { status: 403 }));
      await expect(sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ status: 403, progressConfirmed: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      fetchMock.mockReset().mockImplementation(async () => Response.json(progress));
      await expect(sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ status: 503 }); expect(fetchMock).toHaveBeenCalledTimes(2);
      fetchMock.mockReset().mockRejectedValue(new Error("network"));
      await expect(sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).rejects.toThrow("network"); expect(fetchMock).toHaveBeenCalledOnce();
      fetchMock.mockReset().mockResolvedValue(Response.json({ ...progress, requestId: datasetId }));
      await expect(sendLibraryCommand(command, "00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ status: 503 }); expect(fetchMock).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
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
