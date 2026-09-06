import { afterEach, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { AssignmentWorkspaceReadError } from "../contracts/assignment-workspace-read-error";
import { loadAssignmentDatasetDirectory } from "./assignment-workspace-reads";
afterEach(() => vi.unstubAllGlobals());
it("정상 빈배열과 단어장 응답을 검사하고 no-store/취소신호를 유지한다", async () => {
  const dataset = cataloguedDatasetFromMetadata({ id: "fake", title: "가짜" }, undefined);
  const request = vi.fn().mockResolvedValueOnce(Response.json({ datasets: [] })).mockResolvedValueOnce(Response.json({ datasets: [dataset] }));
  vi.stubGlobal("fetch", request);
  const signal = new AbortController().signal;
  expect(await loadAssignmentDatasetDirectory(signal)).toEqual({ datasets: [] });
  expect(request).toHaveBeenCalledWith("/api/admin/assignment-workspace/datasets", { method: "GET", signal, cache: "no-store" });
  expect(await loadAssignmentDatasetDirectory()).toEqual({ datasets: [dataset] });
});
it.each([401, 403, 503])("HTTP%s 분류를 보존하고 서버 원문은 내보내지 않는다", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private SQL secret" }, { status })));
  await expect(loadAssignmentDatasetDirectory()).rejects.toMatchObject({ status, message: "단어장 목록을 불러오지 못했습니다." });
});
it.each([{}, { datasets: null }, { datasets: [{}] }, { datasets: "empty" }])("형식 누락은 정상 빈목록이 아니다: %j", async (payload) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  await expect(loadAssignmentDatasetDirectory()).rejects.toBeInstanceOf(AssignmentWorkspaceReadError);
});
it("비정상JSON/네트워크실패/취소를 성공으로 처리하지 않는다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not-json"))
    .mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new DOMException("aborted", "AbortError")));
  await expect(loadAssignmentDatasetDirectory()).rejects.toBeInstanceOf(AssignmentWorkspaceReadError);
  await expect(loadAssignmentDatasetDirectory()).rejects.toBeInstanceOf(TypeError);
  await expect(loadAssignmentDatasetDirectory()).rejects.toMatchObject({ name: "AbortError" });
});
