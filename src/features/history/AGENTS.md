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
- 응시 문항 상세 조회는 `server/queries/admin-attempt-detail-query.ts`가 소유한다. 다른 기능·Route
  Handler는 `public-server.ts`로만 들어오며 예전 `lib/services/admin-attempt-read-service`를 되살리지 않는다.
- 개인 내역은 공유 캐시와 `use cache`를 금지한다. 초기 RSC 조회는 보호 구역의 동적 요청에 두고,
  상호작용 응답에는 `Cache-Control: private, no-store`를 유지한다.
- 커서는 `snapshotAt + 범위 + 구역 + 검색 지문 + effectiveAt + entryKey` 계약이다. 화면에서 임의로
  만들거나 해석하지 않고 `server/admin-history-cursor.ts`만 사용한다.
- DB 함수·권한·스냅샷 계산을 바꾸면 `supabase/migrations`와 최종 스키마 통합검사를 함께 바꾸며,
  Preview 한 건 적용 전에는 완료로 올리지 않는다.
- 숨김·취소 성공은 `admin-history-mutation-events.ts`로 DB 버전이 든 영수증을 먼저 알린다. 목록은
  `use-admin-history-section-page.ts`에서 영향 구역만 새 스냅샷 10+1로 바꾸며 전체 화면을 갱신하지 않는다.
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
- 내역 조회와 표시 변환에 숨은 DB 쓰기를 넣지 않는다.
