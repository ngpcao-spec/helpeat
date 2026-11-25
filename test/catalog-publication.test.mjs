import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { approvedCatalog } from '../public/catalog.mjs'
import { createRealApi } from '../public/supabase.mjs'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const owner = 'aaaaaaaa-0000-4000-8000-000000000001'
const googleA = 'aaaaaaaa-0000-4000-8000-000000000002'
const googleB = 'aaaaaaaa-0000-4000-8000-000000000003'
const confirmedDish = 'bbbbbbbb-0000-4000-8000-000000000001'
const proposedDish = 'bbbbbbbb-0000-4000-8000-000000000002'
const disabledDish = 'bbbbbbbb-0000-4000-8000-000000000003'
const expiredDish = 'bbbbbbbb-0000-4000-8000-000000000004'
const staleDish = 'bbbbbbbb-0000-4000-8000-000000000005'
const places = Array.from({ length: 6 }, (_, i) => 'cccccccc-0000-4000-8000-00000000000' + (i + 1))
const googleClaims = sub => ({ sub, app_metadata: { provider: 'google' }, amr: [{ method: 'oauth' }] })
let db
const query = (statement, params) => db.query(statement, params)
const readCatalog = async () => (await query('select public.helpeat_catalog() value')).rows[0].value

async function asRole(role, claims, fn) {
  await db.exec('set role ' + role)
  try {
    await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)])
    return await fn()
  } finally { await db.exec('reset role') }
}

before(async () => {
  db = new PGlite()
  await db.exec(await read('./fixtures/home-reviews-provisioning.sql'))
  await db.exec(`create function auth.jwt() returns jsonb language sql stable
    as $$ select current_setting('request.jwt.claims', true)::jsonb $$;`)
  await db.exec(await read('./fixtures/catalog-sources.sql'))
  await db.exec(await read('../supabase/migrations/20261124082946_helpeat_journal_and_habits.sql'))
  await db.exec(await read('../supabase/migrations/20261125014237_helpeat_home_catalog.sql'))
  await db.exec(await read('../supabase/migrations/20261125050844_helpeat_street_food_catalog.sql'))
  await query('insert into auth.users (id) values ($1),($2),($3)', [owner, googleA, googleB])
  const [{ id: org }] = (await query('select id from public.organizations where created_by=$1', [owner])).rows
  await query("insert into private.dish_names values ($1,'Phở'),($2,'Bún'),($3,'Cơm'),($4,'Cháo'),($5,'Canh')",
    [confirmedDish, proposedDish, disabledDish, expiredDish, staleDish])
  for (const [i, id] of places.entries()) {
    const scope = i === 1 ? 'shared:fixture' : 'establishment:' + id
    const placeId = i === 1 ? 'SharedFixture' : 'Fixture' + i
    const city = i === 1 ? 'Hà Nội' : 'Đà Nẵng'
    await query('insert into public.establishments (id,organization_id,name,google_id,place_id) values ($1,$2,$3,$4,$5)',
      [id, org, 'Nom interne', 'cid' + i, placeId])
    await query('insert into private.google_place_profiles values ($1,$2,$3)', [id, org, {
      identity: { name: 'Adresse publiée '+i, cid: 'cid'+i, place_id: placeId, city, address: '12 Rue de test',
        coordinates: { latitude: 16.023, longitude: 108.23 } },
      contacts: { privatePhone: 'NEVER-EXPORT' },
    }])
    if (i !== 3) {
      await query(`insert into private.helpeat_restaurant_publications
        (establishment_id,published,reviewed_at,review_reference,venue_type,budget_per_person_vnd,max_group_size,publish_score,recurring_issues)
        values ($1,$2,now(),'PRIVATE-APPROVAL',$3,$4,$5,true,array['noise'])`,
      [id, i !== 2, i === 4 ? 'restaurant' : i === 5 ? null : 'street_food', i === 1 ? null : 90000, i === 1 ? null : 4])
    }
    await query(`insert into private.restaurant_dishes (scope,dish_id,status,enabled,evidence)
      values ($1,$2,'confirmed',true,'{"internal":"NEVER-EXPORT"}')`, [scope, confirmedDish])
    if (i !== 3) await query(`insert into private.helpeat_dish_publications
      (establishment_id,dish_id,association_scope,approved,verified_at,valid_until,review_reference,price_vnd,meal_slots,family)
      values ($1,$2,$3,true,now(),null,'PRIVATE-APPROVAL',$4,$5,'noodles')`,
    [id, confirmedDish, scope, i === 1 ? null : 50000, i === 1 ? [] : ['lunch']])
  }
  const scope = 'establishment:' + places[0]
  await query(`insert into private.restaurant_dishes (scope,dish_id,status,enabled)
    values ($1,$2,'proposed',true),($1,$3,'confirmed',false),($1,$4,'confirmed',true)`,
  [scope, proposedDish, disabledDish, expiredDish])
  await query(`insert into private.restaurant_dishes (scope,dish_id,status,enabled,updated_at)
    values ($1,$2,'confirmed',true,now()-interval '100 days')`, [scope, staleDish])
  for (const dish of [proposedDish, disabledDish]) {
    await query(`insert into private.helpeat_dish_publications
      (establishment_id,dish_id,association_scope,approved,verified_at,review_reference)
      values ($1,$2,$3,true,now(),'PRIVATE-APPROVAL')`, [places[0], dish, scope])
  }
  await query(`insert into private.helpeat_dish_publications
    (establishment_id,dish_id,association_scope,approved,verified_at,valid_until,review_reference)
    values ($1,$2,$3,true,now()-interval '2 days',now()-interval '1 day','PRIVATE-APPROVAL'),
    ($1,$4,$3,true,now()-interval '91 days',null,'PRIVATE-APPROVAL')`, [places[0], expiredDish, scope, staleDish])
  await query(`insert into public.restaurant_recommendation_sheets
    values ($1,$2,5.4,'{"scale":[0,6],"comparable":true,"private":"NEVER-EXPORT"}','2026-02-01','vi',false),
    ($3,$2,6,'{"scale":[0,6],"comparable":true}','2026-02-01','vi',true)`, [places[0], org, places[1]])
})

