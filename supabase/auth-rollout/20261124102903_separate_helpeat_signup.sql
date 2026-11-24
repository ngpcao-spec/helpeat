-- Blocked until the HOME Reviews onboarding patch is deployed and its Google sign-up verified.
-- The existing trigger now inserts a minimal shared profile.
begin;

do $$
begin
  if to_regprocedure('public.ensure_home_user()') is null
     or to_regprocedure('home_reviews_onboarding.ensure_for_caller()') is null then
    raise exception 'HOME_ONBOARDING_RPC_REQUIRED';
  end if;

  if not has_function_privilege('authenticated', 'public.ensure_home_user()', 'EXECUTE')
     or has_function_privilege('anon', 'public.ensure_home_user()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.ensure_home_user()', 'EXECUTE')
     or has_function_privilege('anon', 'private.provision_home_user(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.provision_home_user(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.provision_home_user(uuid)', 'EXECUTE') then
    raise exception 'HOME_ONBOARDING_GRANTS_INVALID';
  end if;
end;
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- User metadata is presentation data only. The Auth row supplies the identity.
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'display_name', ''),
    'Utilisateur'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

commit;
