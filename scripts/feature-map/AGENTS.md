# 기능 지도 검사기 안내

이 폴더는 앱 실행 코드가 아니라 `architecture/기능_소유권.json`을 검증하고 변경 영향을 안내하는 구조 보호선이다.

## 파일 책임

- `common.mjs`: 경로 정규화, 파일 목록, 해시, 공통 상수
- `import-graph.mjs`: TypeScript import 분석과 기능 간 의존 관계 수집
- `runtime-flow.mjs`: 사용자 행동 흐름의 UI→상태→서버→계약·계산 실행 경로 자동 추적
- `flow-verification.mjs`: 흐름 메타자료·실제 import 간선·진입점·예외 검증
- `change-impact.mjs`: Git 변경 파일을 소유 기능과 실행 흐름에 연결
- `owner-output.mjs`: 기능·공용 소유 범주의 사람이 읽는 길찾기 출력
- `ownership-catalog.mjs`: 검사·변경 영향·출력이 함께 쓰는 정확한 소유 목록과 표시 이름
- 상위 `scripts/check-feature-map.mjs`: 등록부 전체 검증과 명령 진입점

한 파일을 고칠 때 다른 책임을 끌어오지 않는다. import 문법 지원은 `import-graph`, 흐름 의미는 `runtime-flow`, Git 비교 기준은 `change-impact`, 소유 범주 추가는 `ownership-catalog`, 파일 수·Next.js 진입점·migration 보호는 상위 검사기에서 다룬다.

## 확인 명령

- 전체 등록 검증: `npm run verify:feature-map`
- 기능 찾기: `npm run map:feature -- <기능 ID>`
- 공용 소유 범주 찾기: `npm run map:owner -- <소유 범주 ID>`
- 사용자 행동 흐름 찾기: `npm run map:flow -- <흐름 ID>`
- 현재 변경 영향: `npm run map:changed`

새 검사 모듈을 추가하면 `architectureGuardOwners`와 상위 검사기의 `actualArchitectureGuards` 인벤토리에 함께 등록한다.
