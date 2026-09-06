# 학생 메인 기능 안내

- 먼저 `npm run map:feature -- student-dashboard`와
  `npm run map:flow -- student-dashboard-read`로 전체 연결을 확인한다.
- `contracts`는 브라우저에 직렬화할 최소 자료형, `domain`은 상태·정렬,
  `server`는 학생 세션 범위의 DB 조회·응답 검증·커서, `controller`는 완료 내역
  더보기 요청 수명, `transport`는 브라우저 POST, `ui`는 표시만 맡는다.
- 최초 시험 목록은 Server Component가 기능 `server` 조회를 직접 호출한다. 앱 자신의
  Route Handler를 서버에서 다시 호출하지 않는다.
- 자동 공개를 지원하는 새 앱은 목록/완료 페이지 v2만 조회한다. 구 목록 v1은 구 배포·코드 복구의
  호환용으로 보존한다. 새 앱에서 조회 실패를 구 v1로 자동 대체하지 않는다.
- 완료 시험의 10개 더보기만
  `ui → controller → transport → /api/student/dashboard/completed → server`를 사용한다.
- Route Handler와 서버 조회는 브라우저의 학생 ID를 받지 않고 반드시 현재
  `StudentSession.studentId`만 사용한다.
- 학생별 배정·점수·오답은 `use cache`, 공유 HTTP 캐시, 태그 캐시에 넣지 않는다.
  완료 페이지 응답은 항상 `Cache-Control: private, no-store`다.
- 초기 시험 목록과 상태 개수의 `snapshotAt`은 같은 DB 시각이지만, 공통 상단 병렬 영역의
  현재 포인트까지 같은 시각이라고 표현하지 않는다. 본문에서 포인트를 중복 조회·표시하지 않는다.
- 현재 시험은 서버 렌더링을 유지하고 완료 내역만 작은 Client 영역으로 둔다.
  새 snapshot에서는 `key={snapshotAt}`으로 이전 더보기 상태를 버린다.
- 이 흐름에는 별도 저장·복구 순서가 없으므로 빈 `application` 계층을 만들지 않는다.

## 배정 단어장

- `student-assignment-study-read` 흐름: 카드 → `/student/assignments/[id]/words` 또는
  `@detail/(.)assignments/[id]/words` → `server/components/assignment-study-content.tsx`
  → `server/queries/assignment-study-query.ts` → `get_student_assignment_study_v1`.
- 현재 학생 세션과 취소·삭제되지 않은 수신 연결만 사용한다. 단독/첫 회차의 예약 공개 전
  공부는 기존대로 허용한다. 후속 회차는 공용 서버 공개 판정이 열려야 학습 자료를 반환한다.
  이미 시작한 응시의 학습·결과·재시험은 보존하되 새 응시는 다시 공개 조건을 확인한다.
  표시만으로 시험을 시작·종료하거나 점수를 바꾸지 않는다.
- 공개 판정은 DB 공용 함수 → `lib/assignment/assignment-release.ts` 계약을 사용한다.
  lifecycle/구역/카드/단어장에 첫 완료·앞 마감+12시간 규칙을 복사하지 않는다.
  보류·일정 충돌과 첫 시험 대기를 미응시나 완료로 표시하지 않는다.
- 잠긴 학습 RPC는 제목·종류·공개 상태만 반환한다. query는 엄격히 검증한 뒤
  단어·발음·예문 후속 조회를 생략한다. 잠김 화면도 기존 제목·닫기를 유지한다.
- 첫 완료 대기에는 반복 갱신하지 않는다. 확정된 공개 시각만 기존 시간 경계 갱신을 사용한다.
- 학습 범위는 실제 `assignment_questions` 대상이다. 선택지·정답 위치·시험 문항 순서는
  직렬화하지 않는다. 예문은 해시로 연결된 완성 원문만, 발음은 대상 단어만 사용한다.
- Client `assignment-study-reader`는 null/english/meaning 단일 표시 선택과 `use-study-audio` 수명을 소유한다. 영어와 뜻을 동시에 가리지 않는다.
- `assignment-study-words`/`study-blur`/`study-visibility-controls`는 hooks 없는 표시 부품이다. 기존 음성 버튼/재생기를 재사용하며 영어 숨김과 닫기에 재생을 정리한다.
- 예문형만 기존 권한 RPC 성공 뒤 같은 배정의 승인 prompt를 읽고 `study-example-ranges`로 원문 좌표를 계산한다. 활용형을 추측하거나 원문을 바꾸지 않는다. 공유 캐시·토글 요청은 없다.
- 모달 제목·닫기는 공용 `RoutedDetailDialog` header에 둔다. 로딩·오류에도 닫기를 유지한다.
- 학생 단어장 링크는 `prefetch={false}`, `scroll={false}`이며 개인 자료 공유 캐시는 금지한다.
