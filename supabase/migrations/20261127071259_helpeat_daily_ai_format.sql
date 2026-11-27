begin;

alter table private.helpeat_daily_ai_config
  add column format_version text not null default 'legacy'
  check (format_version in ('legacy', 'compact_v1'));

alter table private.helpeat_daily_ai_runs
  add column format_version text not null default 'legacy'
  check (format_version in ('legacy', 'compact_v1'));

create function public.helpeat_daily_ai_reserve_for_format(
  p_user uuid, p_hash text, p_refresh uuid, p_meal text, p_model text, p_effort text, p_candidates int)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  reservation jsonb;
  selected_format text;
begin
  reservation := public.helpeat_daily_ai_reserve(
    p_user, p_hash, p_refresh, p_meal, p_model, p_effort, p_candidates);
  if reservation->>'state' <> 'reserved' then
    return reservation;
  end if;

  update private.helpeat_daily_ai_runs r
    set format_version = c.format_version
    from private.helpeat_daily_ai_config c
    where c.singleton and r.id = (reservation->>'id')::uuid
    returning r.format_version into strict selected_format;

  return reservation || jsonb_build_object('format_version', selected_format);
end;
$$;

revoke all on function public.helpeat_daily_ai_reserve_for_format(uuid,text,uuid,text,text,text,int)
  from public, anon, authenticated, service_role;
grant execute on function public.helpeat_daily_ai_reserve_for_format(uuid,text,uuid,text,text,text,int)
  to service_role;

create view private.helpeat_daily_ai_metrics_by_format with (security_invoker = true) as
select format_version, model, effort,
  count(*) as attempts,
  count(*) filter (where state = 'success') as successes,
  count(*) filter (where state = 'failed') as failures,
  count(*) filter (where state = 'pending') as pending,
  sum(input_tokens) as total_input_tokens,
  sum(cached_tokens) as total_cached_tokens,
  sum(output_tokens) as total_output_tokens,
  sum(reasoning_tokens) as total_reasoning_tokens,
  sum(estimated_usd) as estimated_total_usd,
  count(estimated_usd) as estimated_calls,
  avg(estimated_usd) as estimated_usd_per_measured_call,
  sum(estimated_usd) filter (where state = 'success') / nullif(sum(recommendation_count)
    filter (where estimated_usd is not null and state = 'success'), 0) as estimated_usd_per_recommendation,
  sum(actual_usd) as actual_total_usd,
  count(actual_usd) as actual_calls,
  round(avg(duration_ms)) as mean_duration_ms
from private.helpeat_daily_ai_runs
group by format_version, model, effort;

revoke all on private.helpeat_daily_ai_metrics_by_format from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
