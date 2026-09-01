# 인증 E2E·CI·운영 안전 설계

## 목적과 경계

- 고정 Vercel Preview와 가짜 학생만 사용한다.
- Production 주소 `english-academy-student-app.vercel.app`와 Production Supabase
  `xdxhswjgksukjmpbzqgz`는 쓰기 E2E 시작 전에 거부한다.
- Preview Supabase는 `wojxpruvbjzbhrpmsbuy`만 허용한다.
- Production 배포·DB migration·실제 학생 접근은 이 배치의 범위가 아니다.

## 적용 구조

| 범주 | 위치 | 책임 |
|---|---|---|
| 실행 차단 | `test/e2e/support/environment.ts` | 고정 Preview 주소, Preview DB, 명시적 쓰기 승인, 관리자 비밀 존재 확인 |
| 실제 배포 확인 | `src/app/api/preview-identity/route.ts` | Vercel 환경·배포 호스트·Git ref/SHA·실제 Supabase ref를 no-store로 확인. Preview 밖에서는 404 |
| 가짜 학생 | `test/e2e/fixtures/preview-run.ts` | 생성 요청 전 의도 기록, 관리자 로그인, 학생·코드 생성, 별도 학생 세션, 비밀 없는 영수증 |
| 중단 복구 | `scripts/cleanup-preview-e2e.ts` | 정확한 이름 1건과 ID를 다시 맞추고 관리자 API로 정리. ID 미수신 상태는 재확인 뒤에도 성공으로 오인하지 않음 |
| 업무 흐름 | `test/e2e/authenticated/vocab-assignment.spec.ts` | 단일·일괄·오답·재시험·후속 회차의 정상·경계·실패 9종 |
| 화면 품질 | `test/e2e/public/` | 360·768·1440, Axe, 가로 넘침, 키보드, 다크 모드, 감소 모션, 브라우저 오류 |
| PR 검사 | `.github/workflows/pr-fast.yml` | 비밀 없는 lint·typecheck·구조·안전·컴포넌트·변경 테스트. `proxy.ts`와 `vercel.json`도 전체 검사 대상으로 취급 |
| 배포 smoke | `.github/workflows/preview-smoke.yml` | 보호된 전용 브랜치의 현재 HEAD인 Vercel Preview만 공개 읽기 검사 |
| 인증 E2E | `.github/workflows/preview-full-e2e.yml` | 보호된 전용 브랜치의 현재 HEAD만 수동 검사하고 정상 종료 또는 복구 단계의 정리 영수증 보존 |

## 실행 단위와 비용 경계

0. Playwright 실행기는 Node.js 24.13 이상 25 미만을 사용한다. Windows의 Node 24.11.0은
   Playwright 1.62.1 테스트 수집 중 프로세스가 종료되는 것을 재현했으므로 시작 전에 명시적으로
   차단한다. 로컬 smoke는 지정 포트가 이미 사용 중이면 기존 서버를 재사용하지 않고 중단하며,
   이번에 실행한 Next.js 자식 프로세스의 준비 신호·생존·HTTP 응답을 모두 확인한다.
1. PR은 한 러너에서 `npm ci --ignore-scripts`를 한 번만 수행한다. Vercel Git 연동이 같은 커밋을 빌드하므로
   GitHub에서 `next build`를 중복하지 않는다.
2. 일반 변경은 변경 영향 테스트를 사용한다. migration·패키지·핵심 설정 변경은 전체 Vitest를
   실행한다.
3. 공개 smoke는 DB를 쓰지 않고 세 화면 크기를 모두 검사한다.
4. 인증 E2E는 `authenticated-preview` 한 실행 묶음, worker 1개, 순차 실행이다. 화면 크기마다
   학생·시험을 다시 만들지 않는다.
5. 인증 E2E는 현재 수동 실행만 등록한다. 기본 브랜치와 Production 배포 승인 전에는 정기 실행을
   활성화하지 않는다. 승인 뒤 주 1회 월요일 03:37 KST(`37 18 * * 0`)를 별도 변경으로 추가한다.

## 데이터 수명과 정리

- 실행 ID·case·생성별 난수를 학생 이름·메모에 함께 기록한다. 학생 생성 POST 전에
  `intended / id:null` 의도를 먼저 남기고, ID를 받은 즉시 `pending` 추가형 스냅샷을 남긴다.
  ID를 받기 전 끊기면 정확한 이름 한 건을 제한 재조회해 ID를 먼저 기록한 뒤 삭제한다. 끝까지
  보이지 않으면 `deleted`로 거짓 확정하지 않고 실패시켜 후속 정리를 다시 요구한다.
- 학생 코드는 브라우저 메모리에서만 사용하며 console, trace, screenshot, JSON 영수증에 쓰지 않는다.
- 인증 프로젝트는 로컬·CI 모두 screenshot과 trace를 끈다.
- 모든 학생 브라우저 문맥을 먼저 닫은 뒤 관리자 `DELETE /api/admin/students/:id`를 호출한다.
- 실제 제품의 `delete_student_v2`가 학생을 차단하고 코드·세션·진행 큐를 정리한다.
- 시험·포인트·오답 감사 이력은 제품 정책대로 보존된다. 영수증에는 가짜 학생 ID와 정리 성공 여부만
  남기고 7일 보존한다.
