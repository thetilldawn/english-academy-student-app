# lib 작업 안내

- 특정 기능 하나만 쓰는 새 코드는 그 기능 폴더에 둔다.
- `lib/admin`은 React·네트워크·DB client를 모르는 순수 계약과 정책만 둔다.
- `lib/services`는 기존 서버 조합의 현재 위치이며 R3~R6 이동 대상이다. 새 기능 전용 서비스의 기본 위치가 아니다.
- `lib/auth`, `lib/supabase`, `lib/database`는 각각 인증, DB client 경계, DB 계약 검사만 소유한다.
- `lib/network`는 기능과 무관한 요청 취소·전체 응답 시간 예산만 소유한다. 저장 명령의 제한 시간은
  명시적인 별도 정책 없이 이 공용 예산에 넣지 않는다.
- `lib/assignment`, `lib/quiz`는 여러 흐름이 공유하는 순수 계산이며 React·DB client를 넣지 않는다.
- `lib/observability`, `lib/deploy`는 서버 오류 기록과 배포 환경 계약만 맡는다.
- `lib/ui`는 기능에 종속되지 않은 표시 계산, `lib/vocab`은 단어 자료 투입 계약만 맡는다.
- 새 `lib` 바로 아래 디렉터리나 파일을 추가하면 `architecture/기능_소유권.json`의 기반 영역 등록과
  `npm run verify:feature-map`을 함께 갱신한다.
- 기능별 위치를 찾을 때는 `npm run map:feature -- <기능 ID>`, 한 실행 경로를 볼 때는
  `npm run map:flow -- <실행 흐름 ID>`를 먼저 사용한다.
- 인증·DB client·공용 계약처럼 기능 하나에 속하지 않는 파일은
  `npm run map:owner -- shared-infra|shared-contract|database-contract`로 먼저 찾는다.
