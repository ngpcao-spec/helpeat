import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { compactProviderRequest, resolveCompactRecommendations } from '../supabase/functions/helpeat-daily/compact-request.mjs'
import { createHandler } from '../supabase/functions/helpeat-daily/index.mjs'
import { checkedRecommendations, prepareRecommendationContext, prompt, providerRequest, recommendationContext, usageMetrics } from '../supabase/functions/helpeat-daily/recommendation.mjs'
import { createRealApi } from '../public/supabase.mjs'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'aaaaaaaa-0000-4000-8000-000000000002'
const date = '2026-11-27'
const now = () => new Date(date + 'T04:00:00Z')
const target = { date, meal: 'lunch' }
const names = ['Phở bò', 'Bún bò', 'Cơm tấm', 'Bánh căn', 'Gỏi cuốn', 'Cháo gà']
const row = (meal_date, meal_slot, dishes, status = 'confirmed') => ({
  meal_date, meal_slot, status, helpeat_meal_items: dishes.map((name, position) => ({ name, position })),
})
const profiles = [
  [],
  [row('2026-11-25', 'lunch', ['Phở bò']), row('2026-11-26', 'breakfast', ['Phở bò'])],
  [row('2026-11-24', 'dinner', ['Cơm tấm']), row('2026-11-26', 'lunch', ['Cơm gà'])],
  [row('2026-11-26', 'lunch', ['Gỏi cuốn']), row('2026-11-26', 'dinner', ['Bánh căn']), row(date, 'breakfast', ['Bún bò'])],
  [row('2026-11-25', 'lunch', ['Phở bò']), row('2026-11-26', 'lunch', ['Phở bò']), row(date, 'breakfast', ['Phở bò'])],
  [row(date, 'breakfast', ['Cháo gà', 'Gỏi cuốn'])],
  [row('2026-11-23', 'breakfast', ['Cháo gà']), row(date, 'lunch', ['Cơm tấm'], 'planned')],
]
const catalog = (count = names.length) => ({ source: 'HOME Reviews', version: 1, restaurants: [
  { id: 'street', name: 'Quán thử', zone: 'Khánh Hòa', venueType: 'street_food',
    dishes: Array.from({ length: count }, (_, i) => ({ id: 'dish' + i, name: names[i] ?? 'Món ' + i, enabled: true })) },
  { id: 'family', name: 'Nhà hàng thử', zone: 'Khánh Hòa', venueType: 'family_dining',
    dishes: [{ id: 'not-eligible', name: 'Khác', enabled: true }] },
] })
const habits = { dishes: [], families: [], byMeal: { breakfast: [], lunch: [], dinner: [] }, recent: [] }

test('profiles A–G retain confirmed meals, dates and portions of the catalogue beyond the classic shortlist', () => {
  for (const [i, meals] of profiles.entries()) {
    const context = recommendationContext({ catalog: catalog(27), habits, meals, today: date, target, zone: 'Khanh Hoa',
      locale: i % 2 ? 'fr' : 'vi' })
    assert.equal(context.candidates.length, 27)
    assert.equal(context.confirmed_meals.length, meals.filter(meal => meal.status === 'confirmed').length)
    assert.equal(context.language, i % 2 ? 'français' : 'tiếng Việt')
    const pho = context.candidates.find(dish => dish.name === 'Phở bò')
    assert.equal(pho.journal_exact_match?.count ?? 0, i === 1 ? 2 : i === 4 ? 3 : 0)
    assert.ok(context.candidates.every(dish => dish.dish_id !== 'not-eligible'))
    if (i === 5) assert.deepEqual(context.confirmed_meals[0].dishes, ['Cháo gà', 'Gỏi cuốn'])
    if (i === 6) assert.deepEqual(context.confirmed_meals.map(meal => meal.date), ['2026-11-23'])
  }
})

