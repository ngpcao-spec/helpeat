import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { createRealApi, googleClaims, googleOptions, googleReturn, homePilotGate } from '../public/supabase.mjs'

const sql = path => readFile(new URL('../supabase/' + path, import.meta.url), 'utf8')
const userA = 'aaaaaaaa-0000-4000-8000-000000000001'
const userB = 'bbbbbbbb-0000-4000-8000-000000000002'
const claims = (sub, provider = 'google', method = 'oauth') => ({
  sub, app_metadata: { provider, providers: [provider] }, amr: [{ method }],
})
let db
let day
let yesterday
const query = (statement, params) => db.query(statement, params)
const rows = async (statement, params) => (await query(statement, params)).rows
const save = (date, slot, status, dishes) => query('select public.helpeat_save_meal($1, $2, $3, $4) as id', [date, slot, status, dishes])
const getHabits = async () => (await rows('select public.helpeat_habits() as habits'))[0].habits
const resetRole = () => db.exec('reset role')

async function session(token, role = 'authenticated') {
  await db.exec('set role ' + role)
  await query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(token)])
}

before(async () => {
  db = new PGlite()
  await db.exec(String.raw`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable
      as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
    create function auth.uid() returns uuid language sql stable
      as $$ select (auth.jwt()->>'sub')::uuid $$;
  `)
  await query('insert into auth.users values ($1), ($2)', [userA, userB])
  await db.exec(await sql('migrations/20261124082946_helpeat_journal_and_habits.sql'))
  const [dates] = await rows(`
    select today::text as today, (today - 1)::text as yesterday
    from (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today) as clock
  `)
  day = dates.today
  yesterday = dates.yesterday
})

after(async () => db?.close())

test('Supabase OAuth uses the Pages callback and accepts OAuth claims bound to Google', () => {
  assert.deepEqual(googleOptions('https://ngpcao-spec.github.io/helpeat/'), {
    redirectTo: 'https://ngpcao-spec.github.io/helpeat/?mode=real', queryParams: { prompt: 'select_account' },
  })
  assert.ok(googleClaims(claims(userA)))
  assert.equal(googleClaims(claims(userA, 'google', 'password')), false)
  assert.equal(googleClaims(claims(userA, 'github')), false)
})

test('OAuth return cleanup preserves the real mode and removes aborted PKCE or provider parameters', () => {
  const root = 'https://ngpcao-spec.github.io/helpeat/?mode=real'
  assert.deepEqual(googleReturn(root + '&code=example&sb_flow_id=fixture#today'), { href: root + '#today', hasCode: true })
  assert.deepEqual(googleReturn(root + '#error=access_denied&error_description=fixture'), { href: root, hasCode: false })
  assert.deepEqual(googleReturn(root + '#sb=&access_token=fixture&refresh_token=fixture'), { href: root, hasCode: false })
  assert.equal(googleReturn(root + '#journal'), null)
})

test('production pilot reuses only an approved signed Google session and prompts no new login', async () => {
  const base = 'https://ngpcao-spec.github.io/helpeat/'
  const email = 'tester@example.test'
  const config = {
    url: 'https://test.supabase.co',
    pilotHashes: [userA].map(id => createHash('sha256').update(id).digest('hex')),
  }
  let verified = { claims: { ...claims(userA), email } }
  const gate = homePilotGate(config, {
    getItem(key) {
      assert.equal(key, 'sb-test-auth-token')
      return JSON.stringify({ access_token: 'fixture' })
    },
  }, { auth: { getClaims: async token => {
    assert.equal(token, 'fixture')
    return { data: verified }
  } } })
  let session = null
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      getClaims: async () => ({ data: verified }),
      signOut: async options => {
        assert.deepEqual(options, { scope: 'local' })
        return { data: null }
      },
      signInWithOAuth: async options => {
        assert.deepEqual(options, { provider: 'google', options: {
          redirectTo: base + '?mode=pilot', queryParams: { prompt: 'none', login_hint: email },
        } })
        return { data: null }
      },
    },
  }
  const real = createRealApi(config, base, client, gate)
  assert.equal((await real.api('session')).google, true)
  await real.signIn()
  verified = { claims: { ...claims(userA, 'google', 'password'), email } }
  assert.equal((await real.api('session')).google, false)
  await assert.rejects(real.signIn(), { message: 'pilotHomeRequired' })
  verified = { claims: { ...claims(userB), email } }
  session = { user: { id: userB } }
  const excluded = await real.api('session')
  assert.equal(excluded.account, null)
  assert.equal(excluded.authenticationError, 'pilotAccountRequired')
  assert.equal(excluded.google, false)
})

