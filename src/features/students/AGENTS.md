# 학생 관리 기능 안내

- 시작 전에 `npm run map:feature -- students`와 `npm run map:flow -- student-management-screen`을
  실행해 화면, 서버 조회, Route Handler, DB 함수, 다른 기능 연결을 함께 확인한다.
- `student-management-screen`은 목록·상세 읽기와 같은 화면에서 쓰는 생성·프로필·접근·오답 변경
  의존을 함께 보여 준다. 변경 Route Handler와 server service 전체는 `map:feature -- students`로 확인한다.
- `contracts/`는 서버와 브라우저가 함께 쓰는 목록·상세 자료 모양, `controller/`는 Client 입력과 요청 수명,
  `transport/`는 브라우저 후속 HTTP, `server/queries/`는 인증 뒤 DB 조회를 맡는다.
- 다른 기능이 학생 목록 자료형·단어장 학습 이력 자료형을 써야 하면 `public-contracts.ts`, 서버 조회를
  써야 하면 `public-server.ts`, 브라우저 조회를 써야 하면 `public-client.ts`로 들어온다. 예전
  `lib/admin/student-vocab-book-history` 경로를 다시 만들지 않는다.
- `server/components/`는 기본 첫 목록·상세 자료를 query에서 직접 받아 UI에 전달한다. 최초 서버 읽기에서 앱의
  Route Handler를 다시 HTTP로 호출하지 않는다. APP-20260906-08 시험도 문서 최초 진입은 서버 자료를 hydration에 인계한다. Client 재진입만 캐시 읽기를 사용한다. 옛 RSC의 자료를 최초 인증처럼 다시 받지 않는다. 실험 당시 기본 OFF였으며 검증 후 DEPLOY-20260906-01에서 기본 ON으로 채택했다. 세 플래그 해석은 `lib/env.ts#getAdminListCachePolicy` 한 곳만 사용한다. 미설정·공백·1은 ON, 0·잘못된 값은 OFF이며 학생 OFF이면 배정도 OFF다.
- 검색·필터·더보기·이력 더보기만 `controller → transport → Route Handler → server query` 순서로 간다.
- 등록 준비도 열 때 `use-student-create-preparation → assignments/public-client`로 기존 API를 읽는다. 접힌 준비자료를 서버에서 미리 읽지 않는다. 성공 빈배열/미조회/실패/권한을 구분하고 입력은 접기/펼치기에도 보존한다.
- 동일 정규조건의 성공/진행중 검색만 생략하고 재시도/학생 변경 뒤 갱신은 실제로 다시 읽는다. 강제 갱신 시작 시 옛 커서를 폐기한다. 화면 이동 간 개인 캐시는 아니다.
- 시험 캐시는 Provider 한 개가 소유한다. 계정 변경은 재마운트, 세대/로그아웃은 잠금, 학생 성공 변경은 폐기 후 새 첫 목록으로 교체한다. 활성 시험에서는 Provider가 변경 알림을 맡고 기존 목록 hook의 중복 구독은 끈다. 기존 SSR 경로의 구독은 유지한다.
- 시험 캐시에는 포인트를 넣지 않는다. 재진입/탭 복귀는 인증·포인트 확인 전 숨기고, 15초 내 첫 목록만 재사용한다. 표시 상한 60초, 미사용 제거 120초, 최대 20조건이다. 일반 자동 재시도나 주기 조회를 추가하지 않는다.
- `ui/`와 `ui/panels/`에서는 `fetch`, DB 호출, 포인트 계산을 하지 않는다. 화면 변경과 업무 계산을
  한 파일에 다시 합치지 않는다.
- 직접 상세와 가로채기 상세는 모두 `StudentDetailRouteContent`를 사용한다. 둘 중 한 경로만 별도
  자료 조합을 만들지 않는다.
- `NavigationExitGuardProvider`, `GuardedLink`, `useRouteExitGuard`는 app-shell 소유다. 학생 기능은
  상세의 dirty·busy 상태를 등록하고 삭제 성공 시 강제 이탈만 요청한다. 같은 이탈 규칙을 학생 전용
  hook으로 복제하지 않는다.
- Next 내부 링크는 `onNavigate`, 상세 닫기는 `requestExit`, 문서 종료는 `beforeunload`를 사용한다.
  실패할 수 있는 비동기 명령은 성공 여부를 반환하고, 실패 뒤 보호 기록과 재시도가 복구되는지 검사한다.
- 배정 생성·수정은 `assignments`, 배정된 시험은 `assignment-queue`, 내역 분류는 `history`, 포인트
  표시는 `learning-points`의 공개 경계를 사용한다.
- 학습 이력 자료형·상태 계산은 `history/public-contracts.ts`, 목록·상태·점수 UI는
  `history/public-ui.ts`, 서버 행 검증·변환은 `history/public-server.ts`만 사용한다.
- 다른 기능의 내부 UI·model을 새로 직접 가져오지 않는다. 공유 경계가 없으면 기능 소유권 지도에
  의존 이유와 제거 시점을 먼저 기록한다.
- DB 함수가 바뀌면 migration, 통합검사, Preview 함수·권한 재확인을 같은 작업에서 갱신한다.
- 이름·학교·학년 저장은 `server/actions/update-student-profile-action.ts`만 사용하고 프로필 전용 DB
  버전을 함께 보낸다. Client controller는 `actions/update-student-profile.ts` 공개 Server Action
  경계로 들어가며 기존 학생 PATCH Route를 다시 만들지 않는다.
- 최초 상세는 `get_admin_student_detail_initial_v2` 한 번으로 상세 자료와 프로필 버전을 같은 DB
  스냅샷에서 받는다. 버전을 위해 프로필 RPC를 순차로 한 번 더 호출하지 않는다.
- 409이면 서버 최신값으로 기준선과 기준 버전만 갱신하고 작성 중 입력은 보존한다. 같은 기준 버전 저장은
  한 번만 성공하며 성공 DB 트랜잭션 안에서 감사 기록도 함께 남아야 한다.
- 학생 상세의 프로필·접속 변경 콜백은 전체 학생 객체가 아니라 작은 변경 조각만 전달하고, page/dialog의
  공용 `use-student-detail-shell-state.ts`에서 합친다. 정상 성공 뒤 학생 목록은 현재 필터의 첫 10+1만
  다시 읽는다.
- 학생 내역 필터 교체나 첫 페이지 갱신을 시작하면 이전 `nextCursor`를 즉시 폐기한다. 새 요청이
  실패해도 이전 스냅샷의 더보기를 붙이지 않는다.
