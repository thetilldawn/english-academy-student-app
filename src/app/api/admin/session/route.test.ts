import { expect, it, vi } from "vitest";
vi.mock("@/lib/auth/admin", () => ({ getAdminContext: async () => ({ userId: "fake-admin", displayName: "가짜 관리자", sessionId: "server-only-session" }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) }));
import { POST } from "./route";
it("로그인 응답은 표시 필드만 허용하고 서버 세대를 내보내지 않는다", async () => {
  const response = await POST(new Request("http://localhost/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ email: "fake@example.invalid", password: "fake-only-password" }) }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ admin: { userId: "fake-admin", displayName: "가짜 관리자" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