after(async () => db?.close())

test('only explicitly published, matched and currently confirmed dishes leave HOME Reviews', async () => {
  const first = await asRole('authenticated', googleClaims(googleA), readCatalog)
  const second = await asRole('authenticated', googleClaims(googleB), readCatalog)
  assert.deepEqual(first, second)
  assert.deepEqual(first.restaurants.map(place => [place.id, place.dishes.map(dish => dish.id)]),
    [[places[0], [confirmedDish]], [places[1], [confirmedDish]]])
  const catalog = approvedCatalog(first)
  assert.deepEqual(catalog.map(place => [place.id, place.dishes.map(dish => dish.id)]),
    [[places[0], [confirmedDish]], [places[1], [confirmedDish]]])
  assert.deepEqual(catalog.map(place => place.score), [90, null])
  assert.deepEqual(catalog.map(place => place.venueType), ['street_food', 'street_food'])
  const optional = catalog[1]
  assert.deepEqual([optional.budget, optional.capacity, optional.dishes[0].price, optional.dishes[0].meals],
    [null, null, null, []])
  assert.ok(first.restaurants[1].dishes[0].verifiedAt)
  assert.equal(first.restaurants[1].dishes[0].validUntil, null)
  assert.deepEqual(catalog.map(place => place.zone), ['Đà Nẵng', 'Hà Nội'])
  assert.ok(catalog[0].maps.startsWith('https://www.google.com/maps/dir/'))
  assert.deepEqual(catalog[0].issues, [{ vi: 'Ồn ào', fr: 'Bruit' }])
  assert.doesNotMatch(JSON.stringify(first), /organization_id|NEVER-EXPORT|PRIVATE-APPROVAL|Nom interne|calculation/)
})

test('withdrawal, source disablement and broken geographical binding take effect on the next read', async () => {
  await query('update private.helpeat_restaurant_publications set published=false where establishment_id=$1', [places[0]])
  assert.deepEqual((await asRole('authenticated', googleClaims(googleA), readCatalog)).restaurants.map(row => row.id), [places[1]])
  await query('update private.helpeat_restaurant_publications set published=true where establishment_id=$1', [places[0]])
  await query("update private.restaurant_dishes set enabled=false where scope='shared:fixture'")
  assert.deepEqual((await asRole('authenticated', googleClaims(googleB), readCatalog)).restaurants.map(row => row.id), [places[0]])
  await query("update private.google_place_profiles set profile=jsonb_set(profile,'{identity,cid}','\"different\"') where establishment_id=$1", [places[0]])
  assert.deepEqual((await asRole('authenticated', googleClaims(googleA), readCatalog)).restaurants, [])
})

