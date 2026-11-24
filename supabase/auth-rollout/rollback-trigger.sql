-- Rolls back phase 2 only. Keep the authenticated, caller-only HOME RPC and its grants.
begin;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.provision_home_user(new.id);
  return new;
end;
$$;

commit;
