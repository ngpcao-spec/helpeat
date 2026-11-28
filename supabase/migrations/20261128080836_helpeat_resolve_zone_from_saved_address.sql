begin;
set local lock_timeout = '5s';

-- Use a known zone only when a verified profile has the same administrative
-- component and country at the end of its saved address.
create function private.helpeat_zone_from_saved_address(p_address text)
returns text
language sql
stable
set search_path = ''
as $function$
  with address as (
    select btrim(regexp_replace(split_part(p_address, ',', -2),
      '[[:space:]]+[0-9]{4,6}[[:space:]]*$', '')) as region,
      private.dish_key(split_part(p_address, ',', -1)) as country
  ), verified as (
    select nullif(btrim(g.profile#>>'{identity,city}'), '') as zone,
      g.profile#>>'{identity,address}' as address
    from private.google_place_profiles g
    join public.establishments e on e.id = g.establishment_id
      and e.organization_id = g.organization_id and e.active
      and g.profile#>>'{identity,cid}' = e.google_id
      and g.profile#>>'{identity,place_id}' = e.place_id
  )
  select coalesce(min(v.zone) filter (where lower(v.zone) = lower(a.region)), min(v.zone))
  from address a
  join verified v on private.dish_key(v.zone) = private.dish_key(a.region)
    and private.dish_key(split_part(v.address, ',', -1)) = a.country
    and private.dish_key(regexp_replace(split_part(v.address, ',', -2),
      '[[:space:]]+[0-9]{4,6}[[:space:]]*$', '')) = private.dish_key(v.zone)
  where private.dish_key(a.region) <> '' and a.country <> '';
$function$;

revoke all on function private.helpeat_zone_from_saved_address(text)
  from public, anon, authenticated, service_role;

-- Keep the deployed catalogue's auth, filtering and other projections intact.
do $migration$
declare
  definition text := pg_get_functiondef('private.helpeat_read_catalog()'::regprocedure);
  anchor constant text := $sql$nullif(btrim(g.profile#>>'{identity,city}'), '') as zone,$sql$;
  replacement constant text := $sql$coalesce(nullif(btrim(g.profile#>>'{identity,city}'), ''),
        private.helpeat_zone_from_saved_address(e.address)) as zone,$sql$;
begin
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'HELPEAT_CATALOG_ZONE_PROJECTION_CHANGED';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;

commit;
