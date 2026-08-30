# 단어 시험 배정·수정 작업 안내

## 먼저 확인할 흐름

- 첫 화면과 학생 선택: `npm run map:flow -- assignment-workspace-load`, `assignment-workspace-selection`
- 배정 창 자료·범위·최근 시험: `npm run map:flow -- assignment-workspace-planning`
- 단어 시험 배정: `npm run map:flow -- assignment-range-create`, `weekday-unit-allocation`
- 독립 오답 시험: `npm run map:flow -- assignment-direct-review-create`
- 기존 시험 수정: `npm run map:flow -- assignment-edit`
- 완료 뒤 자동 배정: `npm run map:flow -- assignment-series`

## 현재 구조

- `contracts/`는 브라우저·Route Handler·서버가 함께 쓰는 자료 모양과 요청 검증을 맡는다.
- `domain/`은 일정·범위·문항 배분·선택·검증처럼 환경에 의존하지 않는 계산을 맡는다.
- `application/`은 미리보기·저장·복구 절차를, `controller/`는 입력 상태·요청 수명·포커스를 맡는다.
- `transport/`만 브라우저 HTTP를 실행한다. UI에서 `fetch`하지 않는다.
- `server/queries/`는 읽기, `server/planning/`은 계획 계산, `server/persistence/`는 DB 저장,
  `server/use-cases/`는 권한·검증·계획·저장을 조합한다.
- 다른 기능은 용도에 맞는 `public-ui.ts`, `public-client.ts`, `public-server.ts`, `public-contracts.ts`만
  사용한다. 존재하지 않는 공개 파일을 억지로 만들지 않으며 내부 폴더를 직접
  가져와야 한다면 기능 지도에 이유와 제거 단계를 먼저 기록한다.

## 읽기와 캐시 경계

- 기본 진입의 첫 Server Component는 학생 목록 첫 10건만 읽는다. `reviewDraft` 복구 링크로 들어오면
  해당 초안 한 건만 추가로 읽는다. 전체 학생·전체 범위·전체 이력·전체 오답을 초기 props에 넣지 않는다.
- 선택 바구니는 화면 페이지와 독립 보존한다. 필터 전체 선택은 서버가 같은 조건으로 확정하며 최대
  210명을 원자적으로 적용한다.
- 배정 창을 열 때만 학생·단어장·시간 양식을 읽고, 단어장을 정한 뒤 그 범위만 읽는다.
- 최근 시험은 학생 1명+단어장 1개, 오답은 학생 1명 기준으로 필요한 순간에만 읽는다.
- 개인 자료 Route Handler는 성공과 오류 모두 `Cache-Control: private, no-store`를 유지한다.
  개인 자료에 `use cache`나 공유 CDN 캐시를 붙이지 않는다.
- 같은 입력의 성공 결과는 창 수명 동안 재사용하고, 입력 변경·명시 재시도·409 복구 때만 다시 읽는다.
  느린 이전 응답은 AbortSignal과 요청 지문으로 버린다.

## 저장 불변식

- 단일·일괄 범위 배정은 학생 수만 다르고 같은 `BulkAssignmentCommonPlan` 미리보기·저장 계약을 쓴다.
- 일정 미사용은 가짜 오늘 날짜가 아니라 정확히 1회, 공개·마감 모두 `NULL`인 즉시 배정이다.
- 일정 사용은 회차마다 공개·마감이 모두 있어야 하고 마감이 공개보다 뒤여야 한다.
- 같은 날 기존 시험과 겹쳐도 저장을 막거나 기존 시험을 자동 삭제하지 않는다.
- 학생 수 × 회차 수는 최대 210, 전체 생성 문항은 서버·DB 제한을 함께 지킨다.
- 완료 뒤 자동 배정은 예약 일정이 있는 나누기 계획만 허용한다. 즉시 배정은 큐를 만들지 않는다.
- 독립 오답 시험은 일반 일괄 배정의 오답 포함 옵션과 다른 계약이다. 공개 시각은 v2 저장 경로로
  전달하며, 같은 학생·단어장·오답 단계의 현재 큐를 저장 직전에 다시 확인한다.
- 기존 독립 오답 시험 수정은 원래 문제·오답 큐·단어장·범위·단어 수·출제 방향을 그대로 유지한다.
  화면 정책, 서버 준비, DB `replace_student_assignment_v7`이 같은 잠금을 적용한다.
- DB 변경은 `supabase/AGENTS.md`를 함께 적용한다. 이전 공개 함수는 순차 배포 중 끊지 말고 새 함수로
  위임한 뒤 Preview에 마이그레이션을 한 건씩 적용한다.
