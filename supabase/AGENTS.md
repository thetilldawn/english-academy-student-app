# Supabase 변경 안내

## 변경 경계

- 기존 migration은 수정하지 않고 새 timestamp migration만 추가한다.
- RPC를 바꾸기 전에 `rg -l "<RPC 이름>" supabase/migrations`로 모든 재정의를 찾고 가장 뒤 정의를
  현재 계약으로 본다.
- 함수는 `search_path`, 실행 권한, service-role 경계를 명시하고 거래·잠금·멱등 불변식을 보존한다.
- trigger를 잠시 끄는 migration은 같은 거래 안에서 반드시 원래 상태로 복원하고 readback으로 확인한다.

## 배포 안전선

- Preview ref는 `wojxpruvbjzbhrpmsbuy`, Production ref는 `xdxhswjgksukjmpbzqgz`다.
- `supabase db push`를 쓰지 않는다. 현재 작업에 승인된 migration 한 건만 Preview에 적용한다.
- 적용 전 migration 이름·SHA-256·영향 표·복구 방법을 기록한다.
- 적용 뒤 migration history, 열·함수·권한·trigger 상태와 대표 집계를 다시 읽는다.
- Production과 실제 학생 자료는 별도 명시 승인 없이는 읽기 전용 경계도 넓히지 않고 변경하지 않는다.
