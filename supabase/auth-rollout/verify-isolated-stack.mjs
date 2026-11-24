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
const sql = statement => execFileSync('docker', [
  'exec', '-i', 'supabase_db_helpeat-auth-validation', 'psql', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-qAt',
], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const client = key => createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
const unwrap = (result, context) => {
  if (result.error) throw new Error(context + ': ' + (result.error.code ?? result.error.message))
  return result.data
}
const admin = client(adminKey)
const password = randomBytes(24).toString('base64url')
const handle = name => name + '@example.test'
const signup = async name => unwrap(await admin.auth.admin.createUser({
  email: handle(name), email_confirm: true, password, user_metadata: { full_name: name },
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
const profileCount = id => Number(sql("select count(*) from public.profiles where user_id = '" + uuid(id) + "';"))

// Supabase owns auth.users and Auth functions. Install only synthetic Home objects in this stack.
const fixture = await read('../../test/fixtures/home-reviews-provisioning.sql')
const marker = 'create table public.profiles ('
assert.ok(fixture.includes(marker))
sql('create schema if not exists private; grant usage on schema private to authenticated;\n' + fixture.slice(fixture.indexOf(marker)))
sql(await read('../migrations/20261124082946_helpeat_journal_and_habits.sql'))

const existing = await signup('restaurant-existing')
const original = organizations(existing)
assert.equal(original.length, 1)
sql(await read('./20261124084826_home_reviews_self_provisioning.sql'))
assert.equal(sql("select has_function_privilege('authenticated','private.provision_home_user(uuid)','EXECUTE')"), 'f')
const legacy = await signup('restaurant-legacy')
assert.equal(organizations(legacy).length, 1)

sql(await read('./20261124082045_helpeat_auth_defer_home_review_provisioning.sql'))
const existingClient = await login('restaurant-existing')
assert.equal(unwrap(await existingClient.browser.rpc('ensure_home_user'), 'Existing Home onboarding'), original[0].id)
assert.deepEqual(organizations(existing), original)

const restaurant = await signup('restaurant-new')
const owner = await login('restaurant-new')
assert.deepEqual(organizations(restaurant), [])
const calls = await Promise.all([owner.browser.rpc('ensure_home_user'), owner.browser.rpc('ensure_home_user')])
const provisioned = calls.map(result => unwrap(result, 'New Home onboarding'))
assert.ok(provisioned[0])
assert.equal(provisioned[0], provisioned[1])
assert.deepEqual(organizations(restaurant).map(org => org.id), [provisioned[0]])
assert.deepEqual(organizations(existing), original)
console.log('HOME Reviews: existing organization retained, legacy trigger verified, concurrent onboarding idempotent.')

const aId = await signup('journal-a')
const bId = await signup('journal-b')
const a = await login('journal-a')
const b = await login('journal-b')
assert.equal((await a.journal.api('session')).account.id, aId)
assert.equal((await b.journal.api('session')).account.id, bId)
assert.deepEqual(organizations(aId), [])
assert.deepEqual(organizations(bId), [])
assert.equal(profileCount(aId), 0)
assert.equal(profileCount(bId), 0)
console.log('HELPEAT: signing up did not create a HOME Reviews organization or profile.')

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
await secondDevice.journal.api('meal', 'PUT', { ...meal, dishes: [{ name: 'Cơm tấm' }] })
assert.deepEqual((await secondDevice.journal.api('habits')).dishes, [{ name: 'Cơm tấm', count: 1 }])
await secondDevice.journal.api('meal', 'DELETE', meal)
assert.deepEqual((await secondDevice.journal.api('journal')).entries, [])
assert.deepEqual((await secondDevice.journal.api('habits')).dishes, [])
console.log('Journal: isolated A/B permissions, two dishes, logout, new authenticated client, edit and delete verified.')
