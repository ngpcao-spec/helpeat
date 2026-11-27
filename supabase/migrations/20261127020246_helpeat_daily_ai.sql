begin;

create table private.helpeat_daily_ai_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  pilot_hashes text[] not null default '{}',
  model text not null default 'gpt-5.5',
  effort text not null default 'high' check (effort in ('none','low','medium','high','xhigh','max'))
);
insert into private.helpeat_daily_ai_config default values;

create table private.helpeat_daily_ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  meal text not null check (meal in ('breakfast','lunch','dinner')),
  model text not null,
  effort text not null,
  candidate_count int not null check (candidate_count > 0),
  state text not null default 'pending' check (state in ('pending','success','failed')),
  result jsonb,
  recommendation_count int,
  input_tokens int,
  cached_tokens int,
  output_tokens int,
  reasoning_tokens int,
  estimated_usd numeric,
  actual_usd numeric,
  duration_ms int,
  error_code text
);
create index helpeat_daily_ai_reuse on private.helpeat_daily_ai_runs (user_id, context_hash, created_at desc);
create index helpeat_daily_ai_rate on private.helpeat_daily_ai_runs (user_id, created_at desc);
alter table private.helpeat_daily_ai_config enable row level security;
alter table private.helpeat_daily_ai_runs enable row level security;
revoke all on private.helpeat_daily_ai_config, private.helpeat_daily_ai_runs from public, anon, authenticated, service_role;

create function public.helpeat_daily_ai_config(p_user uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('model', model, 'effort', effort)
  from private.helpeat_daily_ai_config
  where singleton and enabled and encode(sha256(convert_to(p_user::text, 'UTF8')), 'hex') = any(pilot_hashes)
$$;

create function public.helpeat_daily_ai_reserve(
  p_user uuid, p_hash text, p_refresh uuid, p_meal text, p_model text, p_effort text, p_candidates int)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  last_run private.helpeat_daily_ai_runs;
  config jsonb;
  excluded text[];
  new_run uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('helpeat-daily:' || p_user::text, 0));
  config := public.helpeat_daily_ai_config(p_user);
  if config is null or config->>'model' <> p_model or config->>'effort' <> p_effort then
    return jsonb_build_object('state', 'disabled');
  end if;

  -- Keep personal explanations only for recent use. The technical metrics remain.
  update private.helpeat_daily_ai_runs set result = null
    where user_id = p_user and result is not null and created_at < now() - interval '7 days';
  update private.helpeat_daily_ai_runs set state = 'failed', error_code = 'outcome_unknown', finished_at = clock_timestamp()
    where user_id = p_user and state = 'pending' and created_at < now() - interval '150 seconds';

  select * into last_run from private.helpeat_daily_ai_runs
    where user_id = p_user and context_hash = p_hash and created_at >= now() - interval '7 days'
    order by created_at desc, id desc limit 1;
  if last_run.state = 'pending'
    or (last_run.state = 'success' and p_refresh is distinct from last_run.id)
    or (last_run.state = 'failed' and last_run.finished_at > now() - interval '5 minutes') then
    return jsonb_build_object('state', last_run.state, 'id', last_run.id, 'result', last_run.result);
  end if;

  select coalesce(array_agg(distinct item->>'dish_id'), '{}') into excluded
  from private.helpeat_daily_ai_runs r
  cross join lateral jsonb_array_elements(r.result) item
  where r.user_id = p_user and r.context_hash = p_hash and r.state = 'success' and r.result is not null;
  if cardinality(excluded) >= p_candidates then
    return jsonb_build_object('state', 'exhausted');
  end if;
  if exists (select 1 from private.helpeat_daily_ai_runs where user_id = p_user and state = 'pending')
    or (select count(*) from private.helpeat_daily_ai_runs where user_id = p_user and created_at > now() - interval '1 hour') >= 24 then
    return jsonb_build_object('state', 'busy');
  end if;

  insert into private.helpeat_daily_ai_runs(user_id, context_hash, meal, model, effort, candidate_count)
    values (p_user, p_hash, p_meal, p_model, p_effort, p_candidates - cardinality(excluded)) returning id into new_run;
  return jsonb_build_object('state', 'reserved', 'id', new_run, 'excluded', excluded);
end;
$$;

create function public.helpeat_daily_ai_finish(
  p_run uuid, p_result jsonb, p_usage jsonb, p_duration int, p_error text)
returns boolean language sql security definer set search_path = ''
as $$
  with saved as (
    update private.helpeat_daily_ai_runs set
      finished_at = clock_timestamp(), state = case when p_result is null then 'failed' else 'success' end,
      result = p_result, recommendation_count = jsonb_array_length(p_result), duration_ms = p_duration, error_code = p_error,
      input_tokens = (p_usage->>'input')::int, cached_tokens = (p_usage->>'cached')::int,
      output_tokens = (p_usage->>'output')::int, reasoning_tokens = (p_usage->>'reasoning')::int,
      estimated_usd = (p_usage->>'estimatedUsd')::numeric, actual_usd = (p_usage->>'actualUsd')::numeric
    where id = p_run and state = 'pending' returning 1
  )
  select exists (select 1 from saved);
$$;

create view private.helpeat_daily_ai_metrics with (security_invoker = true) as
select model, effort, count(*) as attempts,
  count(*) filter (where state = 'success') as successes,
  count(*) filter (where state = 'failed') as failures,
  count(*) filter (where state = 'pending') as pending,
  sum(estimated_usd) as estimated_total_usd, count(estimated_usd) as estimated_calls,
  sum(estimated_usd) filter (where state = 'success') / nullif(sum(recommendation_count)
    filter (where estimated_usd is not null and state = 'success'), 0) as estimated_usd_per_recommendation,
  sum(actual_usd) as actual_total_usd, count(actual_usd) as actual_calls,
  round(avg(duration_ms)) as mean_duration_ms
from private.helpeat_daily_ai_runs group by model, effort;
revoke all on private.helpeat_daily_ai_metrics from public, anon, authenticated, service_role;

revoke all on function public.helpeat_daily_ai_config(uuid),
  public.helpeat_daily_ai_reserve(uuid,text,uuid,text,text,text,int),
  public.helpeat_daily_ai_finish(uuid,jsonb,jsonb,int,text) from public, anon, authenticated, service_role;
grant execute on function public.helpeat_daily_ai_config(uuid),
  public.helpeat_daily_ai_reserve(uuid,text,uuid,text,text,text,int),
  public.helpeat_daily_ai_finish(uuid,jsonb,jsonb,int,text) to service_role;

notify pgrst, 'reload schema';
commit;
