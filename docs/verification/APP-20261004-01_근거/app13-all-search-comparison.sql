begin read only;set local statement_timeout='60s';with started as materialized(select clock_timestamp() at),results as materialized(select p_template.id, private.vocabulary_library_template_search_v1(p_template) old_value,(select lower(concat_ws(' ',p_template.metadata->>'title',p_template.metadata->>'tags',p_template.metadata->>'school',
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
   )))) new_value from private.vocabulary_library_templates p_template cross join started where p_template.deleted_at is null) select id,encode(extensions.digest(old_value,'sha256'),'hex') old_sha256,encode(extensions.digest(new_value,'sha256'),'hex') new_sha256,length(old_value) characters,extract(epoch from clock_timestamp()-started.at)*1000 elapsed_ms from results cross join started order by id;commit;
