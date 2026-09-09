# 단어 시험 배정·수정 작업 안내

## 먼저 확인할 흐름

- APP07 준비 조회: 같은 서버요청에서 검증한 단어장에 한해 `getPreparedAssignmentDatasetUnits`를 사용한다. 별도 단위/수정/과거/최종 저장은 기존 인증·단어장 재검증 경로를 유지한다. 초기 빈 단위도 조회한 단어장 ID와 함께 전달한다.

- 첫 화면과 학생 선택: `npm run map:flow -- assignment-workspace-load`, `assignment-workspace-selection`
- 배정 창 자료·범위·최근 시험: `npm run map:flow -- assignment-workspace-planning`
- 단어 시험 배정: `npm run map:flow -- assignment-range-create`, `weekday-unit-allocation`
- 독립 오답 시험: `npm run map:flow -- assignment-direct-review-create`
- 기존 시험 수정: `npm run map:flow -- assignment-edit`
- 완료 뒤 자동 배정: `npm run map:flow -- assignment-series`

## 현재 구조

- `contracts/`는 브라우저·Route Handler·서버가 함께 쓰는 자료 모양과 요청 검증을 맡는다.
- `domain/`은 일정·범위·문항 배분·선택·검증처럼 환경에 의존하지 않는 계산을 맡는다.
- `application/`은 미리보기·저장·복구 절차를, `controller/`는 입력 상태·요청 수명·포커스를 맡는다.
- `transport/`만 브라우저 HTTP를 실행한다. UI에서 `fetch`하지 않는다.
- `server/queries/`는 읽기, `server/planning/`은 계획 계산, `server/persistence/`는 DB 저장,
  `server/use-cases/`는 권한·검증·계획·저장을 조합한다.
- 다른 기능은 용도에 맞는 `public-ui.ts`, `public-client.ts`, `public-server.ts`, `public-contracts.ts`만
  사용한다. 존재하지 않는 공개 파일을 억지로 만들지 않으며 내부 폴더를 직접
  가져와야 한다면 기능 지도에 이유와 제거 단계를 먼저 기록한다.

## 읽기와 캐시 경계

- 기본 진입의 첫 Server Component는 학생 목록 첫 10건만 읽는다. `reviewDraft` 복구 링크로 들어오면
  해당 초안 한 건만 추가로 읽는다. 전체 학생·전체 범위·전체 이력·전체 오답을 초기 props에 넣지 않는다.
- 선택 바구니는 화면 페이지와 독립 보존한다. 필터 전체 선택은 서버가 같은 조건으로 확정하며 최대
  210명을 원자적으로 적용한다.
- 배정 창을 열 때만 학생·단어장·시간 양식을 읽고, 단어장을 정한 뒤 그 범위만 읽는다.
- 최근 시험은 학생 1명+단어장 1개, 오답은 학생 1명 기준으로 필요한 순간에만 읽는다.
- 개인 자료 Route Handler는 성공과 오류 모두 `Cache-Control: private, no-store`를 유지한다.
  개인 자료에 `use cache`나 공유 CDN 캐시를 붙이지 않는다.
- 같은 입력의 성공 결과는 창 수명 동안 재사용하고, 입력 변경·명시 재시도·409 복구 때만 다시 읽는다.
  느린 이전 응답은 AbortSignal과 요청 지문으로 버린다.
- 단어장 찾기는 `client/controllers/use-assignment-dataset-picker.ts`가 화면·초점·최근 ID를,
  `domain/assignment-dataset-picker.ts`가 최근 ID 검증을, `presentation/assignment-dataset-picker-view.ts`가
  메타데이터 기반 순수 검색·표시 변환을, `ui/assignment-dataset-picker.tsx`가
  표시를 맡는다. 검색·필터·취소·현재 항목 재선택은 기존 배정 조건을 변경하지 않는다.
  다른 항목을 확정한 경우만 기존 단어장 전환을 호출한다. 오답 후보는 기존 미배정 목록만
  허용한다. 최근 저장은 브라우저당 최대6개 ID뿐이며 학생·시험·인증 자료를 저장하지 않는다.

