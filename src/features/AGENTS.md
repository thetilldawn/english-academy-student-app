# 기능 폴더 작업 지침

## 시작

- 먼저 `docs/코드_길찾기_및_변경영향.md`와 `architecture/기능_소유권.json`에서 기능 ID를 찾는다.
- 현재 기능 아래에 별도 `AGENTS.md`가 있으면 그 연결표를 우선한다.
- 모든 기능에 모든 하위 계층이 필요한 것은 아니다. 실제 책임이 생길 때만 디렉터리를 만든다.

## 현재 계층 이름

- `ui`: 화면 표시·접근성. 네트워크와 업무 계산을 넣지 않는다.
- `controller`: Client 입력·탭·focus·요청 수명. DB와 server service를 가져오지 않는다.
- `domain`: React와 외부 호출을 모르는 순수 계산·검증·상태 전이.
- `application`: 미리보기·저장·충돌 복구 같은 사용 사례 순서. API 주소와 JSX를 넣지 않는다.
- `api`: 요청·응답 형태 변환. 실제 `fetch`는 `transport` 또는 기능별 명시적 API 실행 파일이 맡는다.
- `transport`: HTTP 실행과 취소 신호만 담당한다.
- `presentation`: 화면용 문구·표시 자료 변환. UI 상태와 DB를 소유하지 않는다.
- `server/queries`: 읽기만 수행하고 화면에 필요한 최소 자료를 반환한다.
- `server/commands`: 생성·수정·취소와 거래 경계를 담당한다.
- `actions`: 내부 화면 전용 변경 진입점. 업무 계산은 application/domain/command를 재사용한다.

위 이름은 현재 코드를 찾기 위한 것이다. 최종 목표 구조로 오해하지 않는다.

## 새 코드와 이동 목표

```text
features/<기능>/
  domain/
  contracts/
  presentation/
  server/
    components/
    queries/
    commands/
    use-cases/
    actions/
    http/             Route Handler 자체가 아닌 서버용 HTTP 변환기
  client/
    components/
    controllers/
    flows/
    transport/
  ui/                 hook 없는 표시 부품과 소유 CSS
  public-ui.ts
  public-contracts.ts
```

- 현재 `controller/application/api/transport`는 각각 목표 `client/controllers`, `client/flows`,
  `contracts 또는 server/http`, `client/transport`로 책임을 확인하며 옮긴다.
- `src/app/api/**/route.ts`는 계속 실제 HTTP 진입점이다. 기능의 `server/http`는 인증 뒤 호출되는
  요청·응답 변환기이며 URL 경로를 소유하지 않는다.
- Server와 Client를 하나의 `index.ts`에서 함께 내보내지 않는다.

## 의존 방향

```text
client component/ui -> client controller 또는 public-ui
client controller -> client flow/transport + domain/contract
Server Component -> server/query
Route Handler 또는 server action -> server use-case -> command/query
server -> domain/contract + DB
domain -> 외부 계층 없음
```

- 다른 feature의 `ui`나 CSS Module을 직접 가져오지 않는다.
- 둘 이상의 기능이 같은 화면 의미를 쓸 때만 `src/design-system/patterns`로 승격한다.
- 새 기능 전용 server 코드는 `src/lib/services`에 바로 추가하지 않는다. 해당 feature의 `server`를
  우선하고, 기존 서비스와 함께 있어야 한다면 소유권 지도에 임시 이유와 이동 배치를 기록한다.
- Server Component가 같은 앱의 Route Handler를 내부 HTTP로 호출하지 않는다.
- Client 파일은 `src/lib/services`, Supabase, migration 계약을 직접 가져오지 않는다.

## 변경 완료 조건

- 소유권 지도의 관련 흐름에서 모든 면을 확인했다.
- domain 규칙을 UI·Route Handler·DB 중 둘 이상에 서로 다르게 복사하지 않았다.
- 입력 계약과 화면 오류 위치가 같이 갱신됐다.
- 가까운 단위 테스트와 계층을 잇는 계약 또는 통합 테스트가 함께 존재한다.
- 새 파일 경로는 소유권 지도와 구조 검사를 통과한다.
