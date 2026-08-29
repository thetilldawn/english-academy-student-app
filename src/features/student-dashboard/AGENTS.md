# 학생 메인 기능 안내

- 먼저 `npm run map:feature -- student-dashboard`와
  `npm run map:flow -- student-dashboard-read`로 전체 연결을 확인한다.
- `contracts`는 브라우저에 직렬화할 최소 자료형, `domain`은 상태·정렬,
  `server`는 학생 세션 범위의 DB 조회·응답 검증·커서, `controller`는 완료 내역
  더보기 요청 수명, `transport`는 브라우저 POST, `ui`는 표시만 맡는다.
- 최초 시험 목록은 Server Component가 기능 `server` 조회를 직접 호출한다. 앱 자신의
  Route Handler를 서버에서 다시 호출하지 않는다.
- 완료 시험의 10개 더보기만
  `ui → controller → transport → /api/student/dashboard/completed → server`를 사용한다.
- Route Handler와 서버 조회는 브라우저의 학생 ID를 받지 않고 반드시 현재
  `StudentSession.studentId`만 사용한다.
- 학생별 배정·점수·오답은 `use cache`, 공유 HTTP 캐시, 태그 캐시에 넣지 않는다.
  완료 페이지 응답은 항상 `Cache-Control: private, no-store`다.
- 초기 시험 목록과 상태 개수의 `snapshotAt`은 같은 DB 시각이지만, 병렬 조회하는 현재
  포인트까지 같은 시각이라고 표현하지 않는다.
- 현재 시험은 서버 렌더링을 유지하고 완료 내역만 작은 Client 영역으로 둔다.
  새 snapshot에서는 `key={snapshotAt}`으로 이전 더보기 상태를 버린다.
- 이 흐름에는 별도 저장·복구 순서가 없으므로 빈 `application` 계층을 만들지 않는다.
