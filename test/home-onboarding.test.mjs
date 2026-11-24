import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const phaseOne = () => read('../supabase/auth-rollout/20261124084826_home_reviews_self_provisioning.sql')
const phaseTwo = () => read('../supabase/auth-rollout/20261124082045_helpeat_auth_defer_home_review_provisioning.sql')
const owner = 'aaaaaaaa-1111-4000-8000-000000000001'
const legacySignup = 'bbbbbbbb-1111-4000-8000-000000000002'
const newHelpeat = 'cccccccc-1111-4000-8000-000000000003'
const invited = 'dddddddd-1111-4000-8000-000000000004'
let db
let retainedOrganization

const query = (sql, params) => db.query(sql, params)
const rows = async (sql, params) => (await query(sql, params)).rows
const organizations = id => rows('select * from public.organizations where created_by = $1', [id])
const profile = id => rows('select * from public.profiles where user_id = $1', [id])
const ensure = async () => (await rows('select public.ensure_home_user() as id'))[0].id
const addUser = (id, name) => query('insert into auth.users values ($1, $2, $3)', [
  id, name.toLowerCase().replaceAll(' ', '.') + '@example.test', JSON.stringify({ full_name: name }),
])

async function asRole(role, subject, callback) {
  await db.exec('set role ' + role)
  try {
    await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(subject ? { sub: subject } : {})])
    return await callback()
  } finally {
    await db.exec('reset role')
  }
}

before(async () => {
  db = new PGlite()
  await db.exec(await read('./fixtures/home-reviews-provisioning.sql'))
  await addUser(owner, 'Comptoir existant')
  await query("update public.profiles set preferred_language = 'fr' where user_id = $1", [owner])
  await query('update public.organizations set monitoring_interval_hours = 24 where created_by = $1', [owner])
  retainedOrganization = (await organizations(owner))[0]
})

after(async () => db?.close())

test('the trigger migration cannot run before the authenticated self-provisioning migration', async () => {
  await assert.rejects(db.exec(await phaseTwo()), { message: 'HOME_ONBOARDING_RPC_REQUIRED' })
  await db.exec('rollback')
  assert.equal((await rows("select to_regprocedure('public.ensure_home_user()') as rpc"))[0].rpc, null)
})

test('phase one narrows execution privileges and preserves the existing signup trigger and organization', async () => {
  await db.exec(await phaseOne())
  const [access] = await rows(`
    select
      has_function_privilege('authenticated','public.ensure_home_user()','execute') as caller,
      has_function_privilege('anon','public.ensure_home_user()','execute') as anonymous,
      has_function_privilege('service_role','public.ensure_home_user()','execute') as service,
      has_function_privilege('authenticated','private.provision_home_user(uuid)','execute') as legacy,
      (select not prosecdef from pg_proc where oid='public.ensure_home_user()'::regprocedure) as public_invoker
  `)
  assert.deepEqual(access, { caller: true, anonymous: false, service: false, legacy: false, public_invoker: true })
  await asRole('anon', null, () => assert.rejects(ensure(), { code: '42501' }))
  await asRole('service_role', null, () => assert.rejects(ensure(), { code: '42501' }))
  await asRole('authenticated', null, () => assert.rejects(ensure(), { message: 'AUTH_REQUIRED' }))
  await asRole('authenticated', owner, async () => {
    await assert.rejects(query('select public.ensure_home_user($1::uuid)', [legacySignup]), { code: '42883' })
    assert.equal(await ensure(), retainedOrganization.id)
  })
  assert.deepEqual(await organizations(owner), [retainedOrganization])
  assert.equal((await profile(owner))[0].preferred_language, 'fr')
  await addUser(legacySignup, 'HOME Reviews ancien parcours')
  assert.equal((await organizations(legacySignup)).length, 1)
  assert.equal((await profile(legacySignup)).length, 1)
})

test('after phase two a HELPEAT signup creates no restaurant data and explicit HOME onboarding is idempotent', async () => {
  await db.exec(await phaseTwo())
  await addUser(newHelpeat, 'Nouveau compte')
  assert.deepEqual(await organizations(newHelpeat), [])
  assert.deepEqual(await profile(newHelpeat), [])
  assert.deepEqual(await rows('select user_id from public.notification_preferences where user_id=$1', [newHelpeat]), [])
  const first = await asRole('authenticated', newHelpeat, ensure)
  assert.equal(await asRole('authenticated', newHelpeat, ensure), first)
  assert.deepEqual((await organizations(newHelpeat)).map(org => org.id), [first])
  assert.deepEqual(await rows('select role from public.organization_members where user_id=$1', [newHelpeat]), [{ role: 'owner' }])
  assert.equal((await profile(newHelpeat))[0].display_name, 'Nouveau compte')
  assert.deepEqual(await organizations(owner), [retainedOrganization])
})

test('invited members keep their role and revoked access is not restored', async () => {
  await addUser(invited, 'Membre invité')
  await query("insert into public.organization_members values ($1,$2,'member')", [retainedOrganization.id, invited])
  assert.equal(await asRole('authenticated', invited, ensure), retainedOrganization.id)
  assert.deepEqual(await organizations(invited), [])
  assert.deepEqual(await rows('select role from public.organization_members where user_id=$1', [invited]), [{ role: 'member' }])
  assert.equal((await profile(invited))[0].display_name, 'Membre invité')

  await query('delete from public.organization_members where user_id=$1', [legacySignup])
  await asRole('authenticated', legacySignup, () => assert.rejects(ensure(), { message: 'HOME_MEMBERSHIP_REQUIRED' }))
  assert.deepEqual(await rows('select role from public.organization_members where user_id=$1', [legacySignup]), [])
  assert.equal((await organizations(legacySignup)).length, 1)
})
