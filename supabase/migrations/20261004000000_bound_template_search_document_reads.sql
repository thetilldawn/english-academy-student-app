-- APP-20261004-01: extract only the latest included keys once per search.
-- Preserve the exact classification and occurrence membership semantics.
begin;
create temporary table app13_search_meta on commit drop as
select to_jsonb(p)-'prosrc' value from pg_proc p
where p.oid='private.vocabulary_library_template_search_v1(private.vocabulary_library_templates)'::regprocedure;
do $guard$
begin
 if not exists (select 1 from pg_proc p where p.oid='private.vocabulary_library_template_search_v1(private.vocabulary_library_templates)'::regprocedure
   and md5(replace(p.prosrc,E'\r\n',E'\n')) in ('e841349184a4aaec37cd48e1f9474f83','31d96ce16e409440078f0bbecc4ee4eb')) then
  raise exception 'unexpected_template_search_body' using errcode='55000';
 end if;
end;
$guard$;
create or replace function private.vocabulary_library_template_search_v1(p_template private.vocabulary_library_templates)
returns text language sql stable security definer set search_path=public,private,pg_temp as $$
 select lower(concat_ws(' ',p_template.metadata->>'title',p_template.metadata->>'tags',p_template.metadata->>'school',
   p_template.metadata->>'targetGrade',p_template.metadata->>'schoolYear',(p_template.metadata->>'semester')||'학기',
   p_template.metadata->>'assessment',p_template.metadata->>'purpose',(
     with latest as materialized (
       select recipe,fixed_composition->'includedKeys' included_keys from private.vocabulary_library_versions
       where template_id=p_template.id order by number desc limit 1
     ) select string_agg(concat_ws(' ',
       case c->>'kind' when 'mock' then '모의고사 모고' when 'csat' then '수능' when 'textbook' then '교과서' when 'wordbook' then '단어장' when 'school' then '학교 자료' else '분류 확인' end,
       case c->>'sourceGrade' when 'g7' then '중1' when 'g8' then '중2' when 'g9' then '중3' when 'g10' then '고1' when 'g11' then '고2' when 'g12' then '고3' end,
       (c#>>'{exam,executionYear}')||'년',case when c->>'kind'='mock' then (c#>>'{exam,examMonth}')||'월' end,
       case when c->>'kind'='csat' then (c#>>'{exam,academicYear}')||'학년도' end,c#>>'{exam,typeLabel}',
       'DAY '||(c->>'day'),(c->>'lesson')||'과'),' ')
     from latest v
     cross join lateral jsonb_array_elements(v.recipe->'scopes') ref
     join private.vocabulary_library_scopes s on s.id=(ref->>'id')::uuid and s.version=ref->>'version'
     cross join lateral (select s.payload->'classification' c) classification
     where exists(select 1 from private.vocabulary_library_scope_rows r where r.scope_id=s.id and v.included_keys ? r.occurrence_key)
   )))
$$;
do $verify$
begin
 if not exists (select 1 from app13_search_meta) or not exists (
   select 1 from pg_proc p where p.oid='private.vocabulary_library_template_search_v1(private.vocabulary_library_templates)'::regprocedure
    and (to_jsonb(p)-'prosrc')=(select value from app13_search_meta)
 ) then raise exception 'template_search_metadata_changed' using errcode='55000'; end if;
end;
$verify$;
commit;