test('compact requests keep same-name addresses separate and retain dish-specific prices and known history', () => {
  const source = catalog(2)
  const [venue] = source.restaurants
  const firstVenueId = 'bbbbbbbb-0000-4000-8000-000000000001'
  const secondVenueId = 'bbbbbbbb-0000-4000-8000-000000000002'
  const phoId = 'cccccccc-0000-4000-8000-000000000001'
  const bunId = 'cccccccc-0000-4000-8000-000000000002'
  venue.id = firstVenueId
  const days = [{ day: 0, status: 'closed', intervals: [] }]
  venue.hours = days
  venue.homeScore = 0
  venue.homeScoreMax = 6
  const [pho, bun] = venue.dishes
  pho.id = phoId
  bun.id = bunId
  pho.priceVnd = 25_000
  pho.maxPriceVnd = 40_000
  bun.priceVnd = 55_000
  source.restaurants.push({ ...venue, id: secondVenueId, homeScore: 98, homeScoreMax: 100,
    dishes: [{ ...pho, priceVnd: 90_000, maxPriceVnd: 120_000 }] })
  const recent = [{ date, meal: 'breakfast', dishes: ['Phở bò'] }]
  const options = { catalog: source, habits: { ...habits, recent }, meals: [row(date, 'breakfast', ['Phở bò'])],
    target, today: date, zone: 'Khánh Hòa', locale: 'fr' }
  const { context, restaurantIdsByDish } = prepareRecommendationContext(options)
  const settings = { model: 'gpt-5.5', effort: 'high' }
  const compact = compactProviderRequest(context, restaurantIdsByDish, settings)
  const input = JSON.parse(compact.body.input)
  assert.equal(compact.body.instructions, prompt)
  assert.equal(compact.body.model, settings.model)
  assert.deepEqual(compact.body.reasoning, { effort: 'high' })
  assert.deepEqual(input.confirmed_meals, recent)
  assert.deepEqual(input.habits, { recent_confirmed_meals_prefix_count: 1 })
  assert.equal(input.requested_count, 2)
  assert.equal(Object.keys(input.restaurants).length, 2)
  assert.deepEqual(input.candidates.map(dish => dish.dish_id), ['d1', 'd2'])
  assert.deepEqual(input.candidates[0].journal_exact_match, { count: 1, last_date: date, last_meal: 'breakfast' })
  assert.ok(!('journal_exact_match' in input.candidates[1]))

  const [sharedPriceRange, alternatePriceRange] = [...input.candidates[0].restaurants].sort((a, b) => a.price_vnd - b.price_vnd)
  const [bunLink] = input.candidates[1].restaurants
  assert.deepEqual(sharedPriceRange, { restaurant_id: bunLink.restaurant_id, price_vnd: 25_000, max_price_vnd: 40_000 })
  assert.equal(bunLink.price_vnd, 55_000)
  assert.notEqual(alternatePriceRange.restaurant_id, bunLink.restaurant_id)
  assert.deepEqual([alternatePriceRange.price_vnd, alternatePriceRange.max_price_vnd], [90_000, 120_000])
  assert.equal(input.restaurants[bunLink.restaurant_id].name, input.restaurants[alternatePriceRange.restaurant_id].name)
  assert.deepEqual(input.restaurants[bunLink.restaurant_id].weekly_hours, days)
  assert.equal(input.restaurants[bunLink.restaurant_id].home_reviews_score.value, 0)
  assert.equal(input.candidates[0].restaurants[0].price_vnd, context.candidates[0].restaurants[0].price_vnd)
  assert.ok(!('price_vnd' in input.restaurants[bunLink.restaurant_id]))
  for (const id of [firstVenueId, secondVenueId, phoId, bunId]) assert.ok(!compact.body.input.includes(id))

  const picks = [{ dish_id: 'd1', reason: 'Premier choix.' }, { dish_id: 'd2', reason: 'Deuxième choix.' }]
  assert.deepEqual(resolveCompactRecommendations({ recommendations: picks }, compact, context.candidates),
    [{ ...picks[0], dish_id: phoId }, { ...picks[1], dish_id: bunId }])
  assert.equal(resolveCompactRecommendations({ recommendations: [picks[0], picks[0]] }, compact, context.candidates), null)
  assert.equal(resolveCompactRecommendations({ recommendations: [picks[0], { ...picks[1], dish_id: 'd999' }] },
    compact, context.candidates), null)

  const alternate = [{ date, meal: 'lunch', dishes: ['Bún bò'] }]
  const nonPrefix = compactProviderRequest({ ...context, habits: { ...habits, recent: alternate } }, restaurantIdsByDish, settings)
  assert.deepEqual(JSON.parse(nonPrefix.body.input).habits, { recent: alternate })
})

