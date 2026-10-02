# 관리자 Route Handler 작업 안내

- APP-20261002-01: 혼합 미리보기와 저장의 새 `planVersion` 계약은 assignments 공개 서버/계약으로 연결한다. 구형 저장 요청은 기존 엄격한 입력 검사를 유지한다. 학생·후보·문항 선택 및 배분 계산을 이 진입점에 넣지 않으며 신형 성공 응답을 구형 형식으로 간주하지 않는다.

- 실제 HTTP 진입점이다. `src/features/assignments/api`의 변환기와 혼동하지 않는다.
- 인증, Zod/요청 계약 해석, service 호출, 상태 코드와 캐시 헤더만 둔다.
- 날짜·범위·요일·문항 배분 같은 업무 계산을 Route Handler에 복사하지 않는다.
- 배정 생성·교체·취소는 409/422/503, 취소 신호, 멱등 복구 계약이 있어 기본적으로 Route Handler를
  유지한다. 단순 폼 저장과 동일하게 보고 Server Action으로 임의 전환하지 않는다.
- 새 Route Handler를 만들면 같은 변경에서 `architecture/기능_소유권.json`의 소유자와 기능 흐름을
  등록한다.
