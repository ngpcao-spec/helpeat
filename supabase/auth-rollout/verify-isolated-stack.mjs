import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createRealApi } from '../../public/supabase.mjs'
import { vietnamTime } from '../../public/time.mjs'

const stack = process.env.HELPEAT_ISOLATED_STACK
assert.ok(stack, 'A disposable Supabase stack is required')
const status = JSON.parse(await readFile(join(stack, 'status.json'), 'utf8'))
const apiUrl = status.API_URL
const localUri = new URL(apiUrl)
assert.ok(['127.0.0.1', 'localhost'].includes(localUri.hostname) && localUri.port === '54321')
assert.equal(localUri.protocol, 'http:')
const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY
const adminKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY
assert.ok(publicKey && adminKey, 'Local Supabase did not return its development keys')

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const databaseCommand = (args, input) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_helpeat-auth-validation', ...args,
], { input, maxBuffer: 16 * 1024 * 1024 })
const sql = (statement, database = 'postgres') => databaseCommand([
  'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt',
], statement).toString('utf8').trim()
const client = key => createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
const unwrap = (result, context) => {
  if (result.error) throw new Error(context + ': ' + (result.error.code ?? result.error.message))
  return result.data
}
const admin = client(adminKey)
const password = randomBytes(24).toString('base64url')
const handle = name => name + '@example.test'
const signup = async (name, metadata = {}) => unwrap(await admin.auth.admin.createUser({
  email: handle(name), email_confirm: true, password, user_metadata: { full_name: name, ...metadata },
}), 'Local Auth registration').user.id
async function login(name) {
  const browser = client(publicKey)
  const signed = unwrap(await browser.auth.signInWithPassword({ email: handle(name), password }), 'Local Auth sign-in')
  const journal = createRealApi({ url: apiUrl, key: publicKey }, 'https://example.test/helpeat/', browser)
  return { browser, journal, id: signed.user.id }
}
const uuid = id => {
  assert.match(id, /^[0-9a-f-]{36}$/i)
  return id
}
const organizations = id => JSON.parse(sql(
  "select coalesce(json_agg(organization order by id), '[]') from public.organizations organization where created_by = '" + uuid(id) + "';",
))

// Supabase owns auth.users and Auth functions. Install only synthetic Home objects in this stack.
const fixture = await read('../../test/fixtures/home-reviews-provisioning.sql')
const marker = 'create table public.profiles ('
assert.ok(fixture.includes(marker))
sql('create schema if not exists private; grant usage on schema private to authenticated;\n' + fixture.slice(fixture.indexOf(marker)))
sql(await read('../migrations/20261124082946_helpeat_journal_and_habits.sql'))

const existing = await signup('restaurant-existing')
const original = organizations(existing)
assert.equal(original.length, 1)
const existingOrg = uuid(original[0].id)
const establishment = uuid(sql(`insert into public.establishments (organization_id, name)
  values ('${existingOrg}', 'Café fixture') returning id;`))
sql(`insert into public.reviews (organization_id, establishment_id, rating)
  values ('${existingOrg}', '${establishment}', 5);`)

const snapshotMeal = { date: vietnamTime().date, meal: 'lunch', status: 'confirmed',
  dishes: [{ name: 'Bánh mì' }] }
const beforeDeployment = await login('restaurant-existing')
await beforeDeployment.journal.api('meal', 'PUT', snapshotMeal)

// Rehearse a logical restore using only the synthetic data in this local container.
const restoredDb = 'helpeat_restore_rehearsal'
const archived = databaseCommand(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--format=custom',
  '--strict-names', '--schema=auth', '--schema=private', '--schema=public'])
