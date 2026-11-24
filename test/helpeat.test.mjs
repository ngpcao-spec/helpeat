import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { approvedCatalog, dailyCandidates, groupCandidates, inArea } from '../public/catalog.mjs'
import { createDemoApi } from '../public/demo.mjs'
import { rank } from '../server/home-ai.mjs'
import { buildApp } from '../server/index.mjs'
import { pushSubscription } from '../server/push.mjs'
import { createStore } from '../server/store.mjs'
import { nextMeal, vietnamTime } from '../public/time.mjs'

const pho = { id: 'pho', name: 'Phở', family: 'noodles', confirmed: true, validUntil: '2099-01-01', meals: ['lunch'] }
const rice = { id: 'rice', name: 'Cơm tấm', family: 'rice', confirmed: true, validUntil: '2099-01-01', meals: ['lunch'] }
const address = { id: 'a', name: 'Test A', zone: 'Đà Nẵng', published: true, homeScore: 90,
  latitude: 16.05, longitude: 108.2, maxGroupSize: 6, budgetPerPersonVnd: 100_000 }
const payload = { source: 'HOME Reviews', version: 1, restaurants: [
  { ...address, secret: 'internal', dishes: [pho, { ...rice, confirmed: false }, { ...rice, validUntil: '2000-01-01' }] },
  { ...address, id: 'b', name: 'Test B', homeScore: 75, dishes: [{ ...pho, priceVnd: 70_000 }, rice] },
  { ...address, id: 'c', published: false, dishes: [rice] },
] }

test('only current, confirmed dishes at approved restaurants enter the shortlist', () => {
  const catalog = approvedCatalog(payload)
  assert.deepEqual(catalog.map(place => place.id), ['a', 'b'])
  assert.equal(catalog[0].dishes.length, 1)
  assert.equal('secret' in catalog[0], false)
  assert.equal(inArea(catalog, 'Da Nang').length, 2)
  assert.equal(inArea(catalog, '', { lat: 21, lng: 105 }).length, 0)
  assert.equal(inArea(catalog, '', { lat: 16.045, lng: 108.2 }).length, 2)
  assert.equal(dailyCandidates(catalog, 'breakfast', []).length, 0)
  const [first] = dailyCandidates(catalog, 'lunch', [])
  assert.equal(first.id, 'pho')
  assert.deepEqual(first.restaurants.map(place => place.id), ['a', 'b'])
  assert.deepEqual(first.restaurants.map(place => place.price), [null, 70_000])
  assert.deepEqual(dailyCandidates(catalog, 'lunch', [], null, ['pho']).map(item => item.id), ['rice'])
})

test('confirmed meals affect the profile and group results require known suitability', () => {
  const catalog = approvedCatalog(payload)
  const meal = { meal: 'lunch', dishes: [{ name: 'Cơm tấm', family: 'rice' }] }
  assert.equal(dailyCandidates(catalog, 'lunch', [{ ...meal, status: 'planned' }])[0].id, 'pho')
  const history = Array.from({ length: 4 }, () => ({ ...meal, status: 'confirmed' }))
  assert.equal(dailyCandidates(catalog, 'lunch', history)[0].id, 'rice')
  assert.equal(groupCandidates(catalog, 4, 390_000, '').length, 0)
  assert.equal(groupCandidates(catalog, 7, 900_000, '').length, 0)
  assert.equal(groupCandidates([{ ...catalog[0], capacity: null }], 2, 900_000, '').length, 0)
  assert.equal(groupCandidates(catalog, 4, 400_000, '')[0].total, 400_000)
})

test('AI may reorder the shortlist but cannot add to it', async () => {
  const candidates = dailyCandidates(approvedCatalog(payload), 'lunch', [])
  const ai = async () => ({ ids: ['fabricated', 'rice', 'rice', 'pho'] })
  assert.deepEqual((await rank(ai, 'daily', candidates, {})).map(item => item.id), ['rice', 'pho'])
  assert.deepEqual(await rank(async () => { throw new Error() }, 'daily', candidates, {}), candidates)
})

