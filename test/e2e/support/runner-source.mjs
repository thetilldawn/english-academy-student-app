const alias = 'https://english-academy-student-a-git-d9206d-thetilldawn-3859s-projects.vercel.app';
const branch = 'codex/vocabulary-templates-20260920';
const document = file => file === '00_앱_인계서.md' || file.startsWith('docs/') || file.startsWith('architecture/work-records/records/DEPLOY-20261003-01.');
const tool = file => file.startsWith('test/e2e/') || ['scripts/run-playwright-suite.mjs', 'playwright.config.mjs', 'src/test-support/preview-e2e-safety.test.ts'].includes(file);
export function assertMaintenanceRunnerSource({ environment, changed, dirty }) {
  if (environment.E2E_MAINTENANCE_ROLLBACK !== '1' || environment.E2E_ALLOW_RUNNER_TOOLS_ONLY !== '1' ||
      environment.PLAYWRIGHT_BASE_URL !== alias || environment.E2E_EXPECTED_GIT_REF !== branch) throw Error('별도 검사 도구 허용 범위가 아닙니다.');
  if (!changed.length || changed.some(file => !tool(file) && !document(file))) throw Error('검사 도구 외의 제품 변경이 있어 같은 배포로 검사할 수 없습니다.');
  if (dirty.some(file => !document(file))) throw Error('미커밋 실행 코드가 있어 검사 도구 SHA를 확정할 수 없습니다.');
}