databaseCommand(['createdb', '-U', 'postgres', '--template=template0', restoredDb])
// The dump owns the public schema definition. Remove the empty template schema first.
sql(`drop schema public;
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create extension "uuid-ossp" with schema extensions;`, restoredDb)
// The stock container's local administrator can restore the managed Auth owners and grants.
databaseCommand(['pg_restore', '-U', 'supabase_admin', '-d', restoredDb, '--exit-on-error', '--single-transaction'], archived)
const snapshot = `select md5(jsonb_build_object(
  'users', (select jsonb_agg(to_jsonb(entry) order by id) from auth.users entry),
  'identities', (select jsonb_agg(to_jsonb(entry) order by id) from auth.identities entry),
  'profiles', (select jsonb_agg(to_jsonb(entry) order by user_id) from public.profiles entry),
  'organizations', (select jsonb_agg(to_jsonb(entry) order by id) from public.organizations entry),
  'members', (select jsonb_agg(to_jsonb(entry) order by organization_id, user_id) from public.organization_members entry),
  'establishments', (select jsonb_agg(to_jsonb(entry) order by id) from public.establishments entry),
  'reviews', (select jsonb_agg(to_jsonb(entry) order by id) from public.reviews entry),
  'meals', (select jsonb_agg(to_jsonb(entry) order by id) from public.helpeat_meals entry),
  'items', (select jsonb_agg(to_jsonb(entry) order by meal_id, position) from public.helpeat_meal_items entry),
  'legacy_trigger', pg_get_triggerdef((select oid from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created')),
  'auth_owner', (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth'),
  'trigger_acl', (select proacl::text from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
  'policies', (select jsonb_agg(to_jsonb(entry) order by schemaname, tablename, policyname)
    from pg_policies entry where schemaname in ('public', 'private', 'auth'))
)::text);`
const sourceSnapshot = sql(snapshot)
assert.match(sourceSnapshot, /^[a-f0-9]{32}$/)
assert.equal(sql(`select count(*) from auth.identities where user_id = '${uuid(existing)}';`), '1')
assert.equal(sql(snapshot, restoredDb), sourceSnapshot)
assert.equal(sql(`begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${uuid(existing)}","app_metadata":{"provider":"google"},"amr":[{"method":"oauth"}]}', true);
  select count(*) from public.helpeat_meals;
  rollback;`, restoredDb).split('\n').at(-1), '1')
console.log('Logical restore rehearsal: synthetic Auth users and identities, organizations, reviews, journal, trigger and RLS restored in a separate database.')

sql(await read('./20261124084826_home_reviews_self_provisioning.sql'))
assert.equal(sql("select has_function_privilege('authenticated','private.provision_home_user(uuid)','EXECUTE')"), 'f')
const legacy = await signup('restaurant-legacy')
assert.equal(organizations(legacy).length, 1)
const premature = await signup('helpeat-before-cutover', { app: 'helpeat' })
assert.equal(organizations(premature).length, 1)
console.log('Cutover gate: before phase two a new Auth user creates a HOME Reviews organization even when signup metadata identifies Helpeat.')

sql(await read('./20261124102903_separate_helpeat_signup.sql'))
const anonymous = await client(publicKey).rpc('ensure_home_user')
assert.equal(anonymous.error?.code, '42501')
const existingClient = await login('restaurant-existing')
assert.equal(unwrap(await existingClient.browser.rpc('ensure_home_user'), 'Existing Home onboarding'), existingOrg)
assert.deepEqual(organizations(existing), original)
assert.deepEqual(unwrap(await existingClient.browser.from('organization_members').select('role'), 'Existing membership'),
  [{ role: 'owner' }])
assert.deepEqual(unwrap(await existingClient.browser.from('reviews').select('rating'), 'Existing reviews'), [{ rating: 5 }])
assert.deepEqual(unwrap(await existingClient.browser.from('establishments').update({ name: 'Café fixture modifié' })
  .eq('id', establishment).select('id'), 'Existing owner establishment update'), [{ id: establishment }])

