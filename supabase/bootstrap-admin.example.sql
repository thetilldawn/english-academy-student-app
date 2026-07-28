-- 1. Supabase Authentication > Users에서 관리자 계정을 먼저 직접 만든다.
-- 2. 아래 이메일과 표시이름만 바꿔 SQL Editor에서 실행한다.
-- 3. 공개 회원가입은 계속 꺼둔다.

insert into public.admin_profiles (
  user_id,
  display_name,
  is_active
)
select
  id,
  '관리자',
  true
from auth.users
where lower(email) = lower('ADMIN_EMAIL_REPLACE_ME')
on conflict (user_id)
do update set
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();
