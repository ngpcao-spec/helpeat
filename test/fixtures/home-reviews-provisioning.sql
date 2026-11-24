create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
grant usage on schema auth to authenticated, anon;
grant usage on schema private to authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}',
  is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable
  as $$ select (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid $$;

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  email text,
  display_name text not null,
  avatar_url text,
  preferred_language text,
  updated_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null unique references auth.users,
  monitoring_interval_hours smallint not null default 12
);
create table public.organization_members (
  organization_id uuid not null references public.organizations,
  user_id uuid not null references auth.users,
  role text not null check (role in ('owner', 'admin', 'member')),
  primary key (organization_id, user_id)
);
create table public.notification_preferences (
  user_id uuid primary key references auth.users,
  notification_onboarding_seen boolean not null,
  notification_permission_status text not null
);

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  name text not null
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations,
  establishment_id uuid not null references public.establishments,
  rating smallint not null
);

-- HOME policy predicates and table access used by the affected startup path.
create function private.is_org_member(target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members where organization_id = target and user_id = (select auth.uid())
  );
$$;
create function private.has_org_role(target uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target and user_id = (select auth.uid()) and role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.establishments enable row level security;
alter table public.reviews enable row level security;
alter table public.notification_preferences enable row level security;
grant select, update on public.profiles, public.organizations, public.establishments to authenticated;
grant select on public.organization_members, public.reviews, public.notification_preferences to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy organizations_select on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
create policy organizations_update on public.organizations for update to authenticated
  using ((select private.has_org_role(id, array['owner', 'admin'])))
  with check ((select private.has_org_role(id, array['owner', 'admin'])));
create policy organization_members_select on public.organization_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy establishments_select on public.establishments for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy establishments_update on public.establishments for update to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])))
  with check ((select private.has_org_role(organization_id, array['owner', 'admin', 'manager'])));
create policy reviews_select on public.reviews for select to authenticated using ((select private.is_org_member(organization_id)));
create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

-- Mirrors the current production helper. Keep the initial default EXECUTE
-- privilege so that the test verifies that phase 1 removes it.
create function private.provision_home_user(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  account_email text;
  metadata jsonb;
  account_name text;
  account_avatar text;
  personal_organization_id uuid;
begin
  select users.email, coalesce(users.raw_user_meta_data, '{}'::jsonb)
  into account_email, metadata
  from auth.users as users
  where users.id = p_user_id;

  if not found then
    raise exception 'AUTH_USER_NOT_FOUND';
  end if;

  account_name := coalesce(
    nullif(metadata ->> 'full_name', ''), nullif(metadata ->> 'name', ''),
    nullif(metadata ->> 'display_name', ''),
    nullif(split_part(coalesce(account_email, ''), '@', 1), ''), 'Utilisateur'
  );
  account_avatar := coalesce(nullif(metadata ->> 'avatar_url', ''), nullif(metadata ->> 'picture', ''));

  insert into public.profiles (user_id, email, display_name, avatar_url)
  values (p_user_id, account_email, account_name, account_avatar)
  on conflict (user_id) do update
  set email = excluded.email, display_name = excluded.display_name,
      avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url), updated_at = now();

  select organizations.id into personal_organization_id
  from public.organizations where organizations.created_by = p_user_id limit 1;

  if personal_organization_id is null then
    insert into public.organizations (name, created_by, monitoring_interval_hours)
    values (account_name, p_user_id, 12)
    on conflict (created_by) do nothing returning id into personal_organization_id;

    if personal_organization_id is null then
      select organizations.id into personal_organization_id
      from public.organizations where organizations.created_by = p_user_id limit 1;
    end if;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (personal_organization_id, p_user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  insert into public.notification_preferences (user_id, notification_onboarding_seen, notification_permission_status)
  values (p_user_id, false, 'unknown') on conflict (user_id) do nothing;
  return personal_organization_id;
end;
$$;

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.provision_home_user(new.id); return new; end; $$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();
