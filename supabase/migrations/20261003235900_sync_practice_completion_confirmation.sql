-- APP-20261001-05-SYNC: reconcile a Preview reader missing M11 while retaining M02/M03.
-- The normal chronological rollout already has the final definition and is a no-op.
-- This migration does not update student rows or fabricate the skipped migration history.
begin;

do $sync$
declare
  target oid := to_regprocedure('private.word_practice_read_v1(private.student_word_practice_runs)');
  definition text;
  body_hash text;
  definition_hash text;
  before_meta jsonb;
  after_meta jsonb;
  old_parts text[] := array[
    '  finished:=p_run.status<>''in_progress'' or at_time>=p_run.deadline_at;',
    '  state:=case when p_run.status=''in_progress'' and finished then ''expired'' else p_run.status end;',
    '  return jsonb_build_object(''attempt'',jsonb_build_object('
  ];
  new_parts text[] := array[
    E'  -- A zero clock requests the existing expiry/timeout command. A read must not\n  -- invent a committed result or reveal unanswered keys before that command.\n  finished:=p_run.status<>''in_progress'';',
    '  state:=p_run.status;',
    '  return jsonb_build_object(''completionConfirmed'',p_run.status in (''completed'',''expired''),''attempt'',jsonb_build_object('
  ];
begin
  if target is null then
    raise exception using errcode='55000', message='m11_sync_missing_reader';
  end if;
  select pg_get_functiondef(p.oid),
    encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    to_jsonb(p)-'prosrc'
    into definition,body_hash,definition_hash,before_meta
    from pg_proc p where p.oid=target;

  if body_hash='fa14f11cc322f2da9e300997b4cb20fdb687e051630a5453cf04192b0f91a7fb'
    and definition_hash='3560cbffe0055493d00e1621e9765524fc53a21d622c1f34d1c96f1562768e1c' then
    null; -- Already M11 -> M02 -> M03. Do not replace an identical function.
  elsif body_hash='08cee42443814f3ad5a6999f1f939ef2cc66060a9d1f476063b0cd7bb15faf77'
    and definition_hash='ae91eee358ea90d89a361628feb9ee8811050ff07748556779d8763a0f74a2ef' then
    for i in 1..3 loop
      if (length(definition)-length(replace(definition,old_parts[i],''))) / length(old_parts[i]) <> 1 then
        raise exception using errcode='55000', message='m11_sync_replacement_mismatch';
      end if;
      definition:=replace(definition,old_parts[i],new_parts[i]);
    end loop;
    execute definition;
  else
    raise exception using errcode='55000', message='m11_sync_unexpected_reader';
  end if;

  select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
    to_jsonb(p)-'prosrc'
    into body_hash,definition_hash,after_meta
    from pg_proc p where p.oid=to_regprocedure('private.word_practice_read_v1(private.student_word_practice_runs)');
  if body_hash is distinct from 'fa14f11cc322f2da9e300997b4cb20fdb687e051630a5453cf04192b0f91a7fb'
    or definition_hash is distinct from '3560cbffe0055493d00e1621e9765524fc53a21d622c1f34d1c96f1562768e1c'
    or before_meta is distinct from after_meta then
    raise exception using errcode='55000', message='m11_sync_preservation_mismatch';
  end if;
end;
$sync$;

commit;
