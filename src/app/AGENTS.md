# Next.js 경로 작업 안내

- `page.tsx`는 권한을 확인하고 기능별 Server Component 또는 최초 화면 자료를 조합한다.
- `page.tsx`에 새 업무 계산, 쓰기, Client 입력 상태를 넣지 않는다.
- `route.ts`는 인증, 입력 해석, HTTP 상태·헤더만 담당한다. 업무 계산과 DB 호출은 기능의 server
  경계나 현재 소유 서비스에 둔다.
- Server Component가 같은 앱의 Route Handler를 HTTP로 다시 호출하지 않는다.
- 개인 학생·배정·응시·오답 자료는 여러 요청이 공유하는 캐시에 넣지 않는다.
- React `cache()`는 같은 Server Component 렌더 안의 중복 조회에만 쓴다.
- R8의 `use cache`와 태그 갱신 시험안은 기각·롤백되었다. 현재 미적용이며 재도입은 별도 설계·검증 대상이다.
- 독립적으로 늦는 패널은 `Suspense`, 경로 전체 대기는 `loading.tsx`로 분리한다. 예상 가능한 입력/조회/저장 실패는
  해당 영역의 결과 계약으로 처리하고, 예상 밖 예외는 `error.tsx`, 루트 layout 예외는 `global-error.tsx`로 보낸다.
  없는 주소/대상은 `not-found.tsx`로 구분한다. 인증 전 개인 자료를 먼저 stream하지 않는다.
- 쉬운 상태 문구·입력 보존·복구·검사는 앱 개발 기준 3절을 따른다. 미선택/정상 0건/조회 실패/404를
  한 상태로 합치거나 error.message를 그대로 보여주지 않는다. 특수 파일의 존재만으로 실제 표시 검사를 대신하지 않는다.
- 루트 `proxy.ts`는 인증 경계, `next.config.ts`는 앱 전체 Next.js 설정으로 취급한다. 둘 다 기능 폴더로
  옮기거나 기능별 예외를 직접 쌓지 말고 `npm run map:owner -- auth|app-shell`에서 소유 경로를 확인한다.
- `layout`, `loading`, `error`, `not-found`, 경로별 CSS·폰트·계약 검사는 모두
  `architecture/기능_소유권.json`의 정확한 `appSupportOwners` 목록에 등록한다. 새 보조 파일을 만들고
  등록하지 않으면 Preview의 `prebuild`가 실패해야 한다.
- `work-records.test.mjs`는 앱 기능이 아닌 개발 기록 검사기의 가상 예시·경로·증거·명령 경계 검사다.
  `architectureGuardOwners`에 등록하며 실제 문법 기능이나 학생 자료를 만들지 않는다.