function harness(initialFormat = 'compact_v1') {
  let menus = catalog()
  let meals = profiles[1]
  let format = initialFormat
  let disabled = false
  let fail = false
  const calls = []
  const scopes = new Map()
  const runs = new Map()
  const finishes = []
  const network = async (url, options) => {
    const path = new URL(url).pathname
    const body = options.body ? JSON.parse(options.body) : null
    const id = options.headers.Authorization === 'Bearer accountA' ? A : B
    if (path === '/auth/v1/user') {
      if (!['Bearer accountA', 'Bearer accountB'].includes(options.headers.Authorization)) return Response.json({}, { status: 401 })
      return Response.json({ id, app_metadata: { provider: 'google' } })
    }
    if (path.endsWith('/helpeat_daily_ai_config')) return Response.json(disabled ? null : { model: 'gpt-5.5', effort: 'high' })
    if (path.endsWith('/helpeat_catalog')) return Response.json(menus)
    if (path.endsWith('/helpeat_habits')) return Response.json(habits)
    if (path.endsWith('/helpeat_meals')) {
      const values = new URL(url).searchParams
      assert.equal(values.get('user_id'), 'eq.' + id)
      assert.equal(values.get('status'), 'eq.confirmed')
      return Response.json(id === A ? meals : [row(date, 'breakfast', ['Repas de B'])])
    }
    if (path.endsWith('/helpeat_daily_ai_reserve_for_format')) {
      const scope = body.p_user + body.p_hash
      const previous = scopes.get(scope) ?? []
      const last = previous.at(-1)
      if (last && (last.state !== 'success' || last.id !== body.p_refresh)) return Response.json(last)
      const excluded = previous.flatMap(entry => entry.result.map(item => item.dish_id))
      if (excluded.length >= body.p_candidates) return Response.json({ state: 'exhausted' })
      const run = { id: crypto.randomUUID(), state: 'pending' }
      runs.set(run.id, run)
      scopes.set(scope, [...previous, run])
      return Response.json({ ...run, state: 'reserved', excluded, format_version: format })
    }
    if (path.endsWith('/helpeat_daily_ai_finish')) {
      finishes.push(body)
      Object.assign(runs.get(body.p_run), { state: body.p_result ? 'success' : 'failed', result: body.p_result })
      return Response.json(true)
    }
    if (path === '/v1/responses') {
      calls.push(body)
      await new Promise(resolve => setTimeout(resolve, 10))
      if (fail) return Response.json({}, { status: 503 })
      const input = JSON.parse(body.input)
      const recommendations = input.candidates.slice(-input.requested_count).map(item => ({
        dish_id: item.dish_id, reason: 'Une idée disponible pour ce repas.',
      }))
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ recommendations }) }] }],
        usage: { input_tokens: 1600, output_tokens: 1000, output_tokens_details: { reasoning_tokens: 850 } } })
    }
    throw Error(path)
  }
  const handler = createHandler(name => ({
    SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    OPENAI_API_KEY: 'mock-test-only',
  })[name], network, now)
  const call = (overrides = {}, account = 'accountA') => handler(new Request('https://edge.example', {
    method: 'POST', headers: { authorization: 'Bearer ' + account },
    body: JSON.stringify({ ...target, zone: 'Khánh Hòa', locale: 'fr', ...overrides }),
  })).then(response => response.json())
  return { call, calls, finishes, menu: value => { menus = value }, history: value => { meals = value },
    format: value => { format = value }, disabled: () => { disabled = true }, fail: () => { fail = true } }
}

