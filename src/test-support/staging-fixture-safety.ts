export const UI_FIXTURE_STAGING_PROJECT_REF = "wojxpruvbjzbhrpmsbuy";
export const UI_FIXTURE_PRODUCTION_PROJECT_REFS = new Set([
  "xdxhswjgksukjmpbzqgz",
]);

export type FixtureEnvironment = {
  supabaseUrl: string | undefined;
  expectedProjectRef: string | undefined;
  vercelEnvironment: string | undefined;
};

export function parseSupabaseProjectRef(urlValue: string): string {
  const hostname = new URL(urlValue).hostname;
  const suffix = ".supabase.co";
  if (!hostname.endsWith(suffix)) {
    throw new Error("Supabase URL의 호스트 형식이 올바르지 않습니다.");
  }
  const projectRef = hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("Supabase project ref 형식이 올바르지 않습니다.");
  }
  return projectRef;
}

export function assertStagingFixtureEnvironment(
  environment: FixtureEnvironment,
): string {
  if (!environment.supabaseUrl || !environment.expectedProjectRef) {
    throw new Error("staging fixture 환경변수가 누락되었습니다.");
  }
  if (environment.vercelEnvironment === "production") {
    throw new Error("Production 환경에서는 UI fixture를 실행할 수 없습니다.");
  }

  const actualRef = parseSupabaseProjectRef(environment.supabaseUrl);
  if (UI_FIXTURE_PRODUCTION_PROJECT_REFS.has(actualRef)) {
    throw new Error("운영 Supabase에는 UI fixture를 실행할 수 없습니다.");
  }
  if (environment.expectedProjectRef !== UI_FIXTURE_STAGING_PROJECT_REF) {
    throw new Error("허용된 staging project ref가 아닙니다.");
  }
  if (actualRef !== UI_FIXTURE_STAGING_PROJECT_REF) {
    throw new Error("현재 Supabase가 허용된 staging 프로젝트가 아닙니다.");
  }
  if (actualRef !== environment.expectedProjectRef) {
    throw new Error("현재 Supabase와 예상 staging project ref가 다릅니다.");
  }
  return actualRef;
}
