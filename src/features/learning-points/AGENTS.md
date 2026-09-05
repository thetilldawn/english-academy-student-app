# 포인트 표시 기능 안내

- 먼저 `npm run map:feature -- learning-points`로 화면·계약·관련 실행 흐름을 확인한다.
- 이 폴더는 포인트 합계의 화면 표시와 표시용 변환만 맡는다.
- 점수 발생 규칙과 합산 불변식은 DB migration 및 서버 명령의 책임이다. UI에 계산식을 복사하지 않는다.
- 학생에게는 합계가 0보다 작게 보이지 않도록 하는 표시 규칙과 실제 원장 값을 구분한다.

## 학생 공통 상단

- `@summary/page.tsx`와 `@summary/[...catchAll]`이 같은 학생 URL의 포인트 영역을 서버에서 조합한다. 루트 page와 optional catch-all은 충돌하므로 합치지 않는다. layout에 처음 읽은 숫자를 고정하거나 Client 전역 저장소에 복제하지 않는다.
- `server/components/student-header-points.tsx`는 자체 학생 인증 후 기존 집계만 읽는다. 시험 진행은 표시·포인트 조회 없이 반환한다.
- 결과는 기존 `getStudentAttemptPointSummary`를 공유하고 과거 사건이 없는 경우만 현재 합계로 보완한다. 두 공유 읽기는 module-scope React `cache()`로 같은 RSC 요청 안에서만 중복 제거한다.
- 실패는 `확인 불가`, 로딩은 `확인 중`이며 실제 0으로 대체하지 않는다. 원장·지급 규칙·권한을 변경하지 않는다.
- 공통 shell은 history/BFCache 복원에서만 갱신한다. 일반 경로 이동이나 진행 중 시험에 전체 refresh를 추가하지 않는다.
- 단어장 모달에서 돌아갈 때는 포인트 변화가 없으므로 history 갱신을 하지 않는다. 완료 내역 더보기와 스크롤 맥락을 보존한다.