## 저장 불변식

- APP-20260908-03: NumericInput에서 비운 숫자는 유효0이 아닌 편집 중 값이다. domain의 숫자 완결성 결과를 application이 제공하며 controller는 이를 이용해 미리보기 세대/저장을 차단한다. 공백→전체 복구·같은 이벤트에서 공백→정상 전환도 이전 미리보기를 재사용하지 않는다. 숫자가 완성된 점수/시간 변경에는 불필요한 출제 수 재조회가 없다.
- 범위 표시는 `unit-range-display` 순수 함수로 실제 연속 DAY/과만 묶는다. 모의고사 서로 다른 시행과 끊긴 범위를 양끝 이름으로 줄이거나 생략하지 않는다. 표시 때문에 단어 수/출제 순서를 다시 계산하지 않는다.
- 선택 바구니는 학생 배열·잠금 여부·개별 콜백만 받는다. 바구니/미리보기 변경에서 전체 제어기를 자식으로 다시 전달하지 않는다. 남은 전체 초안 입력 파일은 UI 역할 대장의 후속분리 상태로 구분한다.

- APP-20260907-02: 범위 카드의 수록 합계는 metadata이고 출제 가능 수는 현재 유효 미리보기다.
  미선택/대기/실패를 0으로 표시하지 않고, 확인 전 입력칸 focus만으로 직접 수량을 저장하지 않는다.
  수량 재시도는 기존 미리보기 콜백을 재사용한다. 5xx·미분류 오류 원문 대신 요청별 쉬운 안내를 쓴다.
  모바일 범위 카드는 짧은 이름 2열·긴 이름 1열이며 높이를 내용에 맞춘다. 가로 넘침이 없으면
  가로 drag가 세로 터치를 가로채지 않는다. 수정 화면은 같은 범위 부품/합계 helper를 쓰지만
  전체 제어기 의존은 후속 분리 대상으로 남아 있으며 공통화 완료로 표현하지 않는다.

- APP09의 미리보기는 결과/진행/오류/학생 표시만, 시간 입력은 사용/시간 값/콜백만 받는다. 신규 단일·일괄/오답/수정의 연결부에서 좁은 값을 전달하고 시간 기억·계산은 기존 제어기에 둔다.

- 수량 연결은 `vocab-range-picker`의 `VocabQuestionSection`이 맡는다. `vocab-question-fields`와
  `vocab-unit-allocation-fields`는 수량/방식/표시값/개별 콜백만 받으며, 요약은 `presentation/vocab-question-view`다.
- `architecture/assignment-ui-roles.json`은 모든 UI TS/TSX의 역할·현재 의존을 등록한다. 순수/상호작용
  부품은 전체 제어기·초안을 받을 수 없다. `ui-role-boundary.test.ts`가 타입 별칭/인덱스/Pick/ReturnType/펼치기를 검사한다.
  후속 분리 파일은 등록한 소스 지문을 넘어 변경할 때 해당 작업의 의존/전체 상태 검토와 근거를 함께 갱신한다.
  연결부 예외를 자식에 상속시키거나 후속 분리 파일을 완료된 공통 부품으로 표현하지 않는다.

- 오답 전용 연결부는 `direct-review-assignment-sections`다. `direct-review-range-fields`와
  `direct-review-preview`는 필요한 표시값/관련 오류/개별 콜백만 받는다. 준비·계산 상태/시각 문구는
  `presentation/direct-review-view`에서 만든다. 미조회/실패를 정상0개로 표시하지 않는다.

- 공통 시험 조건 표시는 `ui/exam-condition-fields.tsx`에서 신규 단일/일괄·독립 오답·기존 수정이 재사용한다.
  값/관련 오류/개별 콜백만 전달하며, 수정 잠금은 기존 fieldPolicy를 따른다. 일괄 UI로 다시 의존시키지 않는다.
