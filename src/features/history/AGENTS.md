# 관리자 개요·내역 작업 안내

- 내역은 표시와 시험 수정 진입을 소유한다. 배정 수정 규칙·폼·저장 계약은 `assignments`가 소유한다.
- 개요·내역·상세 읽기를 고칠 때는 먼저 `npm run map:flow -- admin-history-read`로 연결 파일을 출력한다.
- 첫 화면 자료는 `page.tsx`에서 `server/queries/admin-history-list-query.ts` 또는
  `admin-history-detail-query.ts`를 직접 호출한다. 자체 Route Handler로 다시 HTTP 요청하지 않는다.
- 검색·상태 변경·더보기는 `controller`가 요청 수명과 취소를, `transport/history-pages.ts`가 HTTP를,
  `/api/admin/history`가 인증·상태 코드를 맡는다. UI 파일에서 `fetch`하지 않는다.
- 상세 편집의 열기·닫기·저장 후 이동·포커스 수명은
  `controller/use-editable-history-assignment.ts`가 맡는다. UI 폴더에 상태 조정 hook을 두지 않는다.
- 배정 수정의 관리자 메뉴·로그아웃·브라우저 뒤로가기·모달 닫기는 app-shell의
  `useRouteExitGuard`를 함께 사용한다. 저장 중은 확인 없이 차단하고 dirty일 때만 확인하며, UI에서
  별도 `beforeRouteClose` 확인을 겹쳐 호출하지 않는다.
- 목록과 상세 조회를 한 파일로 합치지 않는다. 목록은 구역별 10건+다음 행과 불투명 커서만,
  상세는 정확한 응시 ID 또는 배정 ID+학생 ID 한 건만 읽는다.
- 응시 문항 상세 조회는 `server/queries/admin-attempt-detail-query.ts`가 소유한다. Route Handler는
  `public-server-queries.ts`로만 들어오며 예전 `lib/services/admin-attempt-read-service`를 되살리지 않는다.
- 개인 내역은 공유 캐시와 `use cache`를 금지한다. 초기 RSC 조회는 보호 구역의 동적 요청에 두고,
  상호작용 응답에는 `Cache-Control: private, no-store`를 유지한다.
- APP-20260906-12: 내역 첫 페이지의 선택적 브라우저 메모리만 공통 session 수명으로 보관한다. 실험 당시 HISTORY_LIST_CACHE_CANARY 기본 OFF였으며 검증 후 DEPLOY-20260906-01에서 기본 ON으로 채택했다. `lib/env.ts#getAdminListCachePolicy`로만 해석하며 0·잘못된 값은 OFF, 미설정·공백·1은 ON이다. 학생·배정 설정과 독립이다. SSR 문서는 직접 seed, Client 복귀는 반드시 현재 API 인증 뒤 표시한다. 상세/개요/더보기/정답/진행응시는 캐시 대상이 아니다.
- 커서는 `snapshotAt + 범위 + 구역 + 검색 지문 + effectiveAt + entryKey` 계약이다. 화면에서 임의로
  만들거나 해석하지 않고 `server/admin-history-cursor.ts`만 사용한다.
- DB 함수·권한·스냅샷 계산을 바꾸면 `supabase/migrations`와 최종 스키마 통합검사를 함께 바꾸며,
  Preview 한 건 적용 전에는 완료로 올리지 않는다.
- 숨김·취소 성공은 `admin-history-mutation-events.ts`로 DB 버전이 든 영수증을 먼저 알린다. 목록은
  `use-admin-history-section-page.ts`에서 영향 구역만 새 스냅샷 10+1로 바꾸며 전체 화면을 갱신하지 않는다.
- 개인 캐시 ON의 내역만 구역 mutation 조회를 끄고 공용 변경 신호의 첫 목록1회로 교체한다. 로컬 영수증 최소시각은 캐시 폐기 전 먼저 기록하고 낮추지 않는다. OFF/개요/상세는 기존 구역 갱신을 유지한다. 더보기 자체는 끄지 않는다.
- 숨김 UI는 `actions/hide-admin-history-entry.ts` 공개 Server Action 경계로만 들어가며, `api/`나
  `transport/`에서 `server/actions/`를 직접 가져오지 않는다.
- 현재 응시를 숨기면 이전 응시가 다른 상태 구역에 나타날 수 있으므로 현재 표시 중인 모든 일반 구역을
  서버 값으로 바꾼다. 개수는 로컬 증감하지 않고 서버 `totalCount`를 사용한다.
- 변경 뒤 첫 구역 재조회가 시작되는 순간 기존 `nextCursor`를 폐기한다. 재조회가 실패해도 예전
  스냅샷 커서로 더보기를 허용하지 않는다.
- 숨김 뒤 재조회 스냅샷은 DB의 `hidden_at`보다 빠르면 안 된다. 앱 서버의 `new Date()`를 변경 버전으로
  사용하지 않는다.
- 수정 작업은 `npm run map:flow -- assignment-edit`로 페이지, 대화상자, controller, 정책, Route,
  service, migration, 검사를 함께 확인한다.
- 다른 기능의 UI·계약을 새로 깊은 경로로 가져오지 않는다. 현재 직접 참조는 소유권 지도에 동결돼 있다.
- 다른 기능이 학습 활동 상태·표시 자료형을 쓰면 `public-contracts.ts`, 상태·점수·학습 이력 UI를 쓰면
  `public-ui.ts`, DB 행 검증·변환을 쓰면 `public-server.ts`로만 들어온다. 다른 기능에서
  `history/domain`, `history/presentation`, `history/ui`, `history/server`를 직접 가져오지 않는다.
- 내역 조회와 표시 변환에 숨은 DB 쓰기를 넣지 않는다.
- APP-20260908-02: 목록의 학교/학년은 기존 SQL 조회 열의 최소 JSON 표시 필드로 추가한다. 학생별 추가 조회를 만들지 않고 삭제된 학생은 두 필드를 null로 가린다. 새 migration 적용 전의 응답은 호환하되 실제 표시 완료로 기록하지 않는다.
- 목록 구역 집합은 계약의 expectedAdminHistoryGroupKeys 한 곳에서 서버/브라우저가 함께 결정한다.
  api/history-read-response.ts는 필수 구역/행/조건을 확인하며 잘못된 성공 본문을 0건으로 만들지 않는다.
- 통신 실패 종류는 contracts/admin-history-request-error.ts, 쉬운 안내는 presentation/카탈로그,
  표시는 ui/history-read-failure.tsx가 맡는다. error.message/API error 원문을 화면에 직접 쓰지 않는다.
- 검색 실패는 요청 조건에 귀속한다. 인증 실패 뒤에는 같은 조건/같은 서버 자료로 내역을 재노출하지 않고
  인증된 새 서버 자료에서만 복구한다. 개요와 내역을 함께 검사한다.
- 변경 후 읽기 실패는 옛 행/개수/커서를 숨기고 같은 영수증의 읽기만 재시도한다.
  거절된 더보기 커서는 서버가 시각을 정한 첫 목록 조회로 복구하며 명령을 다시 보내지 않는다.
- 실제 학생 없이 화면 상태를 확인할 때 scripts/local-history-read-fixture.mjs를 재사용한다.
  localhost 전용 가짜 응답 화면이며 DB를 쓰는 기존 fixture 명령이나 운영 검증의 대체 근거가 아니다.
