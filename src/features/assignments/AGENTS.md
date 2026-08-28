# 단어 시험 배정·수정 작업 안내

## 먼저 출력할 기능 흐름

- 공통 작업공간·학생 선택: `npm run map:flow -- assignment-workspace-load`
- 일반 단일·일괄 범위 배정: `npm run map:flow -- assignment-range-create`
- 요일별 범위·단어 수: `npm run map:flow -- weekday-unit-allocation`
- 독립 오답 시험: `npm run map:flow -- assignment-direct-review-create`
- 기존 시험 수정: `npm run map:flow -- assignment-edit`
- 완료 뒤 이어지는 배정: `npm run map:flow -- assignment-series`

위 목록은 업무 흐름 6개 중 배정 기능이 참여하는 5개와 공통 작업공간 흐름 1개다. 학생 시험 진행은
`student-quiz-attempt`가 별도로 소유한다. 초기 자료·학생 필터를 고칠 때는 공통 작업공간 흐름을 먼저 보고,
범위·요일·오답의 실제 저장 규칙과 한 흐름으로 섞지 않는다.

## 현재 실행 경로

- 단일 배정과 일괄 배정은 학생 선택 방식만 다르고 둘 다 `VocabAssignmentPlanner`와
  `/api/admin/bulk-assignments[/preview]`를 사용한다.
- 독립 오답 시험만 현재 `application` 흐름을 온전히 사용한다. 범위 배정과 수정 controller는 아직
  요청 생명주기를 직접 소유한다.
- 시험 수정은 배정 페이지가 아니라 관리자 개요·내역의 `EditableHistoryDetail*`에서 시작해
  `SingleAssignmentEditor`를 사용한다.
- `api` 폴더는 Route Handler가 아니라 직렬화 가능한 요청·응답 변환기다. 실제 HTTP 경로는
  `src/app/api`다.
- 서버 조합은 아직 `src/lib/services`, 서버 요청 계약은 `src/lib/admin`에 있다. 목표인
  `server/{components,queries,commands,use-cases,actions,http}`와 `contracts`가 이미 구현됐다고
  가정하지 않는다. 여기서 `server/http`는 실제 Route Handler가 아니라 인증 뒤 쓰는 서버 변환기다.

## 사용 중이 아닌 경로

- `BulkAssignmentEditor`는 현재 importer가 없는 구형 화면이다.
- `/api/admin/assignments` POST와 `SingleAssignmentEditor` 생성 모드는 현재 단일 배정 화면의 실행 경로가 아니다.
- `mixed-assignments`, `review-assignments`는 독립 오답 시험의 현재 경로가 아니라 호환·복구용 경로다.

## 함께 지킬 불변식

- UI와 server가 요일·범위·단어 수를 따로 계산하지 않고 같은 domain 계약을 사용한다.
- 미래 공개 시각, 마감 이후 금지, 학생·자료 범위, 문항 snapshot, 멱등 요청 해시를 server에서 다시 검증한다.
- 이어지는 배정은 생성(assignments), 표시·처리(assignment-queue), 시험 완료 촉발(quiz-player)에 걸친다.
- R2-3에서는 구체적인 `unit_ids`뿐 아니라 `same/by_weekday`, 공통·요일별 단위 수 원래 규칙을
  버전 자료로 보존해야 한다. 조건 복사와 큐 설명에서 역산하지 않는다.
- DB 변경은 `supabase/AGENTS.md`를 함께 적용하고 최종 schema 통합 검사를 돌린다.
