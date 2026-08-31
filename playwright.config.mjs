import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;
const mutationEnabled = process.env.E2E_ALLOW_PREVIEW_MUTATION === "1";
const suite = process.env.E2E_SUITE ?? "public";
const viewportName = process.env.E2E_VIEWPORT ?? "desktop";
const listOnly = process.argv.includes("--list");

const baseHost = new URL(baseURL).hostname;
const isLocal = baseHost === "127.0.0.1" || baseHost === "localhost";
const isApprovedPreviewHost =
  /^english-academy-student-[a-z0-9]+-thetilldawn-3859s-projects\.vercel\.app$/.test(
    baseHost,
  );
if (!isLocal && !isApprovedPreviewHost) {
  throw new Error("Playwright는 로컬 또는 승인된 Vercel Preview 주소만 사용할 수 있습니다.");
}

const requestHeaders = { origin: baseURL };

const viewportProfiles = {
  mobile: { hasTouch: true, isMobile: true, viewport: { width: 360, height: 800 } },
  tablet: { hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } },
  desktop: { hasTouch: false, isMobile: false, viewport: { width: 1440, height: 1000 } },
};
const viewportProfile = viewportProfiles[viewportName];
if (!viewportProfile) throw new Error(`알 수 없는 E2E_VIEWPORT: ${viewportName}`);
if (suite !== "public" && suite !== "authenticated") {
  throw new Error(`알 수 없는 E2E_SUITE: ${suite}`);
}
if (suite === "authenticated" && !mutationEnabled && !listOnly) {
  throw new Error("인증 E2E에는 E2E_ALLOW_PREVIEW_MUTATION=1이 필요합니다.");
}

export default defineConfig({
  testDir: "./test/e2e",
  timeout: mutationEnabled ? 240_000 : 60_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  grep: suite === "authenticated" ? /@authenticated/ : undefined,
  grepInvert: suite === "public" ? /@authenticated/ : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  workers: suite === "authenticated" ? 1 : process.env.CI ? 1 : undefined,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    extraHTTPHeaders: requestHeaders,
    hasTouch: viewportProfile.hasTouch,
    isMobile: viewportProfile.isMobile,
    screenshot: suite === "authenticated" ? "off" : "only-on-failure",
    trace: suite === "authenticated" ? "off" : "retain-on-failure",
    viewport: viewportProfile.viewport,
  },
});
