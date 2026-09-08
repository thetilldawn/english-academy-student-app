// Synthetic school responses only; no external connection and no real API credential.
export const SCHOOL_FAKE_KEY = "local-school-test-only-not-a-real-key";
export function schoolSearchFixtureResponse(input, init) {
  const raw = typeof input === "string" || input instanceof URL ? input : input.url;
  const target = new URL(raw);
  if (target.origin !== "https://open.neis.go.kr" || target.pathname !== "/hub/schoolInfo") return null;
  const params = target.searchParams;
  const query = params.get("SCHUL_NM");
  if (target.username || target.password || target.hash || (init?.method ?? "GET") !== "GET" ||
    [...params.keys()].sort().join(",") !== ["KEY", "Type", "pIndex", "pSize", "SCHUL_NM"].sort().join(",") ||
    params.get("KEY") !== SCHOOL_FAKE_KEY || params.get("Type") !== "json" || params.get("pIndex") !== "1" || params.get("pSize") !== "20") throw new Error("가짜 학교 검색 계약만 허용합니다.");
  if (query === "없는학교") return Response.json({ RESULT: { CODE: "INFO-200" } });
  if (query === "오류학교") return Response.json({ RESULT: { CODE: "ERROR-500" } });
  if (!["가짜", "가짜학교", "가짜고등학교"].includes(query)) throw new Error("등록된 가짜 학교 검색만 허용합니다.");
  return Response.json({ schoolInfo: [{ head: [{ list_total_count: 2 }, { RESULT: { CODE: "INFO-000" } }] },
    { row: ["가짜 북부", "가짜 남부"].map((region, i) => ({ ATPT_OFCDC_SC_CODE: "T00", SD_SCHUL_CODE: String(i + 1), SCHUL_NM: "가짜고등학교", ORG_RDNMA: region })) }] });
}
