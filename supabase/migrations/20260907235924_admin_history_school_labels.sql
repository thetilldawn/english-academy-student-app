begin;

-- APP-20260908-02: use columns already read by the history helper.
-- No extra student query, personal shared cache, permission or timing change.
do $school_labels$
declare
  target regprocedure := 'private.admin_history_read_rows_v1(timestamp with time zone,uuid,uuid,uuid,text)'::regprocedure;
  definition text;
  before_owner oid;
  before_acl aclitem[];
  before_security boolean;
  before_config text[];
  anchor constant text := 'case when p_payload = ''list'' then jsonb_build_object(';
  replacement constant text := $projection$case when p_payload = 'list' then jsonb_build_object(
        'schoolName', case when classified.student_deleted then null else classified.school_name end,
        'gradeLabel', case when classified.student_deleted then null else classified.grade_label end,$projection$;
begin
  select replace(pg_get_functiondef(target), chr(13), '') into definition;
  select proowner, proacl, prosecdef, proconfig into before_owner, before_acl, before_security, before_config from pg_proc where oid = target;
  if before_security or not exists (
    select 1 from unnest(coalesce(before_config, array[]::text[])) as setting(value)
    where setting.value in ('search_path=', 'search_path=""')
  ) or (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1
    or position(replacement in definition) > 0 then
    raise exception 'admin_history_school_labels_contract_changed';
  end if;
  execute replace(definition, anchor, replacement);
  if not exists (
    select 1 from pg_proc where oid = target and proowner = before_owner
      and proacl is not distinct from before_acl and prosecdef = before_security
      and proconfig is not distinct from before_config
      and position(replacement in pg_get_functiondef(target)) > 0
  ) then raise exception 'admin_history_school_labels_metadata_changed'; end if;
end;
$school_labels$;

notify pgrst, 'reload schema';
commit;
