const PREVIEW_SUPABASE_PROJECT_REF = "wojxpruvbjzbhrpmsbuy";
const PRODUCTION_ORIGINS = new Set([
  "https://english-academy-student-app.vercel.app",
]);
const PREVIEW_HOST_PATTERN =
  /^english-academy-student-[a-z0-9]+-thetilldawn-3859s-projects\.vercel\.app$/;

type E2EEnvironment = Record<string, string | undefined>;

function normalizeOrigin(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label}이(가) 필요합니다.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label}에는 origin만 입력해야 합니다.`);
  }
  return url.origin;
}

export function isLocalE2EOrigin(origin: string) {
  const url = new URL(origin);
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

export function assertReadOnlyE2EEnvironment(
  environment: E2EEnvironment = process.env,
) {
  const origin = normalizeOrigin(
    environment.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    "PLAYWRIGHT_BASE_URL",
  );
  if (isLocalE2EOrigin(origin)) return { origin, target: "local" as const };

  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    PRODUCTION_ORIGINS.has(origin) ||
    !PREVIEW_HOST_PATTERN.test(url.hostname)
  ) {
    throw new Error("읽기 E2E는 승인된 Vercel Preview 주소에서만 실행할 수 있습니다.");
  }
  return { origin, target: "preview" as const };
}

export function assertPreviewMutationEnvironment(
  environment: E2EEnvironment = process.env,
) {
  const target = assertReadOnlyE2EEnvironment(environment);
  if (target.target !== "preview") {
    throw new Error("인증 쓰기 E2E는 원격 Preview에서만 실행할 수 있습니다.");
  }
  if (environment.E2E_ALLOW_PREVIEW_MUTATION !== "1") {
    throw new Error("E2E_ALLOW_PREVIEW_MUTATION=1 승인이 필요합니다.");
  }
  const expectedOrigin = normalizeOrigin(
    environment.E2E_EXPECTED_PREVIEW_ORIGIN,
    "E2E_EXPECTED_PREVIEW_ORIGIN",
  );
  if (expectedOrigin !== target.origin) {
    throw new Error("실행 주소가 승인한 고정 Preview 주소와 다릅니다.");
  }
  const projectRef = environment.E2E_EXPECTED_SUPABASE_PROJECT_REF;
  if (projectRef !== PREVIEW_SUPABASE_PROJECT_REF) {
    throw new Error("인증 쓰기 E2E는 승인된 Preview DB만 사용할 수 있습니다.");
  }
  const gitRef = environment.E2E_EXPECTED_GIT_REF;
  if (!gitRef || gitRef === "main" || !/^[A-Za-z0-9][A-Za-z0-9._/-]+$/.test(gitRef)) {
    throw new Error("인증 쓰기 E2E에는 승인된 Preview Git 브랜치가 필요합니다.");
  }
  const targetDeploymentSha = environment.E2E_TARGET_DEPLOYMENT_SHA;
  if (!targetDeploymentSha || !/^[0-9a-f]{40}$/i.test(targetDeploymentSha)) {
    throw new Error("인증 쓰기 E2E에는 대상 배포 Git SHA가 필요합니다.");
  }
  const checkRunnerSha = environment.E2E_CHECK_RUNNER_SHA;
  if (!checkRunnerSha || !/^[0-9a-f]{40}$/i.test(checkRunnerSha)) {
    throw new Error("인증 쓰기 E2E에는 검사 도구 Git SHA가 필요합니다.");
  }
  if (!environment.PREVIEW_E2E_ADMIN_EMAIL || !environment.PREVIEW_E2E_ADMIN_PASSWORD) {
    throw new Error("Preview 관리자 E2E 계정이 필요합니다.");
  }
  return {
    adminEmail: environment.PREVIEW_E2E_ADMIN_EMAIL,
    adminPassword: environment.PREVIEW_E2E_ADMIN_PASSWORD,
    checkRunnerSha,
    gitRef,
    origin: target.origin,
    projectRef,
    targetDeploymentSha,
  };
}

export function assertPreviewRuntimeIdentity(
  value: unknown,
  expected: {
    gitRef: string;
    origin: string;
    projectRef: string;
    targetDeploymentSha: string;
  },
) {
  if (!value || typeof value !== "object") {
    throw new Error("Preview 실행 환경 확인 응답이 올바르지 않습니다.");
  }
  const identity = value as Record<string, unknown>;
  const expectedHost = new URL(expected.origin).hostname;
  if (
    identity.vercelEnvironment !== "preview" ||
    identity.gitCommitRef !== expected.gitRef ||
    identity.gitCommitSha !== expected.targetDeploymentSha ||
    identity.supabaseProjectRef !== expected.projectRef ||
    identity.deploymentHost !== expectedHost
  ) {
    throw new Error("접속한 배포의 실제 Preview 환경, Git 또는 DB가 승인값과 다릅니다.");
  }
  return {
    deploymentHost: expectedHost,
    gitCommitRef: expected.gitRef,
    gitCommitSha: expected.targetDeploymentSha,
    supabaseProjectRef: expected.projectRef,
    vercelEnvironment: "preview" as const,
  };
}

export function vercelProtectionHeaders(
  environment: E2EEnvironment = process.env,
): Record<string, string> {
  const secret = environment.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return {};
  return {
    "x-vercel-protection-bypass": secret,
    "x-vercel-set-bypass-cookie": "true",
    "x-vercel-skip-toolbar": "1",
  };
}

export async function establishVercelProtectionSession(
  context: BrowserContext,
  environment: E2EEnvironment = process.env,
) {
  const headers = vercelProtectionHeaders(environment);
  if (Object.keys(headers).length === 0) return;

  const { origin } = assertReadOnlyE2EEnvironment(environment);
  const response = await context.request.get(origin, {
    headers,
    maxRedirects: 0,
  });
  if (response.status() >= 400) {
    throw new Error(
      `Vercel Preview 보호 우회 세션 생성에 실패했습니다: HTTP ${response.status()}`,
    );
  }
}
import type { BrowserContext } from "@playwright/test";