- 정상 fixture 종료 뒤 정리하며, E2E 단계 실패·제한시간 종료 뒤에는 별도 `always()` 단계가 manifest의
  정확한 이름 1건과 ID를 실제 학생 목록에서 다시 대조한 뒤 같은 ID 삭제 API를 호출한다. 이름 검색
  결과가 일부이거나 복수이거나 ID가 다르면 삭제하지 않는다.
- 하나라도 정리에 실패하면 E2E 작업은 실패한다. 넓은 이름 검색 삭제나 Production 정리는 하지 않는다.

## 비밀과 GitHub Environment

`preview-smoke`:

- Variable `PREVIEW_SMOKE_ALLOWED_GIT_REF=<보호된 Preview smoke 전용 브랜치>`
- Secret `VERCEL_AUTOMATION_BYPASS_SECRET`

`preview-e2e`:

- Variable `PREVIEW_EXPECTED_SUPABASE_PROJECT_REF=wojxpruvbjzbhrpmsbuy`
- Variable `PREVIEW_E2E_ALLOWED_GIT_REF=<보호된 Preview E2E 전용 브랜치>`
- Secret `VERCEL_AUTOMATION_BYPASS_SECRET`
- Secret `PREVIEW_E2E_ADMIN_EMAIL` (Preview 전용 최소 권한 E2E 관리자)
- Secret `PREVIEW_E2E_ADMIN_PASSWORD` (정기 교체)

서비스 역할 키는 Playwright에 전달하지 않는다. 가짜 학생 생성·정리도 실제 관리자 세션과 공개 관리자
API를 통과한다.

`preview-smoke` Environment는 `main`만 허용하되 승인자를 두지 않아 배포 뒤 자동 검사가 멈추지 않게
한다. `preview-e2e` Environment에만 `main` 제한·필수 승인자·자기 승인 금지를 설정한다. Workflow job은
`refs/heads/main` 이벤트에서만 시작하고, 움직일 수 있는 브랜치 이름 대신 그 이벤트의 불변 SHA를
checkout한다. `npm ci`·구조 검사에는 비밀을 주지 않으며 관리자 계정과 우회 비밀은 실제 브라우저
검사 및 복구 단계에만 전달한다. 공개·인증 입력 SHA는 GitHub 보호 상태가 확인된 각 전용 브랜치의
현재 HEAD이면서 성공한 Preview 배포여야 하고, 검사 종료 시에도 같은 HEAD인지 다시 확인한다.
우회 비밀은 승인된 origin에 한 번만 보내 쿠키로 바꾼 뒤
브라우저의 외부 요청에는 전달하지 않는다. 이 외부 설정을 확인하기 전에는 인증 workflow를 운영 완료로
보지 않는다.
세 workflow와 검사 도구가 `main`에 반영되기 전에는 GitHub에서 실행하지 않고, 현재 기능 브랜치는
로컬 검사기로 승인된 Preview만 확인한다. 공개 자동 smoke도 기본 브랜치의 workflow만 실행되는 Vercel
`repository_dispatch`를 사용한다.
로컬 인증 검사는 사용자가 승인한 현재 브랜치에 한해 로컬 HEAD와 대상 Preview의 Git ref/SHA를 모두
일치시킨다. 서로 다른 브랜치나 커밋의 Preview에는 관리자 비밀을 전달하지 않는다.

## 현재 운영화 상태

- 2026-09-01 승인된 로컬 Preview 검사는 실행·검사 커밋
  `cc118459ac892d48d34b4a00840d91f4d77dcab7`과 Exact Preview
  `https://english-academy-student-eke7tym0x-thetilldawn-3859s-projects.vercel.app`의 일치를 확인하고
  공개 3/3·인증 9/9를 통과했다.
- 인증 실행 `e2e-mthsmji9-0-fb9716`에서 만든 가짜 학생 9명은 일반·복구 영수증 모두
  `deleted 9 / pending 0 / failed 0`이다. 사용한 Vercel 자동화 우회 키도 회수해
  `protectionBypass` 0개를 재확인했다.
- 로컬 앱 구현과 승인된 Preview 검증은 끝났다. 운영 자동화는 세 workflow와 검사 도구를 신뢰된
  기본 브랜치에 반영하고, `preview-smoke`·`preview-e2e` GitHub Environment의 변수·비밀·승인 규칙과
  Vercel `repository_dispatch`를 연결한 뒤 GitHub smoke와 수동 전체 E2E를 각 1회 실행해야 완료다.
- 주간 실행은 Production·기본 브랜치 반영을 별도 승인받기 전까지 비활성화한다. 이 단계에서는
  Production 배포·운영 DB·migration·실제 학생 데이터를 변경하지 않았다.
