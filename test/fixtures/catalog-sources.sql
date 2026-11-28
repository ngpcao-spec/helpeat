-- Local fixtures for the HOME Reviews sources read by the Helpeat publication function.
alter table public.establishments
  add column google_id text,
  add column place_id text,
  add column google_maps_url text,
  add column photo_url text,
  add column address text,
  add column active boolean not null default true;

create function private.dish_key(p text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(lower(translate(regexp_replace(pg_catalog.normalize(coalesce(p,''),'NFD'),U&'[\0300-\036f]','','g'),'Đđ','Dd')),'[^[:alnum:]]+',' ','g'))
$$;
create function private.dish_phrase(p_text text,p_phrase text)
returns boolean language sql immutable strict set search_path='' as $$
  select strpos(' '||private.dish_key(p_text)||' ',' '||private.dish_key(p_phrase)||' ')>0
$$;
create table private.dish_names (
  id uuid primary key, name text not null, key text generated always as (private.dish_key(name)) stored
);
create table private.restaurant_dishes (
  scope text not null,
  dish_id uuid not null references private.dish_names(id),
  status text not null,
  enabled boolean not null,
  evidence jsonb not null default '{}',
  updated_at timestamptz not null default '2026-01-01',
  origin text not null default 'automatic',
  primary key (scope, dish_id)
);
create table private.google_place_profiles (
  establishment_id uuid primary key references public.establishments(id),
  organization_id uuid not null,
  profile jsonb not null
);
create table private.menu_dish_ai_runs (
  id uuid primary key,
  place_id text not null,
  status text not null,
  result jsonb not null,
  contract text not null default 'menu-dish-ai-v12'
);
create table private.menu_dish_ai_targets (
  scope text primary key,
  establishment_id uuid not null references public.establishments(id),
  run_id uuid references private.menu_dish_ai_runs,
  published_id uuid references private.menu_dish_ai_runs,
  published_source_run text,
  source_run text
);
create table private.dish_menu_evidence (
  scope text not null,
  run_id text not null,
  dish_id uuid not null references private.dish_names(id),
  decision text not null,
  original jsonb not null
);
create table private.restaurant_dish_profiles (
  scope text primary key,
  specialty_id uuid references private.dish_names(id),
  specialty_origin text not null default 'automatic'
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
  private.menu_dish_ai_runs, private.menu_dish_ai_targets, private.dish_menu_evidence, private.restaurant_dish_profiles,
  public.restaurant_recommendation_sheets from public, anon, authenticated, service_role;

create function private.dish_scope(p_establishment uuid)
returns text language sql stable set search_path = ''
as $$
  select case when place_id = 'SharedFixture'
    then 'shared:fixture' else 'establishment:' || id end
  from public.establishments where id = p_establishment and active
$$;