test('catalog access needs a verified Google claim and readers cannot read or edit HOME data', async () => {
  await asRole('anon', {}, () => assert.rejects(readCatalog(), { code: '42501' }))
  await asRole('authenticated', { sub: googleA, user_metadata: { provider: 'google' }, amr: [{ method: 'oauth' }] },
    () => assert.rejects(readCatalog(), { code: '42501' }))
  await asRole('authenticated', googleClaims(googleA), async () => {
    for (const table of ['private.helpeat_restaurant_publications', 'private.helpeat_dish_publications',
      'private.restaurant_dishes', 'private.google_place_profiles', 'public.restaurant_recommendation_sheets']) {
      await assert.rejects(query('select * from ' + table), { code: '42501' })
    }
    await assert.rejects(query('update private.helpeat_restaurant_publications set published=true'), { code: '42501' })
    assert.deepEqual((await query('select * from public.establishments')).rows, [])
  })
})

test('the real frontend API filters by meal and zone, ranks confirmed habits and refreshes withdrawn places', async () => {
  const offer = (id, name, meal = 'lunch') => ({ id, name, confirmed: true, enabled: true,
    verifiedAt: new Date().toISOString(), family: 'noodles', meals: meal ? [meal] : [] })
  const pho = offer('pho', 'Phở')
  const restaurants = [
    { id: 'a', name: 'A', published: true, zone: 'Đà Nẵng', venueType: 'street_food', latitude: 16.023, longitude: 108.23, homeScore: 90,
      maxGroupSize: 4, budgetPerPersonVnd: 60000, recurringIssues: ['Chờ lâu', 'Đông đúc'],
      dishes: [pho, offer('rice','Cơm'), offer('roll','Cuốn'), offer('soup','Canh')] },
    { id: 'b', name: 'B', published: true, zone: 'Đà Nẵng', venueType: 'street_food', latitude: 16.024, longitude: 108.23, homeScore: 85,
      maxGroupSize: 4, budgetPerPersonVnd: 60000, dishes: [pho] },
    { id: 'c', name: 'C', published: true, zone: 'Hà Nội', venueType: 'street_food', dishes: [offer('chao','Cháo','breakfast')] },
    { id: 'd', name: 'D', published: true, zone: 'Đà Nẵng', venueType: 'street_food', dishes: [offer('can','Bánh căn',null)] },
    { id: 'e', name: 'E', published: true, zone: 'Hồ Chí Minh', venueType: 'restaurant', dishes: [pho] },
  ]
  let current = restaurants
  const entry = { meal_date: '2026-11-24', meal_slot: 'lunch', status: 'planned',
    helpeat_meal_items: [{ position: 1, name: 'Phở' }] }
  const builder = { eq: () => builder, select: () => builder, maybeSingle: async () => ({ data: entry }) }
  const rpc = async name => ({ data: name === 'helpeat_catalog'
    ? { source: 'HOME Reviews', version: 1, restaurants: current }
    : { dishes: [{ name: 'Canh', count: 5 }], byMeal: { lunch: [{ name: 'Canh', count: 5 }] } } })
  const { api } = createRealApi({}, 'https://example.test/helpeat/', { rpc, from: () => builder })
  const body = { date: entry.meal_date, meal: 'lunch', zone: 'Da Nang', coordinates: { lat: 16.025, lng: 108.23 } }
  const first = await api('today', 'POST', body)
  assert.equal(first.entry.status, 'planned')
  assert.equal(first.suggestions.length, 3)
  assert.equal(first.suggestions[0].id, 'soup')
  const detail = await api('today', 'POST', { ...body, detailId: 'pho' })
  assert.deepEqual(detail.suggestions[0].restaurants.map(place => place.id), ['b','a'])
  assert.ok(detail.suggestions[0].restaurants.every(place => place.distanceKm > 0))
  assert.deepEqual((await api('today','POST',{ ...body, zone: 'Hà Nội' })).suggestions, [])
  assert.deepEqual((await api('today','POST',{ ...body, zone: 'Hồ Chí Minh' })).suggestions, [])
  assert.deepEqual((await api('today','POST',{ ...body, zone: 'Ha Noi', meal: 'breakfast' })).suggestions.map(dish => dish.id), ['chao'])
  const outing = await api('outing','POST',{ zone: 'Da Nang', party: 2, budget: 130000, wish: 'phở' })
  assert.deepEqual(outing.suggestions.map(place => place.id), ['b','a','d'])
  const [unknown] = (await api('outing','POST',{ zone: 'Da Nang', party: 5, budget: 400000 })).suggestions
  assert.deepEqual([unknown.id, unknown.total, unknown.capacity, unknown.score], ['d', null, null, null])
  current = restaurants.filter(place => place.id !== 'a')
  assert.deepEqual((await api('today','POST',{ ...body, detailId: 'pho' })).suggestions[0].restaurants.map(place => place.id), ['b'])
  current = []
  assert.equal((await api('today','POST',body)).hasCatalog, false)
})
