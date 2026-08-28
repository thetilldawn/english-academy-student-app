# src 작업 안내

## 시작 순서

1. `../architecture/기능_소유권.json`에서 기능 ID를 찾는다.
2. 기능은 `npm run map:feature -- <기능 ID>`, 공용 기반은 `npm run map:owner -- <소유 범주 ID>`로 소유 경로를 확인하고 `npm run map:flow -- <실행 흐름 ID>`로 연결된 전체 경로를 출력한다.
3. 수정할 경로 아래의 가장 가까운 `AGENTS.md`를 읽는다.
4. `../docs/코드_길찾기_및_변경영향.md`의 변경 영향표를 채운다.

## 큰 경계

- `app`: URL, 인증 진입, Server Component 조합, 얇은 Route Handler만 둔다.
- `features`: 기능이 소유하는 UI·상태·계산·계약·서버 경계를 둔다.
- `design-system`: 특정 기능을 모르는 공용 UI만 둔다.
- `lib/services`: 현재 서버 기능의 임시 위치다. 새 기능 전용 서비스를 추가하지 않는다.
- Client 코드는 `server`, `lib/services`, Supabase client를 직접 가져오지 않는다.
- 다른 기능의 내부 파일을 새로 직접 가져오지 않는다. 교차 사용은 향후 `public-ui.ts` 또는
  `public-contracts.ts`로 공개한 뒤 사용한다.

목표 구조는 현재 구조가 아니다. 파일 이동은 사용처를 전환하고 구조 검사를 통과한 배치에서만 완료로 본다.
