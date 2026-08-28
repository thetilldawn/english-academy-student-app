# 공유 시험 계산 작업 안내

이 폴더는 배정 생성, 학생 시험, 결과·오답이 함께 사용하는 순수 계산과 자료 형태를 둔다.

## 파일을 찾는 기준

- 문항·선택지 생성: `question-generator.ts`, `choice-policy.ts`, `mixed-question-planner.ts`
- 무작위 처리: `random.ts`
- 단어 동일성·출제 가능 여부: `word-identity.ts`, `eligible-vocabulary.ts`
- 발음·출처 snapshot: `pronunciation-snapshot.ts`, `question-provenance.ts`
- 학생 풀이 표시 보조: `prior-wrong.ts`
- 결과 표시 계산: `result-presentation.ts`

## 경계

- React, `fetch`, Route Handler, Supabase client를 넣지 않는다.
- 현재 운영에서 사용하지 않는 계산을 다른 흐름에 억지로 연결하지 않는다.
- 문항 생성 규칙을 바꾸면 `assignment-range-create`, `assignment-edit`,
  `student-quiz-attempt` 중 실제 영향 흐름을 `npm run map:flow -- <흐름>`으로 확인한다.
- 새 운영 파일은 `architecture/기능_소유권.json`의 `quizCoreOwners`에 등록하지 않으면
  구조 검사가 실패해야 한다.
- 서버에서 자료를 읽거나 저장하는 코드는 `src/lib/services/quiz`의 현재 경로 또는
  목표 기능의 `server` 계층이 담당한다.
