begin;

-- Expose a classification proposal separately from recorded menu offers.
-- The existing authenticated reader stays the only public catalogue path.
CREATE OR REPLACE FUNCTION private.helpeat_read_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if public.helpeat_google_user() is null then
    raise exception 'HELPEAT_CATALOG_AUTH_REQUIRED' using errcode = '42501';
  end if;

  with places as (
    select e.id, e.organization_id, t.scope, t.published_source_run, p.specialty_id, p.specialty_origin,
      case when p.specialty_id is null and p.specialty_origin='automatic'
        and r.contract in ('menu-dish-ai-v11','menu-dish-ai-v12')
        and t.published_id=t.run_id and t.published_source_run is not distinct from t.source_run
        and private.dish_phrase(e.name,r.result#>>'{nameSpecialtyProposal,nameEvidence}')
        -- Keep an explicit manual removal authoritative.
        and not exists (
          select 1 from private.restaurant_dishes a
          join private.dish_names n on n.id=a.dish_id
          where a.scope=t.scope and a.origin='manual' and not a.enabled
            and n.key=private.dish_key(r.result#>>'{nameSpecialtyProposal,name}')
        )
        then nullif(btrim(r.result#>>'{nameSpecialtyProposal,name}'),'') end as name_specialty,
      coalesce(nullif(btrim(g.profile#>>'{identity,name}'), ''), e.name) as name,
      coalesce(nullif(btrim(g.profile#>>'{identity,city}'), ''),
        private.helpeat_zone_from_saved_address(e.address)) as zone,
      coalesce(nullif(btrim(g.profile#>>'{identity,address}'), ''), e.address) as address,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,latitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,latitude}')::numeric end as latitude,
      case when jsonb_typeof(g.profile#>'{identity,coordinates,longitude}') = 'number'
        then (g.profile#>>'{identity,coordinates,longitude}')::numeric end as longitude,
      case when e.google_maps_url ~ '^https://(www[.]google[.]com/maps/|maps[.]app[.]goo[.]gl/)'
        then e.google_maps_url end as maps_url,
      case when e.photo_url ~ '^https://[A-Za-z0-9.-]+/[^?#[:space:]]+$' then e.photo_url end as photo_url,
      g.profile#>'{hours,weekly}' as weekly_hours
    from private.menu_dish_ai_targets t
    join private.menu_dish_ai_runs r on r.id = t.published_id and r.status = 'succeeded'
    join public.establishments e on e.id = t.establishment_id and e.active and e.place_id = r.place_id
    left join private.restaurant_dish_profiles p on p.scope = t.scope
    left join private.google_place_profiles g on g.establishment_id = e.id and g.organization_id = e.organization_id
      and g.profile#>>'{identity,cid}' = e.google_id and g.profile#>>'{identity,place_id}' = e.place_id
    where r.result#>>'{restaurant_type,value}' = 'street_food'
      and t.scope = private.dish_scope(e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'zone', p.zone, 'address', p.address,
    'venueType', 'street_food', 'photoUrl', p.photo_url, 'specialty', dishes.specialty,
    'specialtySource', case when dishes.specialty is not null
      then case when p.specialty_origin='manual' then 'manual' else 'menu' end end,
    'nameSpecialty', case when p.name_specialty is not null then jsonb_build_object(
      'id', 'name-'||encode(sha256(convert_to(private.dish_key(p.name_specialty),'UTF8')),'hex'),
      'name', p.name_specialty, 'source', 'restaurant_name'
    ) end,
    'latitude', p.latitude, 'longitude', p.longitude, 'mapsUrl', p.maps_url,
    'homeScore', score.global_score, 'homeScoreMax', 6, 'hours', hours.value,
    'dishes', coalesce(dishes.value,'[]'::jsonb)
  ) order by p.id), '[]'::jsonb)
  into result
  from places p
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'enabled', true,
      'source', case when a.origin='manual' then 'manual' else 'menu' end,
      'priceVnd', price.low, 'maxPriceVnd', price.high,
      'imageUrl', image.image_url, 'imageSource', image.image_source
    ) order by (d.id = p.specialty_id) desc nulls last, d.name, d.id) as value,
      max(d.name) filter (where d.id = p.specialty_id) as specialty
    from private.restaurant_dishes a
    join private.dish_names d on d.id = a.dish_id
    left join private.dish_images image on image.dish_id=d.id and image.image_url is not null
    left join lateral (
      select min(amount) as low, max(amount) as high
      from (
        select case when jsonb_typeof(m.original->'price') = 'number'
          then (m.original->>'price')::numeric end as amount
        from private.dish_menu_evidence m
        where m.scope = p.scope and m.run_id = p.published_source_run
          and m.dish_id = d.id and m.decision = 'associated' and m.original->>'currency' = 'VND'
      ) v where amount > 0
    ) price on true
    where a.scope = p.scope and a.enabled
  ) dishes on true
  left join lateral (
    select s.global_score
    from public.restaurant_recommendation_sheets s
    where s.establishment_id = p.id and s.organization_id = p.organization_id
      and not s.stale and s.global_score is not null
    order by s.report_generated_at desc nulls last, s.language
    limit 1
  ) score on true
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', day->'day', 'status', day->'status',
      'intervals', (select coalesce(jsonb_agg(jsonb_build_object('start', w->'start', 'end', w->'end')), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(day->'intervals') = 'array'
          then day->'intervals' else '[]'::jsonb end) w)
    ) order by day->'day'), '[]'::jsonb) as value
    from jsonb_array_elements(case when jsonb_typeof(p.weekly_hours) = 'array'
      then p.weekly_hours else '[]'::jsonb end) day
    where day->>'status' in ('parsed', 'closed')
  ) hours
  where dishes.value is not null or p.name_specialty is not null;

  return jsonb_build_object('source', 'HOME Reviews', 'version', 1, 'restaurants', result);
end;
$function$;

commit;