test('Postgres denies anonymous and cross-account access to meals, items and preferences', async () => {
  try {
    await session(claims(userA))
    const mealA = (await save(day, 'lunch', 'confirmed', ['Phở bò', 'Canh rau'])).rows[0].id
    await query("select public.helpeat_save_preferences('fr', 'Đà Nẵng', '06:00', '10:15', '16:30')")
    const own = await rows('select name from public.helpeat_meal_items where meal_id = $1 order by position', [mealA])
    assert.deepEqual(own.map(item => item.name), ['Phở bò', 'Canh rau'])
    await session(claims(userB))
    const mealB = (await save(day, 'lunch', 'confirmed', ['Bún của B'])).rows[0].id
    await query("select public.helpeat_save_preferences('vi', 'Hà Nội', '06:00', '10:00', '16:30')")
    assert.deepEqual(await rows('select user_id from public.helpeat_meals'), [{ user_id: userB }])
    assert.deepEqual(await rows('select user_id from public.helpeat_profiles where user_id = $1', [userA]), [])
    assert.deepEqual(await rows('select user_id from public.helpeat_notification_settings where user_id = $1', [userA]), [])
    assert.deepEqual(await rows('select name from public.helpeat_meal_items where meal_id = $1', [mealA]), [])
    assert.equal((await query("update public.helpeat_meals set status = 'planned' where id = $1", [mealA])).affectedRows, 0)
    assert.equal((await query('delete from public.helpeat_meal_items where meal_id = $1', [mealA])).affectedRows, 0)
    assert.equal((await query('delete from public.helpeat_meals where id = $1', [mealA])).affectedRows, 0)
    await assert.rejects(query('update public.helpeat_meals set user_id = $1 where id = $2', [userA, mealB]), { code: '42501' })
    await assert.rejects(query("insert into public.helpeat_meals (user_id,meal_date,meal_slot,status) values ($1,$2,'dinner','confirmed')", [userA, day]), { code: '42501' })
    await assert.rejects(query("insert into public.helpeat_meal_items (meal_id,position,name) values ($1,3,'Foreign item')", [mealA]), { code: '23503' })
    await assert.rejects(query("update public.helpeat_profiles set user_id = $1 where user_id = $2", [userA, userB]), { code: '42501' })
    await session({ ...claims(userA, 'email', 'password'), user_metadata: { provider: 'google' } })
    assert.deepEqual(await rows('select id from public.helpeat_meals'), [])
    await assert.rejects(save(day, 'dinner', 'confirmed', ['Wrong login']), { code: '42501' })
    await session({}, 'anon')
    await assert.rejects(query('select * from public.helpeat_meals'), { code: '42501' })
    await assert.rejects(query('select public.helpeat_habits()'), { code: '42501' })
  } finally {
    await resetRole()
  }
})

test('confirmed meals update habits atomically while plans, invalid edits and deletions do not distort them', async () => {
  try {
    await session(claims(userA))
    const oldMeal = (await save(yesterday, 'breakfast', 'planned', ['Cơm chưa ăn'])).rows[0].id
    let habits = await getHabits()
    assert.equal(habits.dishes.some(dish => dish.name === 'Cơm chưa ăn'), false)
    assert.equal(habits.byMeal.breakfast.length, 0)
    await save(yesterday, 'breakfast', 'confirmed', ['Pho bo', '  Cơm tấm  '])
    habits = await getHabits()
    assert.equal(habits.dishes[0].count, 2)
    assert.equal(habits.families.find(family => family.family === 'noodles').count, 2)
    assert.equal(habits.byMeal.breakfast.length, 2)
    assert.deepEqual(habits.recent[0].dishes, ['Phở bò', 'Canh rau'])
    await assert.rejects(save(yesterday, 'breakfast', 'planned', ['Do not replace']), { message: 'alreadyConfirmed' })
    await assert.rejects(save(yesterday, 'breakfast', 'confirmed', ['']), { code: '22023' })
    assert.equal((await getHabits()).byMeal.breakfast.length, 2)
    await save(yesterday, 'breakfast', 'confirmed', ['Bánh mì'])
    assert.deepEqual((await getHabits()).byMeal.breakfast, [{ name: 'Bánh mì', count: 1 }])
    await query('delete from public.helpeat_meals where id = $1', [oldMeal])
    assert.equal((await getHabits()).byMeal.breakfast.length, 0)
    assert.deepEqual(await rows('select name from public.helpeat_meal_items where meal_id = $1', [oldMeal]), [])
  } finally {
    await resetRole()
  }
})
