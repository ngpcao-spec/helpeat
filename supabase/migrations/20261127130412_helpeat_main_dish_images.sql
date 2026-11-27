begin;

-- Keep the existing Helpeat authorization and catalogue selection. Only add an optional dish URL.
do $migration$
declare
 definition text:=pg_get_functiondef('private.helpeat_read_catalog()'::regprocedure);
 value_anchor text:=$anchor$'priceVnd', price.low, 'maxPriceVnd', price.high$anchor$;
 join_anchor text:=$anchor$join private.dish_names d on d.id = a.dish_id$anchor$;
begin
 if (length(definition)-length(replace(definition,value_anchor,'')))/length(value_anchor)<>1
  or (length(definition)-length(replace(definition,join_anchor,'')))/length(join_anchor)<>1 then
  raise exception 'HELPEAT_DISH_IMAGE_CATALOG_VERSION_MISMATCH';
 end if;
 definition:=replace(definition,value_anchor,value_anchor||$$,
      'imageUrl', image.image_url, 'imageSource', image.image_source$$);
 definition:=replace(definition,join_anchor,join_anchor||$$
    left join private.dish_images image on image.dish_id=d.id and image.image_url is not null$$);
 execute definition;
end;
$migration$;

commit;
