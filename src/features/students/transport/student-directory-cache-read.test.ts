import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyStudentDirectoryFilters as filters } from "../contracts/student-directory-read-model";
import { readStudentDirectoryCache } from "./student-directory-cache-read";
import { loadStudentDirectoryNextPage } from "./student-directory-pages";
afterEach(() => vi.unstubAllGlobals());
describe("개인 목록 HTTP 계약", () => {
  it("no-store와 취소신호를 전달한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ kind: "resume", identity: "a".repeat(64), userId: "00000000-0000-4000-8000-000000000999", points: [] }));
    vi.stubGlobal("fetch", fetcher); const signal = new AbortController().signal;
    await readStudentDirectoryCache({ mode: "cache", filters }, signal);
    expect(fetcher).toHaveBeenCalledWith("/api/admin/students/directory", expect.objectContaining({ signal, cache: "no-store", method: "POST" }));
  });
  it.each([401, 403, 503])("상태 %s를 보존하되 내부 문구는 노출하지 않는다", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "secret SQL" }, { status })));
    await expect(readStudentDirectoryCache({ mode: "cache", filters })).rejects.toMatchObject({ status });
    await expect(readStudentDirectoryCache({ mode: "cache", filters })).rejects.not.toThrow("secret");
  });
  it.each([null, {}, { kind: "resume", points: [] }])("잘못된 성공 응답을 빈 목록으로 표시하지 않는다: %j", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    await expect(readStudentDirectoryCache({ mode: "cache", filters })).rejects.toMatchObject({ status: 502 });
  });
  it("다음 페이지의 인증 오류도 타입을 유지한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    await expect(loadStudentDirectoryNextPage({ mode: "page", filters, cursor: "c" })).rejects.toMatchObject({ status: 401 });
  });
});
