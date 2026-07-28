# Supabase 원격 적용 검증

- 적용일: 2026-07-29
- 프로젝트: `english-academy-student-app`
- 리전: `ap-northeast-2`
- 생성 비용 확인값: 월 0원
- 실제 학생정보: 0건
- 실제 시험·성적: 0건

## 적용 결과

| 항목 | 결과 |
|---|---:|
| 원격 마이그레이션 | 2개 |
| `public` 테이블 | 13개 |
| RLS 활성 테이블 | 13개 |
| RLS 정책 | 13개 |
| 누락 외래키 선두 인덱스 | 0개 |
| `authenticated`의 SELECT 외 테이블 권한 | 0개 |
| 관리자 프로필 | 0건 |
| 학생 | 0건 |
| 어휘 데이터셋·항목 | 0건 |
| 시험 배정·응시 | 0건 |

적용 마이그레이션:

1. `initial_student_app_mvp`
2. `harden_admin_rpc_wrappers`

## 보안 검증

- 공개 스키마의 `SECURITY DEFINER` 함수: 0개
- 관리자 쓰기 RPC 4개: 공개 래퍼는 모두 `SECURITY INVOKER`
- 실제 권한상승 구현: `private` 스키마
- `anon`의 공개·비공개 관리자 쓰기 함수 실행권한: 없음
- `authenticated`의 관리자 쓰기 함수 실행권한: 있음
- 실제 쓰기 전 각 비공개 함수에서 활성 `admin_profiles`를 재검사
- Supabase Security Advisor: 경고 0건

Performance Advisor의 알림 20건은 데이터와 실행 이력이 0건인 직후 모든
새 인덱스가 미사용으로 집계된 정보성 알림이다. 운영 데이터가 생기기
전에는 제거하지 않는다.

## Hosted Auth 현재 상태

- 공개 설정 API 확인값: `disable_signup=false`
- 이메일 가입 제공자: 켜짐
- 익명·전화·외부 OAuth 제공자: 꺼짐

DB의 RLS와 활성 관리자 검사는 일반 인증 사용자의 관리자 접근을
차단하지만, 불필요한 Auth 계정 생성을 막기 위해 배포 전에 대시보드의
`Allow new users to sign up`을 꺼야 한다.

## 아직 필요한 사용자 보안 설정

- Hosted Auth의 `Allow new users to sign up` 끄기
- Supabase Secret key를 `.env.local`과 Vercel에 직접 등록
- 관리자 Auth 계정 생성과 `admin_profiles` 등록

Secret key 값은 채팅·Git·보고서에 기록하지 않는다.
