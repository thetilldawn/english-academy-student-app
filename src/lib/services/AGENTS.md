# 기존 서버 서비스 작업 안내

- 이 폴더는 현재 실행 경로다. 파일의 기능 소유자는 `architecture/기능_소유권.json`에서 찾는다.
- 새 기능 전용 파일을 추가하지 말고 `src/features/<기능>/server/{queries,commands,use-cases}`를 우선한다.
- 기존 서비스를 수정할 때는 해당 기능 흐름의 Route Handler, contract, domain, migration, 통합 검사를 함께 본다.
- 읽기 함수에 정리·만료·상태 갱신 같은 숨은 쓰기를 넣지 않는다.
- 서버 전용 파일은 `server-only` 경계를 유지하고 Client controller·UI를 import하지 않는다.
- 멱등 키, plan hash, RPC 반환 계약은 임의로 재계산하거나 다른 의미의 해시와 재사용하지 않는다.