test('switching formats reuses existing results and can return to the original payload', async () => {
  const h = harness('legacy')
  const initial = await h.call()
  const settings = { model: 'gpt-5.5', effort: 'high' }
  const original = recommendationContext({ catalog: catalog(), habits, meals: profiles[1], target, today: date,
    zone: 'Khánh Hòa', locale: 'fr' })
  assert.deepEqual(h.calls[0], providerRequest(original, settings))

  h.format('compact_v1')
  assert.deepEqual(await h.call(), initial)
  assert.equal(h.calls.length, 1)
  const refreshed = await h.call({ refreshFrom: initial.id })
  assert.equal(refreshed.state, 'ai')
  assert.equal(h.calls.length, 2)
  assert.deepEqual(JSON.parse(h.calls[1].input).candidates.map(dish => dish.dish_id), ['d1', 'd2', 'd3'])
  assert.ok(refreshed.recommendations.every(dish => !initial.recommendations.some(item => item.dish_id === dish.dish_id)))

  h.format('legacy')
  assert.deepEqual(await h.call(), refreshed)
  assert.equal(h.calls.length, 2)
  await h.call({ locale: 'vi' })
  assert.equal(h.calls.length, 3)
  assert.deepEqual(JSON.parse(h.calls[2].input).candidates, original.candidates)
})

test('four sizes including an empty zone, no calls when disabled or unauthenticated', async () => {
  const h = harness()
  assert.deepEqual(await h.call({}, 'bad-token'), { error: 'unauthorized' })
  assert.equal((await h.call({ zone: 'Hà Nội' })).state, 'exhausted')
  assert.equal(h.calls.length, 0)
  for (const count of [1, 2, 3, 27, 120]) {
    h.menu(catalog(count))
    const response = await h.call()
    assert.equal(response.recommendations.length, Math.min(count, 3))
    assert.equal(JSON.parse(h.calls.at(-1).input).candidates.length, count)
    assert.ok(response.recommendations.every(dish => /^dish\d+$/.test(dish.dish_id)))
  }
  h.disabled()
  assert.equal((await h.call()).state, 'fallback')
  assert.equal(h.calls.length, 5)
})

test('profile H refreshes, concurrent opens, reopen, actual history edits and account isolation', async () => {
  const h = harness()
  const responses = await Promise.all([h.call(), h.call()])
  const first = responses.find(r => r.state === 'ai')
  assert.ok(first)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(await h.call(), first)
  const next = await h.call({ refreshFrom: first.id })
  assert.ok(h.finishes.every(call => call.p_result.every(pick => /^dish\d+$/.test(pick.dish_id))))
  assert.ok(next.recommendations.every(rec => !first.recommendations.some(item => item.dish_id === rec.dish_id)))
  assert.equal((await h.call({ refreshFrom: next.id })).state, 'exhausted')
  assert.deepEqual(await h.call(), next)
  assert.equal(h.calls.length, 2)
  h.history([row(date, 'breakfast', ['Cơm tấm', 'Cơm gà'])])
  await h.call({ user_id: B, candidates: [{ dish_id: 'invented' }], history: [] })
  assert.deepEqual(JSON.parse(h.calls.at(-1).input).confirmed_meals[0].dishes, ['Cơm tấm', 'Cơm gà'])
  h.history([])
  await h.call()
  assert.deepEqual(JSON.parse(h.calls.at(-1).input).confirmed_meals, [])
  await h.call({}, 'accountB')
  const input = JSON.parse(h.calls.at(-1).input)
  assert.deepEqual(input.confirmed_meals[0].dishes, ['Repas de B'])
  assert.doesNotMatch(JSON.stringify(input), new RegExp(A + '|' + B + '|invented'))
  assert.equal(h.finishes.at(-1).p_usage.reasoning, 850)
  assert.ok(h.finishes.at(-1).p_usage.estimatedUsd > 0)
  assert.equal(h.finishes.at(-1).p_usage.actualUsd, null)
})

