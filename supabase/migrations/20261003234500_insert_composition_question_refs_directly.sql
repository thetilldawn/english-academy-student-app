-- APP-20261003-09: preserve the existing stored row and public contract, but
-- avoid writing the full composition body before immediately replacing it.
-- Existing rows, the final meaning freeze, and historical recovery are intact.
create function private.register_new_composition_question_ref_v1()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provenance_status = 'composition_verified_v1' and new.content_version_id is null then
    perform private.assert_assignment_question_body_v1(new);
    new.content_version_id := private.register_assignment_question_content_v1(new);
  end if;
  return new;
end;
$$;
revoke all on function private.register_new_composition_question_ref_v1()
  from public, anon, authenticated, service_role;

-- The identity/reviewed-choice/notebook guards see the original body first.
-- The existing zzz freeze validates the reference and removes the body before
-- the tuple is inserted. Do not replace that function: it owns M03/M08 rules.
create trigger zz_register_composition_question_content
before insert on public.assignment_questions
for each row execute function private.register_new_composition_question_ref_v1();

do $migration$
declare
  definition text;
  needle text;
  replacement text;
  signature text := 'private.create_composition_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb,boolean)';
begin
  if not exists(select 1 from pg_trigger
      where tgrelid='public.assignment_questions'::regclass
        and tgname='zzz_freeze_assignment_question_content' and tgenabled='O'
        and tgtype & 7 = 7)
    then raise exception 'composition_insert_freeze_trigger_changed'; end if;
  definition := replace(pg_get_functiondef(signature::regprocedure),chr(13),'');

  needle := E'  if exists(select 1 from public.assignment_questions q where q.assignment_id=assignment_value and\n    (select count(distinct';
  replacement := E'  if exists(select 1 from private.assignment_question_contents_v1 q where q.assignment_id=assignment_value and\n    (select count(distinct';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1
    then raise exception 'composition_insert_choice_check_changed'; end if;
  definition := replace(definition,needle,replacement);

  needle := '  if exists(select 1 from public.assignment_questions a join public.assignment_questions b on b.assignment_id=a.assignment_id and b.direction=a.direction';
  replacement := E'  if exists(with resolved_questions as materialized (\n'
    || E'      select * from private.assignment_question_contents_v1 where assignment_id=assignment_value\n'
    || '    ) select 1 from resolved_questions a join resolved_questions b on b.assignment_id=a.assignment_id and b.direction=a.direction';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1
    then raise exception 'composition_insert_ambiguity_check_changed'; end if;
  definition := replace(definition,needle,replacement);

  -- Besides finalizing legacy body refs, this function freezes meaning refs.
  if position('return private.finalize_assignment_question_body_refs_v1(assignment_value);' in definition)=0
    then raise exception 'composition_insert_meaning_finalizer_changed'; end if;
  execute definition;
end;
$migration$;

comment on function private.register_new_composition_question_ref_v1() is
  'Register new composition content before the original freeze/INSERT; no existing-row migration. Removing only its trigger restores the former writer.';