const restaurant = await signup('restaurant-new')
const [owner, concurrentOwner] = await Promise.all([login('restaurant-new'), login('restaurant-new')])
assert.deepEqual(organizations(restaurant), [])
assert.equal(owner.id, concurrentOwner.id)
const calls = await Promise.all([owner.browser.rpc('ensure_home_user'), concurrentOwner.browser.rpc('ensure_home_user')])
const provisioned = calls.map(result => unwrap(result, 'New Home onboarding'))
assert.ok(provisioned[0])
assert.equal(provisioned[0], provisioned[1])
assert.deepEqual(organizations(restaurant).map(org => org.id), [provisioned[0]])
assert.deepEqual(organizations(existing), original)
assert.deepEqual(unwrap(await owner.browser.from('organizations').select('id'), 'New owner organizations'),
  [{ id: provisioned[0] }])
assert.deepEqual(unwrap(await owner.browser.from('establishments').select('id').eq('id', establishment), 'Foreign establishment'),
  [])
assert.deepEqual(unwrap(await owner.browser.from('reviews').select('id').eq('establishment_id', establishment), 'Foreign reviews'),
  [])
assert.deepEqual(unwrap(await owner.browser.from('establishments').update({ name: 'Unexpected edit' })
  .eq('id', establishment).select('id'), 'Foreign establishment update'), [])
console.log('HOME Reviews: existing organization, roles, reviews and establishment edits preserved; concurrent onboarding and tenant isolation verified.')

const aId = await signup('journal-a', { app: 'home-reviews', role: 'owner', organization_id: existingOrg })
const bId = await signup('journal-b')
const a = await login('journal-a')
const b = await login('journal-b')
assert.equal((await a.journal.api('session')).account.id, aId)
assert.equal((await b.journal.api('session')).account.id, bId)
assert.deepEqual(organizations(aId), [])
assert.deepEqual(organizations(bId), [])
assert.deepEqual(unwrap(await a.browser.from('profiles').select('user_id,display_name,email,avatar_url'), 'Shared profile'),
  [{ user_id: aId, display_name: 'journal-a', email: null, avatar_url: null }])
assert.deepEqual(unwrap(await b.browser.from('profiles').select('user_id').eq('user_id', aId), 'Foreign shared profile'), [])
assert.deepEqual(unwrap(await a.browser.from('organization_members').select('role'), 'Helpeat memberships'), [])
assert.deepEqual(unwrap(await a.browser.from('notification_preferences').select('user_id'), 'Helpeat notification preferences'), [])
console.log('Helpeat: signup created a private minimal profile and no restaurant organization, role or notification preferences, including with client metadata.')

const meal = { date: vietnamTime().date, meal: 'dinner', status: 'confirmed',
  dishes: [{ name: 'Phở bò' }, { name: 'Canh rau' }] }
await a.journal.api('meal', 'PUT', meal)
const [{ id: mealId }] = unwrap(await a.browser.from('helpeat_meals').select('id'), 'Account A reads its meal')
assert.deepEqual((await b.journal.api('journal')).entries, [])
const bUpdate = unwrap(await b.browser.from('helpeat_meals').update({ status: 'planned' }).eq('id', mealId).select('id'),
  'Account B attempted to update the fixture')
assert.deepEqual(bUpdate, [])

await a.journal.api('logout', 'POST')
assert.equal((await a.journal.api('session')).account, null)
const secondDevice = await login('journal-a')
assert.equal(secondDevice.id, aId)
assert.deepEqual((await secondDevice.journal.api('journal')).entries, [meal])
const homeFromSameIdentity = unwrap(await secondDevice.browser.rpc('ensure_home_user'), 'Helpeat user opening HOME Reviews')
assert.deepEqual(organizations(aId).map(org => org.id), [homeFromSameIdentity])
assert.deepEqual((await secondDevice.journal.api('journal')).entries, [meal])
assert.deepEqual((await existingClient.journal.api('journal')).entries, [snapshotMeal])
console.log('Shared identity: HOME Reviews onboarding reuses the Helpeat user ID and preserves the private journal.')
await secondDevice.journal.api('meal', 'PUT', { ...meal, dishes: [{ name: 'Cơm tấm' }] })
assert.deepEqual((await secondDevice.journal.api('habits')).dishes, [{ name: 'Cơm tấm', count: 1 }])
await secondDevice.journal.api('meal', 'DELETE', meal)
assert.deepEqual((await secondDevice.journal.api('journal')).entries, [])
assert.deepEqual((await secondDevice.journal.api('habits')).dishes, [])
console.log('Journal: isolated A/B permissions, two dishes, logout, new authenticated client, edit and delete verified.')

