# 관리자 개요·내역 작업 안내

- 내역은 표시와 시험 수정 진입을 소유한다. 배정 수정 규칙·폼·저장 계약은 `assignments`가 소유한다.
- 수정 작업은 `npm run map:flow -- assignment-edit`로 페이지, 대화상자, controller, 정책, Route,
  service, migration, 검사를 함께 확인한다.
- 다른 기능의 UI·계약을 새로 깊은 경로로 가져오지 않는다. 현재 직접 참조는 소유권 지도에 동결돼 있다.
- 내역 조회와 표시 변환에 숨은 DB 쓰기를 넣지 않는다.
