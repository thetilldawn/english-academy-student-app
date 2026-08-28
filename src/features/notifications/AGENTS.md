# 알림 기능 안내

- 먼저 `npm run map:feature -- notifications`로 관리자·학생 Route Handler와 계약을 확인한다.
- 이 폴더는 알림 요청·응답 계약만 소유한다. 전송 권한과 DB 기록은 서버·migration 경계에서 검증한다.
- 학생별 알림 자료는 공용 캐시에 넣지 않는다.
