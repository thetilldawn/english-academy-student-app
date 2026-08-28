# 학생 관리 기능 안내

- 먼저 `npm run map:feature -- students`로 관리자 학생 page, Route Handler, 관련 배정·오답·포인트 흐름을 확인한다.
- `ui`는 검색·필터·목록·패널 표시, `controller`는 Client 입력 상태, `domain`은 학생 목록 계산을 맡는다.
- `server`는 학생 관리 화면의 조회 조합만 맡고, 기능별 조회 규칙은 각 query/service로 분리한다.
- 배정 생성·수정은 `assignments`, 배정된 시험 큐는 `assignment-queue`, 내역은 `history`, 포인트 표시는 `learning-points`의 공개 경계를 사용한다.
- 다른 기능의 내부 UI·model을 새로 직접 import하지 않는다. 필요한 공유 계약이 없으면 소유권 지도에 임시 의존과 제거 배치를 먼저 기록한다.
