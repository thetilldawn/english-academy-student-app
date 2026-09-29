import { expect, it } from "vitest";
import { AuthenticationUnavailableError } from "./authentication-error";
import { withAuthenticationFailureResponse } from "./route-authentication";

it("인증 장애만503으로 응답하고 내부 원인을 내보내지 않는다", async () => {
  const wrapped = withAuthenticationFailureResponse(async () => { throw new AuthenticationUnavailableError("secret db detail"); });
  const result = await wrapped();
  expect(result.status).toBe(503);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.text()).not.toContain("secret");
});
it("실제 인증거절과 성공 응답은 변경하지 않는다", async () => {
  for (const status of [200,401,403]) {
    const response = new Response(null, { status });
    expect(await withAuthenticationFailureResponse(async () => response)()).toBe(response);
  }
});
it("업무 예외나 Next 제어 흐름을 인증 오류로 삼키지 않는다", async () => {
  const failure = new Error("NEXT_REDIRECT");
  await expect(withAuthenticationFailureResponse(async () => { throw failure; })()).rejects.toBe(failure);
});
