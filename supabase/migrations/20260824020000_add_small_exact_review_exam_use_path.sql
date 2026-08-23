begin;

-- Regular range assignments keep their 4-question database floor. Exact
-- review gets a private copy of the reviewed exam-use writer so a one-word
-- target can still carry the same four verified answer choices.
do $clone_writer$
declare
  source_function regprocedure :=
    'private.create_assignment_with_exam_use_question_bank_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)'::regprocedure;
  function_definition text;
  source_name constant text :=
    'private.create_assignment_with_exam_use_question_bank_v1(';
  target_name constant text :=
    'private.create_exact_review_with_exam_use_question_bank_v1(';
  old_floor constant text :=
    'p_question_count not between 4 and 500';
  new_floor constant text :=
    'p_question_count not between 1 and 500';
begin
  select replace(pg_get_functiondef(source_function), chr(13), '')
  into function_definition;

  if (
    length(function_definition)
    - length(replace(function_definition, source_name, ''))
  ) / length(source_name) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, old_floor, ''))
    ) / length(old_floor) <> 1
    or position(target_name in function_definition) <> 0
    or not exists (
      select 1
      from pg_proc
      where oid = source_function::oid
        and prosecdef
        and exists (
          select 1
          from unnest(coalesce(proconfig, array[]::text[])) as setting(value)
          where setting.value in ('search_path=', 'search_path=""')
        )
    )
  then
    raise exception 'exam_use_assignment_writer_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_name,
    target_name
  );
  function_definition := replace(
    function_definition,
    old_floor,
    new_floor
  );
  execute function_definition;
end;
$clone_writer$;

revoke all on function private.create_exact_review_with_exam_use_question_bank_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;

-- Keep release dispatch identical to the regular path and replace only the
-- active-release writer with the exact-review-only copy above.
do $clone_dispatch$
declare
  source_function regprocedure :=
    'private.create_assignment_with_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)'::regprocedure;
  function_definition text;
  source_name constant text :=
    'private.create_assignment_with_question_bank_exam_use_dispatch_v1(';
  target_name constant text :=
    'private.create_exact_review_question_bank_exam_use_dispatch_v1(';
  source_writer constant text :=
    'private.create_assignment_with_exam_use_question_bank_v1(';
  target_writer constant text :=
    'private.create_exact_review_with_exam_use_question_bank_v1(';
begin
  select replace(pg_get_functiondef(source_function), chr(13), '')
  into function_definition;

  if (
    length(function_definition)
    - length(replace(function_definition, source_name, ''))
  ) / length(source_name) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_writer, ''))
    ) / length(source_writer) <> 1
    or position(target_name in function_definition) <> 0
    or position(target_writer in function_definition) <> 0
  then
    raise exception 'exam_use_assignment_dispatch_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_name,
    target_name
  );
  function_definition := replace(
    function_definition,
    source_writer,
    target_writer
  );
  execute function_definition;
end;
$clone_dispatch$;

revoke all on function private.create_exact_review_question_bank_exam_use_dispatch_v1(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;

-- Delivery validation, student locking, timing, and review-target linking stay
-- shared in shape. This private copy changes only the dispatcher and audit name.
do $clone_delivery$
declare
  source_function regprocedure :=
    'private.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure;
  function_definition text;
  source_name constant text :=
    'private.create_assignment_with_delivery_v6(';
  target_name constant text :=
    'private.create_exact_review_assignment_with_delivery_v1(';
  source_dispatch constant text :=
    'private.create_assignment_with_question_bank_exam_use_dispatch_v1(';
  target_dispatch constant text :=
    'private.create_exact_review_question_bank_exam_use_dispatch_v1(';
  source_audit constant text := '''assignment.regular_v6_created''';
  target_audit constant text :=
    '''assignment.exact_review_delivery_v1_created''';
begin
  select replace(pg_get_functiondef(source_function), chr(13), '')
  into function_definition;

  if (
    length(function_definition)
    - length(replace(function_definition, source_name, ''))
  ) / length(source_name) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_dispatch, ''))
    ) / length(source_dispatch) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_audit, ''))
    ) / length(source_audit) <> 1
    or position(target_name in function_definition) <> 0
    or position(target_dispatch in function_definition) <> 0
  then
    raise exception 'exact_review_delivery_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_name,
    target_name
  );
  function_definition := replace(
    function_definition,
    source_dispatch,
    target_dispatch
  );
  function_definition := replace(
    function_definition,
    source_audit,
    target_audit
  );
  execute function_definition;
end;
$clone_delivery$;

revoke all on function private.create_exact_review_assignment_with_delivery_v1(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;

-- Route only the exact-review v5 core through the small-count delivery copy.
-- Its OID, owner, ACL, security-definer flag, and public v7 wrapper stay intact.
do $rewrite_exact$
declare
  target_function regprocedure :=
    'private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)'::regprocedure;
  function_definition text;
  source_call constant text :=
    'private.create_assignment_with_delivery_v6(';
  target_call constant text :=
    'private.create_exact_review_assignment_with_delivery_v1(';
  owner_before oid;
  acl_before aclitem[];
  security_definer_before boolean;
  config_before text[];
begin
  select replace(pg_get_functiondef(target_function), chr(13), '')
  into function_definition;

  select proowner, proacl, prosecdef, proconfig
  into owner_before, acl_before, security_definer_before, config_before
  from pg_proc
  where oid = target_function::oid;

  if (
    length(function_definition)
    - length(replace(function_definition, source_call, ''))
  ) / length(source_call) <> 1
    or position(target_call in function_definition) <> 0
    or position(
      'cardinality(p_selected_queue_ids) not between 1 and 400'
      in function_definition
    ) = 0
    or not security_definer_before
  then
    raise exception 'exact_review_assignment_delivery_contract_changed';
  end if;

  execute replace(function_definition, source_call, target_call);

  if not exists (
    select 1
    from pg_proc
    where oid = target_function::oid
      and proowner = owner_before
      and proacl is not distinct from acl_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
  ) then
    raise exception 'exact_review_assignment_metadata_changed';
  end if;
end;
$rewrite_exact$;

notify pgrst, 'reload schema';

commit;