test('editing and reconnecting preserve only the owner’s journal', () => {
  const folder = mkdtempSync(join(tmpdir(), 'helpeat-test-'))
  const file = join(folder, 'journal.sqlite')
  let store = createStore(file)
  try {
    const session = store.signIn('google:one', 'First')
    store.signIn('google:two', 'Second')
    const entry = { date: '2026-11-24', meal: 'dinner', status: 'confirmed', dishes: [{ name: 'Cơm tại nhà' }, { name: 'Canh' }] }
    assert.equal(store.saveMeal('google:one', entry), true)
    assert.equal(store.saveMeal('google:one', { ...entry, status: 'planned' }, true), false)
    assert.equal(store.meals('google:two').length, 0)
    assert.equal(store.meals('google:one', '2026-11-01', 48, '2026-11-24').length, 0)
    store.signOut(session)
    store.close()
    store = createStore(file)
    assert.equal(store.account(session), null)
    const reconnected = store.signIn('google:one', 'First')
    assert.equal(store.account(reconnected).id, 'google:one')
    assert.deepEqual(store.meals('google:one'), [entry])
    store.deleteMeal('google:one', entry.date, entry.meal)
    assert.equal(store.meals('google:one').length, 0)
  } finally {
    store.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

test('meal scheduling uses Vietnam time and push retries are claimed once', () => {
  assert.deepEqual(vietnamTime(new Date('2026-11-23T23:00:00Z')), { date: '2026-11-24', time: '06:00' })
  assert.deepEqual(nextMeal(new Date('2026-11-24T15:00:00Z')), { date: '2026-11-25', meal: 'breakfast' })
  const store = createStore(':memory:')
  try {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/hello'
    const subscription = { endpoint, keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }
    assert.equal(pushSubscription({ ...subscription, endpoint: 'https://127.0.0.1/push' }), null)
    assert.deepEqual(pushSubscription(subscription), subscription)
    store.signIn('google:one', 'First')
    store.subscribe('google:one', subscription)
    assert.equal(store.claimPush(endpoint, '2026-11-24', 'lunch', 0), true)
    assert.equal(store.claimPush(endpoint, '2026-11-24', 'lunch', 30_000), false)
    assert.equal(store.claimPush(endpoint, '2026-11-24', 'lunch', 150_000), true)
    store.markPush(endpoint, '2026-11-24', 'lunch')
    assert.equal(store.claimPush(endpoint, '2026-11-24', 'lunch', 500_000), false)
  } finally {
    store.close()
  }
})

test('HTTP keeps preview explicit, rejects cross-origin writes and isolates sessions', async t => {
  const { server } = buildApp({ PORT: '0' }, true)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const request = (route, options) => fetch(origin + '/api/' + route, options)
  const post = (route, body, cookie = '', method = 'POST', source = origin) => request(route, {
    method, headers: { origin: source, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const before = await request('journal')
  assert.equal(before.status, 401)
  assert.equal((await post('preview', {}, '', 'POST', 'http://evil.test')).status, 403)
  const preview = await post('preview', {})
  const cookie = preview.headers.get('set-cookie').split(';')[0]
  const { upcoming, today } = await (await request('session', { headers: { cookie } })).json()
  const suggestions = await (await post('today', upcoming, cookie)).json()
  assert.deepEqual(suggestions.suggestions, [])
  const entry = { date: today, meal: 'lunch', status: 'confirmed', dishes: [{ name: 'Cơm' }, { name: 'Canh' }] }
  assert.equal((await post('meal', entry, cookie, 'PUT')).status, 200)
  assert.equal((await (await request('journal', { headers: { cookie } })).json()).entries[0].dishes.length, 2)
  const anotherCookie = (await post('preview', {})).headers.get('set-cookie').split(';')[0]
  assert.deepEqual((await (await request('journal', { headers: { cookie: anotherCookie } })).json()).entries, [])
  assert.equal((await post('photo', {}, cookie)).status, 503)
})

test('the Pages demo supplies fictitious recommendations, alternates and group results', async () => {
  const api = createDemoApi(new Map())
  const session = await api('session')
  assert.equal(session.demo, true)
  assert.equal(session.google, false)
  assert.equal(session.pushKey, '')
  const zone = session.account.preferences.zone
  const first = await api('today', 'POST', { ...session.upcoming, zone })
  assert.equal(first.suggestions.length, 3)
  const pho = first.suggestions.find(dish => dish.id === 'pho')
  assert.deepEqual(pho.restaurants.map(place => place.id), ['demo-bol', 'demo-jardin'])
  assert.ok(pho.restaurants.every(place => !place.maps))
  const refreshed = await api('today', 'POST', { ...session.upcoming, zone, exclude: first.suggestions.map(dish => dish.id) })
  assert.deepEqual(refreshed.suggestions.map(dish => dish.id), ['rolls'])
  const outing = await api('outing', 'POST', { zone, party: 3, budget: 450_000, wish: '' })
  assert.equal(outing.suggestions.length, 3)
  assert.ok(outing.suggestions.every(place => place.id.startsWith('demo-')))
})

test('photo results are fixtures and only demo preferences and confirmed names persist locally', async () => {
  const data = new Map()
  data.set('helpeat-language', 'vi')
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const api = createDemoApi(storage)
  const session = await api('session')
  await api('preferences', 'PUT', { ...session.account.preferences, locale: 'fr', notify: true })
  const first = await api('photo', 'POST', { images: ['first-image'] })
  assert.deepEqual(await api('photo', 'POST', { images: ['another-image'] }), first)
  const entry = { date: session.today, meal: 'dinner', status: 'confirmed', dishes: first.dishes.map(name => ({ name })) }
  await api('meal', 'PUT', entry)
  const reopened = createDemoApi(storage)
  assert.equal((await reopened('session')).account.preferences.notify, false)
  assert.deepEqual((await reopened('journal')).entries[0].dishes.map(dish => dish.name), first.dishes)
  assert.equal(data.get('helpeat-language'), 'vi')
  assert.ok(![...data.values()].join('').includes('first-image'))
  await reopened('meal', 'DELETE', entry)
  assert.deepEqual((await api('journal')).entries, [])
})