- 후속 검사 강화 코드는 `b7f2670e7642e87d093596254bd33533e408dc89`에 로컬 완료했다. PR의
  `proxy.ts`·`vercel.json` 누락, 움직이는 runner checkout, 조상 SHA 허용, 생성-기록 사이 중단,
  삭제 전 이름·ID 미대조, 기존 포트 서버 오인, 실패 UI 뒤 저장 요청 미확인, 초점 표시선 미검사를
  회귀검사와 함께 막았다. 로컬 기본브랜치 준비본은
  `fc7e918b5982362720fadbc4f2acd38e90dc287c`이며 원격 `main`에는 올리지 않았다.
- 위 강화 뒤 로컬 Vitest 347파일·1,826건, 안전검사 16/16, 구조 4파일·65건, lint, typecheck,
  React 요청 캐시, Next.js 16.2.12 build, 공개 smoke 3/3와 포트 선점 재현 검사가 통과했다.
  현재 원격의 마지막 실제 Preview 증거는 여전히 위 `cc118459`이며, 새 강화 커밋의 push와 새 Exact
  Preview 확인은 별도 외부 전송 승인 뒤 진행한다.
- 실행별 증거와 현재 우선순위는 프로젝트 루트
  `00_작업지시/DEPLOY-20260824-01_학생앱_인증E2E_운영안전.md`를 기준으로 한다.

## 관측과 실패 증거

- 공개 smoke: URL, Git SHA, 360·768·1440 프로젝트 결과, 실패 screenshot만 3일 보존한다.
- 인증 E2E: URL, 대상 배포 SHA, 검사 도구 SHA, run ID, 가짜 학생 ID, 정리 상태만 영수증으로 7일
  보존한다.
- 페이지 `console.warning`, `console.error`, `pageerror`가 하나라도 있으면 실패한다.
- 후속 회차는 답안 성공으로 대신 판정하지 않는다. 관리자 큐 API를 20초 이내 제한 재조회하여
  `완료 1회 + 서로 다른 배정 2개`를 확인한다.
- 인증 E2E는 입력 URL·Git SHA가 보호된 전용 브랜치 HEAD 및 GitHub의 성공한 Preview deployment와
  시작·종료 시 모두 일치하는지 확인하고,
  앱의 `/api/preview-identity`가 실제 `preview` 환경·Preview DB·동일 배포 호스트·Git ref/SHA를
  보고해야만 로그인한다.
- Vercel runtime log 권한은 현재 확인되지 않았다. 로그를 읽었다고 기록하지 않으며 권한 복구 전에는
  Playwright·배포 상태·앱 요청 결과만 증거로 사용한다.

## 배포와 되돌림

- 앱 코드 배포: 이 브랜치 push 뒤 Vercel Git Preview 자동 배포만 사용한다. `vercel deploy`를
  추가 실행하지 않는다.
- 기본 브랜치에는 직접 push하지 않는다. 보호된 PR과 필수 검사를 거친다는 외부 규칙을 실제로
  확인하기 전에는 Production 후보를 승인하지 않는다.
- DB: 이번 배치는 migration이 없으므로 DB rollback SQL도 없다.
- E2E 자체 문제: `preview-full-e2e.yml` 수동 실행을 중지하고 직전 코드 커밋으로 되돌린다. 생성된
  run ID의 정리 영수증을 먼저 확인한다.
- 공개 smoke 문제: Preview 배포 SHA와 실패 화면 크기를 확인한 뒤 앱 코드를 직전 검증 커밋으로
  되돌린다.
- Production 반영은 별도 승인 뒤 진행하며, Preview E2E 통과만으로 자동 승격하지 않는다.
- 이 CI 강화 배치 자체의 migration은 0건이다. 다만 현재 기능 브랜치 전체를 `origin/main`과
  비교하면 migration 파일 46개가 포함되므로, Production 전에는 실제 운영 적용 이력·파일 해시·
  적용 순서·readback·중단 및 복구 기준을 별도 감사한다.

## 변경 영향 확인표

| 면 | 처리 |
|---|---|
| UI | 제품 UI 변경 없음. 공개·인증 화면을 브라우저로 검증만 함 |
| Client 상태 | 변경 없음. 실제 controller와 transport 경로 사용 |
| 순수 계산 | 변경 없음. 기존 단위·회차·재시험·포인트 규칙을 호출 |
| Server Component | 변경 없음. 실제 Preview 렌더링으로 확인 |
| Route Handler | Preview 실환경 확인용 읽기 주소 1개 추가. 그 외 관리자·학생 공개 API를 실제 인증 세션으로 호출 |
| DB | migration 없음. 가짜 학생과 시험 이력만 Preview에 생성·논리 정리 |
| 캐시·Streaming | 변경 없음. 개인 응답 `private, no-store` 경계를 E2E가 우회하지 않음 |
| 검사 | 실행 차단 단위검사, 공개 3화면 smoke, 인증 정상·경계·실패 9종 추가 |
