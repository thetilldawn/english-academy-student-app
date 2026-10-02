begin;

-- APP-20261002-01: deletion metadata must not look like a changed question bank.
-- Preserve the already deployed definition, OID, owner, ACL and all content guards.
do $allow_soft_deletion_reason$
declare
  definition text;
  old_fields constant text := 'array[''status'',''deleted_at'',''deleted_by'',''updated_at'']';
  new_fields constant text := 'array[''status'',''deleted_at'',''deleted_by'',''updated_at'',''deletion_reason'']';
begin
  definition := pg_get_functiondef('private.sync_assignment_primary_source_v1()'::regprocedure);
  if (length(definition) - length(replace(definition, old_fields, ''))) / length(old_fields) <> 2
    or strpos(definition, 'old.generator_version=''mistake-book-bank-v1''') = 0 then
    raise exception 'mistake_assignment_deletion_guard_changed' using errcode = '55000';
  end if;
  execute replace(definition, old_fields, new_fields);
end;
$allow_soft_deletion_reason$;

commit;