test('an unavailable provider degrades safely and invalid model identifiers or duplicates are rejected', async () => {
  const h = harness()
  h.fail()
  assert.equal((await h.call()).state, 'fallback')
  assert.equal((await h.call()).state, 'fallback')
  assert.equal(h.calls.length, 1)
  assert.equal(h.finishes[0].p_error, 'provider_http_503')
  const picks = [{ dish_id: 'a', reason: 'Une idée.' }, { dish_id: 'b', reason: 'Une autre idée.' }]
  assert.deepEqual(checkedRecommendations({ recommendations: picks }, picks), picks)
  assert.equal(checkedRecommendations({ recommendations: [picks[0], picks[0]] }, picks), null)
  assert.equal(checkedRecommendations({ recommendations: picks }, [{ dish_id: 'z' }, picks[1]]), null)
  assert.equal(usageMetrics({ usage: { input_tokens: 1000, output_tokens: 1000,
    input_tokens_details: { cached_tokens: 500 }, output_tokens_details: { reasoning_tokens: 800 } } }, 'gpt-5.5').estimatedUsd, 0.03275)
})

test('browser selection uses valid model order and labels the existing fallback separately', async () => {
  let response = { state: 'ai', id: A, recommendations: [{ dish_id: 'dish2', reason: 'Une idée.' }] }
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: null }) }
  const client = { from: () => builder, rpc: async name => ({ data: name === 'helpeat_catalog' ? catalog(3) : habits }),
    functions: { invoke: async () => ({ data: response }) } }
  const { api } = createRealApi({}, 'https://example.test', client)
  const body = { ...target, zone: 'Khánh Hòa' }
  assert.deepEqual((await api('today', 'POST', body)).suggestions.map(dish => [dish.id, dish.reason]), [['dish2', 'Une idée.']])
  response = { state: 'ai', id: A, recommendations: [{ dish_id: 'missing', reason: 'Inventé' }] }
  const fallback = await api('today', 'POST', body)
  assert.equal(fallback.source, 'fallback')
  assert.equal(fallback.suggestions.length, 3)
  assert.ok(fallback.suggestions.every(dish => !dish.reason))
})

