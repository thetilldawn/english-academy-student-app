import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const originalEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  VERCEL_URL: process.env.VERCEL_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Preview 실행 환경 확인", () => {
  it("Preview 밖에서는 환경 정보를 공개하지 않는다", async () => {
    process.env.VERCEL_ENV = "production";
    expect((await GET()).status).toBe(404);
  });

  it("Vercel이 주입한 Preview 호스트와 Supabase ref를 반환한다", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL =
      "english-academy-student-example1-thetilldawn-3859s-projects.vercel.app";
    process.env.VERCEL_GIT_COMMIT_REF = "codex/approved-preview-e2e";
    process.env.VERCEL_GIT_COMMIT_SHA =
      "1111111111111111111111111111111111111111";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://wojxpruvbjzbhrpmsbuy.supabase.co";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      deploymentHost:
        "english-academy-student-example1-thetilldawn-3859s-projects.vercel.app",
      gitCommitRef: "codex/approved-preview-e2e",
      gitCommitSha: "1111111111111111111111111111111111111111",
      supabaseProjectRef: "wojxpruvbjzbhrpmsbuy",
      vercelEnvironment: "preview",
    });
  });
});
