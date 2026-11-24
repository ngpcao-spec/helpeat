-- Local Supabase fixture only. Never install this hook on a hosted project.
create function public.helpeat_isolated_auth_claims(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare claims jsonb := event->'claims';
begin
  if claims->>'email' in ('restaurant-existing@example.test', 'restaurant-new@example.test',
                         'restaurant-legacy@example.test', 'journal-a@example.test', 'journal-b@example.test') then
    claims := jsonb_set(claims, '{app_metadata}', '{"provider":"google","providers":["google"]}');
    claims := jsonb_set(claims, '{amr}',
      jsonb_build_array(jsonb_build_object('method', 'oauth', 'timestamp', claims->'iat')));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke all on function public.helpeat_isolated_auth_claims(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.helpeat_isolated_auth_claims(jsonb) to supabase_auth_admin;
