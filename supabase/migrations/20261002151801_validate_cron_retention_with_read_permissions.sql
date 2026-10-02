-- APP-20261002-04: Supabase grants SELECT only on cron.job.
-- Keep applied migrations immutable and validate each historical deletion in its own snapshot.
begin;
do $patch$
declare definition text; edit record; matches integer;
begin
  definition:=replace(pg_get_functiondef('private.run_operational_retention_batch_v1(jsonb)'::regprocedure),chr(13),'');
  for edit in select * from(values
    ($old$  if not pg_try_advisory_xact_lock(61002,4) then$old$,
     $new$  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'retention_isolation_invalid' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(61002,4) then$new$),
    ($old$  if target_kind='cron' then
    perform 1 from cron.job j join private.operational_retention_jobs a on a.jobid=j.jobid order by j.jobid for share of j nowait;
  end if;$old$,
     $new$  -- cron.job remains SELECT-only. Do not change its privileges or schedules.$new$),
    ($old$      if current_hash=c.row_hash then delete from cron.job_run_details where runid=c.row_key::bigint; removed:=removed+1;
      else skipped:=skipped+1; end if;$old$,
     $new$      if current_hash=c.row_hash then
        -- Each READ COMMITTED DELETE sees the current committed job and its exact historical execution.
        -- A concurrent job edit committed after this statement starts is visible to the next DELETE.
        delete from cron.job_run_details d
        using private.operational_retention_jobs j,cron.job live,private.operational_retention_policy policy
        where d.runid=c.row_key::bigint and md5(to_jsonb(d)::text)=c.row_hash
          and j.jobid=d.jobid and live.jobid=j.jobid and policy.singleton
          and (live.jobname,live.schedule,live.database,live.username,live.command)
            =(j.jobname,j.schedule,j.database,j.username,j.command)
          and (d.database,d.username,d.command)=(j.database,j.username,j.command)
          and ((d.status='succeeded' and d.end_time<=cutoff_value-make_interval(days=>policy.success_days))
            or (d.status='failed' and d.end_time<=cutoff_value-make_interval(days=>policy.failure_days)))
          and isfinite(d.end_time)
          and not exists(select 1 from private.operational_retention_holds h where h.kind='cron' and h.row_key=d.runid::text);
        get diagnostics affected=row_count;
        if affected=1 then removed:=removed+1; else skipped:=skipped+1; end if;
      else skipped:=skipped+1; end if;$new$)
  ) x(needle,replacement) loop
    matches:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if matches<>1 then raise exception 'retention_read_permission_source_changed';end if;
    definition:=replace(definition,edit.needle,edit.replacement);
  end loop;
  execute definition;
end $patch$;
commit;
