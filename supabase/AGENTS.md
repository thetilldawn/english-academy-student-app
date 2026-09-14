# Supabase 변경 안내

## 변경 경계

- 기존 migration은 수정하지 않고 새 timestamp migration만 추가한다.
- RPC를 바꾸기 전에 `rg -l "<RPC 이름>" supabase/migrations`로 모든 재정의를 찾고 가장 뒤 정의를
  현재 계약으로 본다.
- 함수는 `search_path`, 실행 권한, service-role 경계를 명시하고 거래·잠금·멱등 불변식을 보존한다.
- trigger를 잠시 끄는 migration은 같은 거래 안에서 반드시 원래 상태로 복원하고 readback으로 확인한다.

## 배포 안전선

- 승인 학교 발음 범위는 `20260906103017_add_approved_school_pronunciation_scope.sql`에 한정한다.
  기존 v3 identity/binding/verify/activate를 재사용하며 학생·응시나 옛 음원은 수정하지 않는다.

- Preview ref는 `wojxpruvbjzbhrpmsbuy`, Production ref는 `xdxhswjgksukjmpbzqgz`다.
- `supabase db push`를 쓰지 않는다. 현재 작업에 승인된 migration 한 건만 Preview에 적용한다.
- 적용 전 migration 이름·SHA-256·영향 표·복구 방법을 기록한다.
- 적용 뒤 migration history, 열·함수·권한·trigger 상태와 대표 집계를 다시 읽는다.
- Production과 실제 학생 자료는 별도 명시 승인 없이는 읽기 전용 경계도 넓히지 않고 변경하지 않는다.

- `20260914085457_allow_school_handout_meaning_only.sql`: 학교 승인2배는 교재 뜻 양방향 각1개·숨김0만 허용한다. 네 방향의 기존 검사와 원문/발음/권한 보호는 유지한다.

- APP-20260914-05: 원문 불변 연결판은 기존 등록판·행 확인값·출처에 고정하고 승인된 기존 발음 검사와 서비스 전용 조회를 재사용한다.
- APP-20260915-01: 검토한 누락 발음·처리 음원은 private 자산 승인표와 원문/이전 연결판 확인값에 고정한다. 새 표기/음원은 검토 원천과 연결하고, 기존 처리본은 원음·품사·표기를 보존한다. 원파일 문자열로 승인하며 숫자 표기를 재직렬화하지 않는다. 원고·문항·학생 기록은 유지하고 동일 거래에서 연결판만 전환한다.
