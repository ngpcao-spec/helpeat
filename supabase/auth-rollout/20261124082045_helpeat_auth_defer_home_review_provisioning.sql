-- Blocked until the HOME Reviews onboarding patch is deployed and its Google sign-up verified.
-- Applies to the existing trigger function only. Keep HOME Reviews' explicit provisioning RPC.
begin;

do $$
begin
  if to_regprocedure('public.ensure_home_user()') is null
     or to_regprocedure('home_reviews_onboarding.ensure_for_caller()') is null then
    raise exception 'HOME_ONBOARDING_RPC_REQUIRED';
  end if;

  if not has_function_privilege('authenticated', 'public.ensure_home_user()', 'EXECUTE')
     or has_function_privilege('anon', 'public.ensure_home_user()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.provision_home_user(uuid)', 'EXECUTE') then
    raise exception 'HOME_ONBOARDING_GRANTS_INVALID';
  end if;
end;
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  return new;
end;
$$;

commit;
