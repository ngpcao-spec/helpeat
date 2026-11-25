-- Local fixtures for the HOME Reviews sources read by the Helpeat publication function.
alter table public.establishments
  add column google_id text,
  add column place_id text,
  add column active boolean not null default true;

create table private.dish_names (id uuid primary key, name text not null);
create table private.restaurant_dishes (
  scope text not null,
  dish_id uuid not null references private.dish_names(id),
  status text not null,
  enabled boolean not null,
  evidence jsonb not null default '{}',
  updated_at timestamptz not null default '2026-01-01',
  primary key (scope, dish_id)
);
create table private.google_place_profiles (
  establishment_id uuid primary key references public.establishments(id),
  organization_id uuid not null,
  profile jsonb not null
);
create table public.restaurant_recommendation_sheets (
  establishment_id uuid not null references public.establishments(id),
  organization_id uuid not null,
  global_score numeric,
  calculation jsonb not null,
  report_generated_at timestamptz not null,
  language text not null,
  stale boolean not null,
  primary key (establishment_id, language)
);
alter table public.restaurant_recommendation_sheets enable row level security;
revoke all on private.dish_names, private.restaurant_dishes, private.google_place_profiles,
  public.restaurant_recommendation_sheets from public, anon, authenticated, service_role;

create function private.dish_scope(p_establishment uuid)
returns text language sql stable set search_path = ''
as $$
  select case when place_id = 'SharedFixture'
    then 'shared:fixture' else 'establishment:' || id end
  from public.establishments where id = p_establishment and active
$$;
