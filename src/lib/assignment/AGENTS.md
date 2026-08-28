# 공유 배정 계산 작업 안내

현재 이 폴더의 `question-planner.ts`는 일반 범위 배정, 독립 오답 배정, 시험 수정, 이어지는 배정 생성이
함께 사용하는 순수 문항 계획 경계다.

- React, HTTP, Supabase client, 저장 명령을 넣지 않는다.
- 선택지·문항 생성의 더 작은 공용 규칙은 `src/lib/quiz`를 사용한다.
- 변경 전에 `assignment-range-create`, `assignment-direct-review-create`, `assignment-edit`,
  `assignment-series` 네 흐름을 모두 출력한다.
- 새 운영 파일은 `architecture/기능_소유권.json`의 `assignmentCoreOwners`에 등록해야 한다.
- 장기 목표에서는 배정 기능의 `domain`으로 이동하되, 네 호출 흐름과 테스트를 함께 전환한 배치에서만
  기존 경로를 제거한다.