sql(await read('./rollback-trigger.sql'))
const afterRollback = await signup('restaurant-after-rollback')
assert.equal(organizations(afterRollback).length, 1)
assert.deepEqual(organizations(aId).map(org => org.id), [homeFromSameIdentity])
assert.deepEqual(organizations(bId), [])
assert.deepEqual((await existingClient.journal.api('journal')).entries, [snapshotMeal])
assert.equal(sql("select has_function_privilege('authenticated','private.provision_home_user(uuid)','EXECUTE')"), 'f')
console.log('Rollback: legacy signup restored and previous organizations, minimal profiles and the caller-only RPC retained.')

sql(await read('../../test/fixtures/catalog-sources.sql'))
sql(await read('../migrations/20261125012927_helpeat_home_catalog.sql'))
const dishId = uuid(sql("insert into private.dish_names values (gen_random_uuid(),'Bánh căn') returning id;"))
sql(`update public.establishments set google_id='fixture-cid' where id='${establishment}';
  insert into private.google_place_profiles values ('${establishment}','${existingOrg}',
    '{"identity":{"name":"Café autorisé","cid":"fixture-cid","city":"Đà Nẵng","address":"12 Rue de test","coordinates":{"latitude":16.023,"longitude":108.23}},"internal":"DO-NOT-PUBLISH"}');
  insert into private.restaurant_dishes (scope,dish_id,status,enabled)
    values ('establishment:${establishment}','${dishId}','confirmed',true);
  insert into private.helpeat_restaurant_publications (establishment_id,published,reviewed_at,review_reference)
    values ('${establishment}',true,now(),'isolated approval');
  insert into private.helpeat_dish_publications
    (establishment_id,dish_id,association_scope,approved,verified_at,valid_until,review_reference,meal_slots)
    values ('${establishment}','${dishId}','establishment:${establishment}',true,now(),now()+interval '7 days','isolated check',array['lunch']);`)

const catalogA = unwrap(await secondDevice.browser.rpc('helpeat_catalog'), 'Catalog account A')
const catalogB = unwrap(await b.browser.rpc('helpeat_catalog'), 'Catalog account B')
assert.deepEqual(catalogA, catalogB)
assert.deepEqual(catalogA.restaurants.map(place => [place.id, place.dishes[0].id]), [[establishment, dishId]])
assert.doesNotMatch(JSON.stringify(catalogA), /DO-NOT-PUBLISH|organization_id|isolated approval/)
assert.equal((await client(publicKey).rpc('helpeat_catalog')).error?.code, '42501')
assert.ok((await b.browser.from('restaurant_recommendation_sheets').select('*')).error)
assert.deepEqual(unwrap(await b.browser.from('establishments').select('id'), 'Foreign HOME establishments'), [])
const nearby = await secondDevice.journal.api('today', 'POST', { date: vietnamTime().date, meal: 'lunch', zone: 'Da Nang' })
assert.deepEqual(nearby.suggestions.map(dish => dish.id), [dishId])
sql(`update private.helpeat_restaurant_publications set published=false where establishment_id='${establishment}';`)
assert.deepEqual(unwrap(await b.browser.rpc('helpeat_catalog'), 'Catalog withdrawal').restaurants, [])
console.log('Catalog: two independently signed local Auth sessions read the same approved dish; anonymous and private HOME access denied; withdrawal immediate.')
