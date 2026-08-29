# R3-S 학생 메인 읽기 모델

## 목적

학생 첫 화면이 배정 ID 전체를 모은 뒤 `assignments`, 모든 `quiz_attempts`, `assignment_units`, 단어장
표시 자료를 여러 번 `.in(...)` 조회하던 경로를 없앤다. 현재 행동은 유지하면서 다음 형태로 줄인다.

- 응시 전·진행 중·재시험 필요·종료된 시험: 현재 화면에 필요한 전체만 반환
- 완료 시험: 최신 10건과 안정적인 복합 커서만 반환
- 상태별 개수: 초기 목록과 같은 DB 기준 시각에서 함께 계산
- 현재 포인트: 기존 전용 조회를 초기 목록과 병렬 시작
- 완료 `10개 더보기`: 학생 세션을 다시 확인하는 Route Handler에서만 실행

## Next.js 경계

- 보호 layout과 `requireStudentSession()`의 React 요청 캐시는 그대로 사용한다.
- 페이지는 세션 확인 뒤 학생 메인 서버 구성요소를 바로 조합한다.
- 학생 메인 서버 구성요소는 같은 `snapshotAt`의 목록·상태 개수 조회와 기존 포인트 조회를
  `Promise.all`로 병렬 시작한다.
- 최초 자료는 Server Component가 기능 서버 query를 직접 호출한다. 앱 자신의 Route Handler를 다시
  HTTP로 호출하지 않는다.
- 목록이 준비되는 동안에는 학생 메인 전용 `Suspense` 대체 화면만 점진 표시한다.
- 완료 더보기만 `controller → transport → POST Route Handler`를 사용한다.
- 학생별 배정·응시·점수는 `use cache`나 공유 캐시에 넣지 않는다. HTTP 응답도
  `Cache-Control: private, no-store`다.

## DB 읽기 계약

학생 세션은 Supabase Auth가 아니라 앱 전용 쿠키와 `student_sessions`로 검증한다. 따라서 새 공개 RPC는
`authenticated`에 열지 않는다.

- 모든 함수: `SECURITY INVOKER`, 빈 `search_path`, `STABLE`
- 실행 권한: `service_role`만 허용
- 호출 전제: RSC와 Route Handler가 `StudentSession`을 먼저 확인하고 그 세션의 `studentId`만 전달
- 최신 응시: `(student_id, assignment_id, attempt_number)` 기준에서 스냅샷 시각 이전 한 건
- 완료 커서: `effective_at DESC, assignment_id ASC`
- 시간 제한 없음: DB의 `deadline_at='infinity'` 의미는 유지하고 화면 계약에서는 `null`
- 인덱스: Preview `EXPLAIN` 전에는 추측으로 추가하지 않음

공개 읽기 함수는 다음 두 개다.

1. `get_student_dashboard_initial_v1`: 현재 시험 전체, 완료 10+1건, 같은 스냅샷의 다섯 상태 개수
2. `list_student_dashboard_completed_page_v1`: 같은 스냅샷의 완료 다음 10+1건

포인트는 이 기능의 DB 투영에 섞지 않고 기존 `getStudentPointBalance()`를 유지한다. 시험 목록과
포인트의 갱신 시각이 같다고 가장하지 않으며, 서버 구성요소에서 서로 독립적으로 병렬 조회한다.

## 변경 영향표

| 확인 면 | 결과 | 근거 |
|---|---|---|
| 경로·Server Component | 변경 | 학생 페이지가 기능 서버 component를 `Suspense`로 조합 |
| 화면 UI | 변경 | 현재 구역은 서버 렌더, 완료 구역만 10건 더보기 Client 경계 |
| 브라우저 상태 | 변경 | 완료 커서·요청 중·오류·취소만 controller가 소유 |
| 순수 계산·검증 | 변경·검산 | 기존 학생 생명주기·구역 분류와 DB 분류의 상태 일치 검사를 추가 |
| 사용 사례 흐름 | 해당 없음 | 읽기 controller가 전용 transport를 직접 호출 |
| 요청·응답 변환 | 변경 | 직렬화 가능한 학생 메인 계약과 완료 페이지 전송 추가 |
| Route Handler | 변경 | 완료 더보기 POST 한 개 추가 |
| 서버 조회 | 변경 | 기능 전용 query·행 계약·커서로 이동, 기존 전체 조회 제거 |
| DB 스키마·RPC·권한 | 변경 | 내부 공통 투영 1개와 공개 읽기 2개, Preview에만 개별 적용 |
| 캐시·갱신 | 확인만 | 개인 자료 공유 캐시 금지, private no-store 유지 |
| 로딩·Streaming | 변경 | 인증 뒤 학생 메인 목록만 `Suspense`로 점진 표시 |
| 자동검사·Preview | 변경 | 0·1·10·11·21, 동률·신규행·권한·RSC 크기와 실제 화면 확인 |

## 완료 조건

- 첫 RSC props에 과거 완료 전체 배열과 전체 배정 ID 배열이 없다.
- 0·1·10·11·21건과 마지막 페이지에서 누락·중복이 없다.
- 같은 완료 시각과 페이지 조회 중 새 완료가 생겨도 기존 커서는 안정적이다.
- 활성·재시험·미응시·완료 구역, 카드 행동, 현재 포인트가 전환 전과 같다.
- Preview에서 읽은 행 수·응답 크기·실행 계획을 기록하고 브라우저 warning/error 0건을 확인한다.
- Production과 실제 학생은 변경하지 않는다.
