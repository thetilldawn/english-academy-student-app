# 학생 세션 기능 안내

- 먼저 `npm run map:feature -- session`으로 세션 갱신 진입점과 계약을 확인한다.
- 이 폴더는 브라우저의 세션 갱신 요청과 상태 표시만 맡는다.
- 쿠키 수명·권한·학생 식별은 `src/lib/auth`와 `src/lib/supabase` 경계에서 처리하며 Client에 비밀 값을 노출하지 않는다.