test('Postgres reserves once and keeps the cache and metrics inaccessible to readers', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create schema private; create schema auth; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key);`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261127020246_helpeat_daily_ai.sql', import.meta.url), 'utf8'))
    await db.query('insert into auth.users values ($1),($2)', [A, B])
    const reserve = async (user, refresh = null, count = 3) => (await db.query(
      "select public.helpeat_daily_ai_reserve($1,'context',$2,'lunch','gpt-5.5','high',$3) result",
      [user, refresh, count])).rows[0].result
    assert.equal((await reserve(A)).state, 'disabled')
    await db.query("update private.helpeat_daily_ai_config set enabled=true,pilot_hashes=array[encode(sha256(convert_to($1,'UTF8')),'hex')]", [A])
    assert.equal((await reserve(B)).state, 'disabled')
    const first = await reserve(A)
    assert.equal(first.state, 'reserved')
    assert.equal((await reserve(A)).state, 'pending')
    const picks = ['a', 'b', 'c'].map(dish_id => ({ dish_id, reason: 'Exemple' }))
    assert.equal((await db.query("select public.helpeat_daily_ai_finish($1,$2,'{\"estimatedUsd\":0.15}',100,null) saved",
      [first.id, JSON.stringify(picks)])).rows[0].saved, true)
    assert.equal((await reserve(A)).id, first.id)
    assert.equal((await reserve(A, first.id)).state, 'exhausted')
    await db.exec(await readFile(new URL('../supabase/migrations/20261127071259_helpeat_daily_ai_format.sql', import.meta.url), 'utf8'))
    const reserveForFormat = async (user, refresh = null) => (await db.query(
      "select public.helpeat_daily_ai_reserve_for_format($1,'context',$2,'lunch','gpt-5.5','high',6) result",
      [user, refresh])).rows[0].result
    assert.equal((await reserveForFormat(B)).state, 'disabled')
    await db.exec("update private.helpeat_daily_ai_config set format_version='compact_v1'")
    assert.deepEqual(await reserveForFormat(A), { id: first.id, state: 'success', result: picks })
    const compact = await reserveForFormat(A, first.id)
    assert.equal(compact.state, 'reserved')
    assert.equal(compact.format_version, 'compact_v1')
    assert.deepEqual([...compact.excluded].sort(), ['a', 'b', 'c'])
    assert.equal((await reserveForFormat(A, first.id)).state, 'pending')
    const recorded = (await db.query(`select format_version, attempts, successes, pending, estimated_total_usd
      from private.helpeat_daily_ai_metrics_by_format order by format_version`)).rows
    assert.deepEqual(recorded.map(r => [r.format_version, Number(r.attempts), Number(r.successes), Number(r.pending), r.estimated_total_usd]),
      [['compact_v1', 1, 0, 1, null], ['legacy', 1, 1, 0, '0.15']])
    await db.exec("update private.helpeat_daily_ai_config set format_version='legacy'")
    assert.equal((await db.query('select format_version from private.helpeat_daily_ai_runs where id=$1', [compact.id])).rows[0].format_version,
      'compact_v1')
    const refreshedPicks = ['d', 'e', 'f'].map(dish_id => ({ dish_id, reason: 'Exemple après renouvellement' }))
    assert.equal((await db.query(`select public.helpeat_daily_ai_finish($1,$2,
      '{"input":1600,"output":700,"reasoning":500,"estimatedUsd":0.029}',110,null) saved`,
      [compact.id, JSON.stringify(refreshedPicks)])).rows[0].saved, true)
    assert.deepEqual(await reserveForFormat(A), { id: compact.id, state: 'success', result: refreshedPicks })
    const compactMetrics = (await db.query(`select total_input_tokens, total_output_tokens,
      total_reasoning_tokens, estimated_total_usd, mean_duration_ms
      from private.helpeat_daily_ai_metrics_by_format where format_version='compact_v1'`)).rows[0]
    assert.deepEqual(Object.values(compactMetrics).map(Number), [1600, 700, 500, 0.029, 110])
    await db.query("update private.helpeat_daily_ai_config set pilot_hashes=pilot_hashes || encode(sha256(convert_to($1,'UTF8')),'hex')", [B])
    const other = await reserve(B)
    assert.equal(other.state, 'reserved')
    assert.notEqual(other.id, first.id)
    const metrics = (await db.query('select * from private.helpeat_daily_ai_metrics')).rows[0]
    assert.deepEqual([Number(metrics.successes), Number(metrics.estimated_usd_per_recommendation)], [2, 0.179 / 6])
    await db.exec('set role authenticated')
    await assert.rejects(db.query("select public.helpeat_daily_ai_config($1)", [A]), { code: '42501' })
    await assert.rejects(reserveForFormat(A), { code: '42501' })
    await assert.rejects(db.query('select * from private.helpeat_daily_ai_runs'), { code: '42501' })
    await assert.rejects(db.query('select * from private.helpeat_daily_ai_metrics_by_format'), { code: '42501' })
  } finally {
    await db.close()
  }
})
