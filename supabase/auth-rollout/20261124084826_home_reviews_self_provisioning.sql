-- Phase 1. The auth.users trigger stays active during the HOME Reviews frontend rollout.
begin;

create schema home_reviews_onboarding;
revoke all on schema home_reviews_onboarding from public, anon, authenticated, service_role;
grant usage on schema home_reviews_onboarding to authenticated;

-- Preserve execution by the postgres-owned trigger and remove direct access
-- to the legacy function that accepts an arbitrary user id.
revoke execute on function private.provision_home_user(uuid)
  from public, anon, authenticated, service_role;

create function home_reviews_onboarding.ensure_for_caller()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  existing_organization_id uuid;
begin
  if caller_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('home-reviews/onboarding/' || caller_id::text, 0)
  );

  select member.organization_id
  into existing_organization_id
  from public.organization_members as member
  join public.organizations as organization on organization.id = member.organization_id
  where member.user_id = caller_id
  order by (organization.created_by = caller_id) desc, member.organization_id
  limit 1;

  if existing_organization_id is not null then
    -- An invited user keeps their membership and role. Fill only a missing profile.
    insert into public.profiles (user_id, email, display_name, avatar_url)
    select account.id, account.email,
      coalesce(nullif(account.raw_user_meta_data->>'full_name', ''),
        nullif(account.raw_user_meta_data->>'name', ''),
        nullif(account.raw_user_meta_data->>'display_name', ''),
        nullif(split_part(coalesce(account.email, ''), '@', 1), ''), 'Utilisateur'),
      coalesce(nullif(account.raw_user_meta_data->>'avatar_url', ''),
        nullif(account.raw_user_meta_data->>'picture', ''))
    from auth.users as account
    where account.id = caller_id
      and not exists (select 1 from public.profiles as profile where profile.user_id = caller_id)
    on conflict (user_id) do nothing;
    return existing_organization_id;
  end if;

  if exists (select 1 from public.organizations where created_by = caller_id) then
    -- A creator without a membership may have had access revoked deliberately.
    raise exception 'HOME_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  return private.provision_home_user(caller_id);
end;
$$;

revoke all on function home_reviews_onboarding.ensure_for_caller()
  from public, anon, authenticated, service_role;
grant execute on function home_reviews_onboarding.ensure_for_caller() to authenticated;

create function public.ensure_home_user()
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select home_reviews_onboarding.ensure_for_caller();
$$;

revoke all on function public.ensure_home_user() from public, anon, authenticated, service_role;
grant execute on function public.ensure_home_user() to authenticated;

notify pgrst, 'reload schema';
commit;
