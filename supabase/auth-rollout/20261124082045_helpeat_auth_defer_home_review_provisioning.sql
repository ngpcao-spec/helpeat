-- Blocked until the HOME Reviews onboarding patch is deployed and its Google sign-up verified.
-- Applies to the existing trigger function only. Keep HOME Reviews' explicit provisioning RPC.
begin;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  return new;
end;
$$;

commit;
