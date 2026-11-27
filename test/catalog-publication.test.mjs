import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { homeCatalog } from '../public/catalog.mjs'
import { createRealApi } from '../public/supabase.mjs'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const owner = 'aaaaaaaa-0000-4000-8000-000000000001'
const googleA = 'aaaaaaaa-0000-4000-8000-000000000002'
const googleB = 'aaaaaaaa-0000-4000-8000-000000000003'
const phoDish = 'bbbbbbbb-0000-4000-8000-000000000001'
const bunDish = 'bbbbbbbb-0000-4000-8000-000000000002'
const disabledDish = 'bbbbbbbb-0000-4000-8000-000000000003'
const places = Array.from({ length: 5 }, (_, i) => 'cccccccc-0000-4000-8000-00000000000' + (i + 1))
const runs = Array.from({ length: 5 }, (_, i) => 'dddddddd-0000-4000-8000-00000000000' + (i + 1))
const queuedRun = 'dddddddd-0000-4000-8000-000000000009'
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
  await db.exec(await read('../supabase/migrations/20261125051559_helpeat_street_food_catalog.sql'))
  await db.exec(await read('../supabase/migrations/20261127005140_helpeat_live_home_catalog.sql'))
  await db.exec(`create table private.dish_images(
    dish_id uuid primary key,image_url text,image_source text,image_storage_path text);
    alter table private.dish_images enable row level security;`)
  await db.exec(await read('../supabase/migrations/20261127132027_helpeat_main_dish_images.sql'))
  await query('insert into auth.users (id) values ($1),($2),($3)', [owner, googleA, googleB])
  const [{ id: org }] = (await query('select id from public.organizations where created_by=$1', [owner])).rows
  await query("insert into private.dish_names values ($1,'Phở'),($2,'Bún'),($3,'Cơm')", [phoDish, bunDish, disabledDish])
  await query("insert into private.menu_dish_ai_runs values ($1,'Fixture0','queued','{}')", [queuedRun])
  for (const [i, id] of places.entries()) {
    const scope = i === 1 ? 'shared:fixture' : 'establishment:' + id
    const placeId = i === 1 ? 'SharedFixture' : 'Fixture' + i
    const dish = i === 1 ? bunDish : phoDish
    await query(`insert into public.establishments (id,organization_id,name,google_id,place_id,google_maps_url,photo_url)
      values ($1,$2,'Nom enregistré',$3,$4,'https://www.google.com/maps/search/?api=1','https://lh3.googleusercontent.com/photo')`,
    [id, org, 'cid' + i, placeId])
    await query('insert into private.google_place_profiles values ($1,$2,$3)', [id, org, {
      identity: { name: 'Adresse de test '+i, cid: 'cid'+i, place_id: placeId, city: i === 1 ? 'Hà Nội' : 'Đà Nẵng',
        address: '12 Rue de test', coordinates: { latitude: 16.023, longitude: 108.23 } },
      hours: { weekly: i === 1 ? null : [{ day: 1, status: 'parsed', intervals: [{ start: 480, end: 1260, secret: 'NEVER-EXPORT' }] }] },
      contacts: { privatePhone: 'NEVER-EXPORT' },
    }])
    await query("insert into private.menu_dish_ai_runs values ($1,$2,'succeeded',$3)", [runs[i], i === 4 ? 'oldPlace' : placeId,
      { restaurant_type: { value: i === 2 ? 'family_dining' : 'street_food' }, private: 'NEVER-EXPORT' }])
    await query('insert into private.menu_dish_ai_targets values ($1,$2,$3,$4,$5)',
      [scope, id, i === 0 ? queuedRun : runs[i], i === 3 ? null : runs[i], 'saved-menu'])
    await query('insert into private.restaurant_dish_profiles values ($1,$2)', [scope, dish])
    await query('insert into private.restaurant_dishes (scope,dish_id,status,enabled) values ($1,$2,$3,true)',
      [scope, dish, i === 1 ? 'confirmed' : 'proposed'])
  }
  const scope = 'establishment:' + places[0]
  await query("insert into private.restaurant_dishes (scope,dish_id,status,enabled) values ($1,$2,'confirmed',false)", [scope, disabledDish])
  for (const [run, currency, price] of [['saved-menu', 'VND', 50000], ['saved-menu', 'VND', 55000],
    ['saved-menu', null, 40], ['queued-menu', 'VND', 1000]]) {
    await query("insert into private.dish_menu_evidence values ($1,$2,$3,'associated',$4)",
      [scope, run, phoDish, { price, currency, raw: 'NEVER-EXPORT' }])
  }
  await query(`insert into public.restaurant_recommendation_sheets
    values ($1,$2,5.421,'{"scale":[0,6],"private":"NEVER-EXPORT"}','2026-02-01','vi',false),
    ($3,$2,6,'{"scale":[0,6]}','2026-02-01','vi',true)`, [places[0], org, places[1]])
})

after(async () => db?.close())

