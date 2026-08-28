# 이어지는 배정 작업 안내

- 전체 경로는 `npm run map:flow -- assignment-series`로 확인한다.
- 이 기능은 관리자·학생에게 큐 상태를 표시하고 큐를 처리하는 부분을 소유한다.
- 큐 생성 조건과 범위 계산은 `assignments`, 시험 완료 뒤 다음 시험 생성 촉발은 `quiz-player`와
  `src/lib/services/quiz/attempt-command.ts`에 있다. 한 폴더만 고치고 완료하지 않는다.
- 같은 완료 이벤트가 재실행돼도 다음 시험을 중복 생성하지 않아야 한다.
- 남은 범위, 원래 범위, 남은 횟수, 계획 요일을 DB의 명시 자료에서 읽고 화면 문구로 역산하지 않는다.