- `domain/assignment-question-mode-policy.ts`는 유형의 방향·단일 즉시 일정 제한과 준비 상태를,
  `presentation/assignment-question-mode-view.ts`는 한국어 안내와 탭 상태를 만든다. 초안·요청·서버의
  제한 판정도 같은 정책을 사용한다. 유형 제한 확대와 전환 시 범위 자동변경은 별도 업무 결정이다.

- 출제 유형의 활성 여부는 선택 단어장의 `availableQuestionModes`를 기준으로 한다. 단어장 미선택,
  준비 정보 누락, 정상 조회에서 문항 없음은 다른 상태다. 이 조회는 실제 검토 진행 상황을
  반환하지 않으므로 `검토 중`이라고 추정하지 않는다. 미검토 문항을 강제 활성화하지 않는다.
- controller의 안전한 교재 뜻 기본값과 서버에서 받은 준비 정보는 구분한다. 화면은 원래 준비 정보로
  이유를 표시하고 배정 검증은 기존 허용 유형을 유지한다. 단어장 전체 준비와 선택 DAY별 문항 수는
  별개이므로 최종 범위 미리보기 검증을 생략하지 않는다.
- 검색 연결 검사는 내부 선택창만 가짜 부품으로 바꾸지 않는다. 실제 학생 행·일괄 준비·학생 지정
  주소에서 공용 준비 흐름과 검색창까지 확인하는 `ui/assignment-workspace.test.tsx`를 함께 실행한다.

- 단일·일괄 범위 배정은 학생 수만 다르고 같은 `BulkAssignmentCommonPlan` 미리보기·저장 계약을 쓴다.
- 일정 미사용 또는 시험일 사용 중 요일0개는 가짜 날짜나 별도 수량 조회용 일정을 만들지 않는다.
  `전체 범위`는 날짜 `NULL`인 1회, `회차별`은 단위 수로 전체 범위를, `단어 수`는 실제 출제
  가능 수를 회차당 수량으로 끝까지 나눈다. 각 회차 공개·마감은 모두 `NULL`이며 앞 회차의 첫
  시험 완료에 따라 다음 회차를 공개한다. 날짜 없는 단어 수 요청은 기준1회를 전송하고 서버가
  학생별 실제 수량으로 확장하며 최대210회/전체10000문항을 확장한 결과에 적용한다.
- 일정 사용은 회차마다 공개·마감이 모두 있어야 하고 마감이 공개보다 뒤여야 한다.
- 같은 날 기존 시험과 겹쳐도 저장을 막거나 기존 시험을 자동 삭제하지 않는다.
- 학생 수 × 회차 수는 최대 210, 전체 생성 문항은 서버·DB 제한을 함께 지킨다.
- 완료 뒤 자동 배정은 예약 일정이 있는 나누기 계획만 허용한다. 즉시 배정은 큐를 만들지 않는다.
- 독립 오답 시험은 일반 일괄 배정의 오답 포함 옵션과 다른 계약이다. 공개 시각은 v2 저장 경로로
  전달하며, 같은 학생·단어장·오답 단계의 현재 큐를 저장 직전에 다시 확인한다.
- 기존 독립 오답 시험 수정은 원래 문제·오답 큐·단어장·범위·단어 수·출제 방향을 그대로 유지한다.
  화면 정책, 서버 준비, DB `replace_student_assignment_v7`이 같은 잠금을 적용한다.
- DB 변경은 `supabase/AGENTS.md`를 함께 적용한다. 이전 공개 함수는 순차 배포 중 끊지 말고 새 함수로
  위임한 뒤 Preview에 마이그레이션을 한 건씩 적용한다.

- 준비된 예문은 영어 선택 방향0을 유지하며 공통 회차별/단어수별/날짜 계획을 사용한다. 유형 전환만으로 시험일을 끄지 않는다. 회차별 출제 부족은 보이는 범위 입력, 직접 수량 부족은 단어 수 입력, 전체 상한은 미리보기로 오류를 연결한다.
