import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { schoolSearchMessages } from "../../contracts/school-search-contract";
import { searchSchoolDirectory } from "./school-search-query";

const fetchMock = vi.fn();
const row = { ATPT_OFCDC_SC_CODE: "J10", SD_SCHUL_CODE: "12345", SCHUL_NM: "가짜고등학교", ORG_RDNMA: "가짜 지역", PRIVATE: "must-not-return" };
const payload = (rows = [row], total = rows.length) => ({ schoolInfo: [{ head: [{ list_total_count: total }, { RESULT: { CODE: "INFO-000" } }] }, { row: rows }] });
beforeEach(() => { vi.stubEnv("NEIS_API_KEY", "synthetic-key-for-tests"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("고정 공식 주소로 검색어만 보내고 최소 학교 정보만 반환한다", async () => {
  fetchMock.mockResolvedValue(Response.json(payload()));
  const result = await searchSchoolDirectory(" 가짜 ", new AbortController().signal);
  expect(result).toEqual({ items: [{ id: "J10:12345", name: "가짜고등학교", region: "가짜 지역" }], hasMore: false });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url.origin + url.pathname).toBe("https://open.neis.go.kr/hub/schoolInfo");
  expect([...url.searchParams.keys()].sort()).toEqual(["KEY", "SCHUL_NM", "Type", "pIndex", "pSize"].sort());
  expect(url.searchParams.get("SCHUL_NM")).toBe("가짜");
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|synthetic-key|must-not-return/);
});
it("정상 0건과 잘린 첫 묶음을 구분한다", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ RESULT: { CODE: "INFO-200" } }));
  expect(await searchSchoolDirectory("없음", new AbortController().signal)).toEqual({ items: [], hasMore: false });
  fetchMock.mockResolvedValueOnce(Response.json(payload(Array.from({ length: 20 }, (_, i) => ({ ...row, SD_SCHUL_CODE: String(i) })), 21)));
  expect(await searchSchoolDirectory("가짜", new AbortController().signal)).toMatchObject({ hasMore: true });
});
it("도로명주소가 비었으면 있는 지역명을 표시한다", async () => {
  fetchMock.mockResolvedValue(Response.json(payload([{ ...row, ORG_RDNMA: "  ", LCTN_SC_NM: "가짜지역" } as typeof row])));
  expect((await searchSchoolDirectory("가짜", new AbortController().signal)).items[0].region).toBe("가짜지역");
});
it.each([
  {}, { RESULT: { CODE: "ERROR-290" } }, payload([], 1), payload([row], 0), payload([row, row]),
  { RESULT: { CODE: "INFO-200" }, ...payload() }, payload([row], 2),
])("장애·상충·누락 응답을 정상 빈 목록으로 취급하지 않는다 %#", async value => {
  fetchMock.mockResolvedValue(Response.json(value));
  await expect(searchSchoolDirectory("가짜", new AbortController().signal)).rejects.toMatchObject({ status: 503, message: schoolSearchMessages.error });
});
it("키 미설정과 이미 취소된 요청은 외부 요청 0회", async () => {
  vi.stubEnv("NEIS_API_KEY", "");
  await expect(searchSchoolDirectory("가짜", new AbortController().signal)).rejects.toMatchObject({ message: schoolSearchMessages.unavailable });
  vi.stubEnv("NEIS_API_KEY", "synthetic-key-for-tests");
  await expect(searchSchoolDirectory("가짜", AbortSignal.abort())).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("본문이 멈추거나 URL을 담은 fetch 오류도 안전한 안내만 반환한다", async () => {
  const abort = new AbortController();
  fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  const pending = searchSchoolDirectory("가짜", abort.signal);
  const check = expect(pending).rejects.toMatchObject({ message: schoolSearchMessages.error });
  await Promise.resolve(); abort.abort(); await check;
  fetchMock.mockRejectedValue(new Error("https://open.neis.go.kr/?KEY=synthetic-key-for-tests"));
  await expect(searchSchoolDirectory("가짜", new AbortController().signal)).rejects.toMatchObject({ message: schoolSearchMessages.error });
});
