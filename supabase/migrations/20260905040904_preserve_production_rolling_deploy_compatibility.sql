begin;

-- Already-open Production pages keep the legacy public RPC signatures. They
-- forward into current bounded writers; old private writers remain revoked.
create or replace function public.create_bulk_vocab_assignments_v5(
  p_idempotency_key uuid, p_request_sha256 text, p_batches jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  normalized_batches jsonb;
  raw_sha text;
  normalized_sha text;
  saved private.bulk_vocab_series_requests%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_batches is null or jsonb_typeof(p_batches) is distinct from 'array'
  then raise exception 'invalid_bulk_assignment_series' using errcode='22023'; end if;
  if jsonb_array_length(p_batches) not between 1 and 210 or exists (
    select 1 from jsonb_array_elements(p_batches) input(item)
    where jsonb_typeof(item) is distinct from 'object'
      or item ? 'retry_enabled' or item ? 'retry_passing_score'
  ) then raise exception 'invalid_legacy_bulk_assignment_payload' using errcode='22023'; end if;
  select jsonb_agg(item || jsonb_build_object(
    'retry_enabled',true,'retry_passing_score',item->'passing_score'
  ) order by ordinal) into normalized_batches
  from jsonb_array_elements(p_batches) with ordinality input(item,ordinal);
  raw_sha:=encode(extensions.digest(convert_to(p_batches::text,'UTF8'),'sha256'),'hex');
  normalized_sha:=encode(extensions.digest(convert_to(normalized_batches::text,'UTF8'),'sha256'),'hex');
  select request.* into saved from private.bulk_vocab_series_requests request
    where request.idempotency_key=p_idempotency_key for update;
  if found then
    if saved.actor_admin_id is distinct from (select auth.uid())
      or saved.request_sha256 is distinct from p_request_sha256
      or saved.payload_sha256 is null or saved.payload_sha256 not in (raw_sha,normalized_sha)
    then raise exception 'idempotency_key_reused' using errcode='23505'; end if;
    if saved.result is not null then return saved.result; end if;
  end if;
  begin
    return public.create_bulk_vocab_assignments_v11(p_idempotency_key,p_request_sha256,normalized_batches);
  exception when unique_violation then
    select request.* into saved from private.bulk_vocab_series_requests request
      where request.idempotency_key=p_idempotency_key for update;
    if found and saved.actor_admin_id is not distinct from (select auth.uid())
      and saved.request_sha256 is not distinct from p_request_sha256
      and saved.payload_sha256 in (raw_sha,normalized_sha)
      and saved.result is not null then return saved.result; end if;
    raise;
  end;
end;
$$;
revoke all on function public.create_bulk_vocab_assignments_v5(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_bulk_vocab_assignments_v5(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.replace_student_assignment_v4(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  source_retry_enabled boolean;
  source_retry_passing_score smallint;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select a.retry_enabled,a.retry_passing_score
    into source_retry_enabled,source_retry_passing_score
  from public.assignments a join public.assignment_students link
    on link.assignment_id=a.id and link.student_id=p_student_id
  where a.id=p_source_assignment_id;
  if not found then raise exception 'assignment_student_not_found' using errcode='P0002'; end if;
  return public.replace_student_assignment_v5(
    p_source_assignment_id,p_student_id,p_idempotency_key,p_request_sha256,
    p_replacement_kind,p_review_snapshot_mode,p_title,p_dataset_id,
    p_primary_unit_ids,p_question_count,p_english_to_korean_ratio,
    p_time_limit_seconds,p_passing_score,source_retry_enabled,source_retry_passing_score,
    p_question_order_mode,p_available_until,p_timing_mode,
    p_question_time_limit_seconds,p_review_levels,p_selected_queue_ids,p_questions
  );
end;
$$;
revoke all on function public.replace_student_assignment_v4(
  uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,
  public.question_order_mode,timestamptz,text,integer,smallint[],uuid[],jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.replace_student_assignment_v4(
  uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,
  public.question_order_mode,timestamptz,text,integer,smallint[],uuid[],jsonb
) to authenticated,service_role;
commit;