test('published HOME classifications supply active dishes and optional facts to both accounts', async () => {
  const first = await asRole('authenticated', googleClaims(googleA), readCatalog)
  const second = await asRole('authenticated', googleClaims(googleB), readCatalog)
  assert.deepEqual(first, second)
  const expected = [[places[0], [phoDish]], [places[1], [bunDish]]]
  assert.deepEqual(first.restaurants.map(place => [place.id, place.dishes.map(dish => dish.id)]), expected)
  const catalog = homeCatalog(first)
  assert.deepEqual(catalog.map(place => [place.id, place.dishes.map(dish => dish.id)]), expected)
  assert.deepEqual(catalog.map(place => [place.score, place.scoreMax]), [[5.421, 6], [null, 6]])
  assert.deepEqual(catalog.map(place => [place.venueType, place.specialty.vi, place.zone]),
    [['street_food', 'Phở', 'Đà Nẵng'], ['street_food', 'Bún', 'Hà Nội']])
  assert.deepEqual(catalog[0].hours, [{ day: 1, status: 'parsed', intervals: [{ start: 480, end: 1260 }] }])
  assert.equal(catalog[0].photo, 'https://lh3.googleusercontent.com/photo')
  assert.deepEqual(catalog.map(place => [place.dishes[0].price, place.dishes[0].maxPrice]), [[50000, 55000], [null, null]])
  assert.deepEqual(catalog[1].hours, [])
  assert.equal(catalog[1].capacity, null)
  assert.doesNotMatch(JSON.stringify(first), /organization_id|NEVER-EXPORT|calculation|verifiedAt|validUntil/)
  assert.equal((await query('select count(*)::int as n from private.helpeat_restaurant_publications')).rows[0].n, 0)
})

test('publishes one image URL for the same dish across menus, with null for missing images', async () => {
  await db.exec('begin')
  try {
    await query("insert into private.restaurant_dishes (scope,dish_id,status,enabled) values ('shared:fixture',$1,'proposed',true)", [phoDish])
    const url = 'https://fixture.supabase.co/storage/v1/object/public/dish-images/current.webp'
    await query("insert into private.dish_images values ($1,$2,'ai_generated','NEVER-EXPORT')", [phoDish, url])
    const value = await asRole('authenticated', googleClaims(googleA), readCatalog)
    const rows = value.restaurants.flatMap(place => place.dishes)
    assert.deepEqual(rows.filter(dish => dish.id === phoDish).map(dish => [dish.imageUrl, dish.imageSource]),
      [[url, 'ai_generated'], [url, 'ai_generated']])
    assert.deepEqual(rows.filter(dish => dish.id === bunDish).map(dish => [dish.imageUrl, dish.imageSource]),
      [[null, null]])
    assert.doesNotMatch(JSON.stringify(value), /NEVER-EXPORT|image_storage_path/)
  } finally { await db.exec('rollback') }
})

test('the next read follows source changes and active dishes while a queued run is pending', async () => {
  await query("update private.menu_dish_ai_runs set result = '{\"restaurant_type\":{\"value\":\"family_dining\"}}' where id=$1", [runs[0]])
  assert.deepEqual((await asRole('authenticated', googleClaims(googleA), readCatalog)).restaurants.map(row => row.id), [places[1]])
  await query("update private.menu_dish_ai_runs set result = '{\"restaurant_type\":{\"value\":\"street_food\"}}' where id=$1", [runs[0]])
  await query("update private.restaurant_dishes set enabled=false where scope='shared:fixture'")
  assert.deepEqual((await asRole('authenticated', googleClaims(googleB), readCatalog)).restaurants.map(row => row.id), [places[0]])
  await query("update public.establishments set active=false where id=$1", [places[0]])
  assert.deepEqual((await asRole('authenticated', googleClaims(googleA), readCatalog)).restaurants, [])
})

test('catalog access needs a verified Google claim and readers cannot read or edit HOME data', async () => {
  await asRole('anon', {}, () => assert.rejects(readCatalog(), { code: '42501' }))
  await asRole('authenticated', { sub: googleA, user_metadata: { provider: 'google' }, amr: [{ method: 'oauth' }] },
    () => assert.rejects(readCatalog(), { code: '42501' }))
  await asRole('authenticated', googleClaims(googleA), async () => {
    for (const table of ['private.menu_dish_ai_runs', 'private.menu_dish_ai_targets', 'private.restaurant_dishes',
      'private.dish_menu_evidence', 'private.google_place_profiles', 'public.restaurant_recommendation_sheets']) {
      await assert.rejects(query('select * from ' + table), { code: '42501' })
    }
    await assert.rejects(query('update private.restaurant_dishes set enabled=true'), { code: '42501' })
    assert.deepEqual((await query('select * from public.establishments')).rows, [])
  })
})

test('the real frontend API filters by meal and zone, ranks confirmed habits and refreshes withdrawn places', async () => {
  const offer = (id, name, meal = 'lunch') => ({ id, name, enabled: true,
    family: 'noodles', meals: meal ? [meal] : [] })
  const pho = offer('pho', 'Phở')
  const restaurants = [
    { id: 'a', name: 'A', zone: 'Đà Nẵng', venueType: 'street_food', latitude: 16.023, longitude: 108.23, homeScore: 90,
      maxGroupSize: 4, budgetPerPersonVnd: 60000, recurringIssues: ['Chờ lâu', 'Đông đúc'],
      dishes: [pho, offer('rice','Cơm'), offer('roll','Cuốn'), offer('soup','Canh')] },
    { id: 'b', name: 'B', zone: 'Đà Nẵng', venueType: 'street_food', latitude: 16.024, longitude: 108.23, homeScore: 85,
      maxGroupSize: 4, budgetPerPersonVnd: 60000, dishes: [pho] },
    { id: 'c', name: 'C', zone: 'Hà Nội', venueType: 'street_food', dishes: [offer('chao','Cháo','breakfast')] },
    { id: 'd', name: 'D', zone: 'Đà Nẵng', venueType: 'street_food', dishes: [offer('can','Bánh căn',null)] },
    { id: 'e', name: 'E', zone: 'Hồ Chí Minh', venueType: 'family_dining', dishes: [pho] },
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
