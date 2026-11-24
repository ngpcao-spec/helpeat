import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogClient, dailyCandidates, groupCandidates, inArea, label, normalize } from '../public/catalog.mjs'
import { homeAi, rank } from './home-ai.mjs'
import { configurePush, pushSubscription } from './push.mjs'
import { createStore, token } from './store.mjs'
import { isDate, nextMeal, slots, vietnamTime } from '../public/time.mjs'

const publicPath = fileURLToPath(new URL('../public/', import.meta.url))
const sessionAge = 30 * 24 * 60 * 60
const mime = new Map(Object.entries({
  '/': 'text/html; charset=utf-8', '/styles.css': 'text/css; charset=utf-8',
  '/app.mjs': 'text/javascript; charset=utf-8', '/copy.mjs': 'text/javascript; charset=utf-8',
  '/icons.mjs': 'text/javascript; charset=utf-8', '/sw.js': 'text/javascript; charset=utf-8',
  '/demo.mjs': 'text/javascript; charset=utf-8', '/catalog.mjs': 'text/javascript; charset=utf-8',
  '/time.mjs': 'text/javascript; charset=utf-8',
  '/manifest.webmanifest': 'application/manifest+json', '/hero.webp': 'image/webp',
  '/icon-192.png': 'image/png', '/icon-512.png': 'image/png',
}))
const slotsSet = new Set(slots)
const text = (value, length = 150) => typeof value === 'string' ? value.trim().slice(0, length) : ''
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const mealTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const datePart = () => vietnamTime().date
const difference = (date, n) => new Date(new Date(date).getTime() + n * 86400000).toISOString().slice(0, 10)

class RequestError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}

function assert(condition, status = 400, code = 'invalid') {
  if (!condition) throw new RequestError(status, code)
}

function cookie(request, name) {
  return (request.headers.cookie ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? ''
}

async function json(request, max = 20_000) {
  assert(request.headers['content-type']?.split(';')[0] === 'application/json', 415)
  assert(!(Number(request.headers['content-length']) > max), 413, 'tooLarge')
  const chunks = []
  let length = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length
    assert(length <= max, 413, 'tooLarge')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString())
    assert(value && typeof value === 'object' && !Array.isArray(value))
    return value
  } catch {
    throw new RequestError(400, 'invalid')
  }
}

function context(body) {
  const { coordinates } = body
  return {
    zone: text(body.zone),
    coordinates: coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)
      && Math.abs(coordinates.lat) <= 90 && Math.abs(coordinates.lng) <= 180 ? coordinates : null,
  }
}

function mealKey(value) {
  assert(isDate(value.date) && slotsSet.has(value.meal))
  return { date: value.date, meal: value.meal }
}

function editableDish(item) {
  const name = text(item?.name, 100)
  return name ? { name, id: text(item.id, 96), family: text(item.family, 80) } : null
}

export function buildApp(env = process.env, preview = false) {
  if (!preview) throw new Error('The legacy server is only available in local preview')
  const host = preview ? '127.0.0.1' : env.HOST || '127.0.0.1'
  const port = Number(env.PORT || 4173)
  const origin = new URL(preview ? 'http://localhost:' + port : env.APP_ORIGIN || 'http://localhost:' + port).origin
  const secure = origin.startsWith('https://')
  const isLoopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(new URL(origin).hostname)
  if (!secure && (!isLoopback || (host !== '127.0.0.1' && host !== '::1'))) {
    throw new Error('HTTPS APP_ORIGIN is required outside loopback')
  }
  const cookieName = secure ? '__Host-helpeat' : 'helpeat'
  const setCookie = (name, value, maxAge) => name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age='
    + maxAge + (secure ? '; Secure' : '')
  const store = createStore(preview ? ':memory:' : resolve(env.DATABASE_PATH || './data/helpeat.sqlite'))
  const getCatalog = catalogClient(preview ? '' : env.HOME_CATALOG_URL, env.HOME_CATALOG_TOKEN)
  const ai = preview ? null : homeAi(env)
  const photos = Boolean(ai && env.HELPEAT_PHOTO_ENABLED === 'true')
  const push = preview ? null : configurePush(store, env, origin)
  const quotas = new Map()
  const rateLimit = (account, action, max, interval) => {
    const now = Date.now()
    if (quotas.size > 2000) {
      for (const [id, value] of quotas) if (value.ends <= now) quotas.delete(id)
    }
    const key = account + ':' + action
    let row = quotas.get(key)
    if (!row || row.ends <= now) row = { count: 0, ends: now + interval }
    assert(row.count < max, 429, 'rateLimit')
    row.count++
    quotas.set(key, row)
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)')
    response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
      + "script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; form-action 'self'; object-src 'none'")
    const send = (body, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    try {
      const url = new URL(request.url, origin)
      const { pathname } = url
      const method = request.method
      if (method !== 'GET' && method !== 'HEAD') {
        const expectedOrigin = preview ? 'http://' + request.headers.host : origin
        assert(request.headers.origin === expectedOrigin, 403, 'notAllowed')
      }
      const session = cookie(request, cookieName)
      if ((method === 'GET' || method === 'HEAD') && mime.has(pathname)) {
        let asset
        try {
          asset = await readFile(resolve(publicPath, pathname === '/' ? 'index.html' : pathname.slice(1)))
        } catch (error) {
          if (error.code === 'ENOENT') return send({ error: 'notFound' }, 404)
          throw error
        }
        response.writeHead(200, { 'Content-Type': mime.get(pathname), 'Cache-Control': 'no-cache' })
        return response.end(method === 'HEAD' ? undefined : asset)
      }
      const account = store.account(session)
      if (method === 'GET' && pathname === '/api/session') {
        const catalog = account ? await getCatalog() : null
        return send({
          account: account && { name: account.name, preferences: account.preferences }, preview, google: false,
          photo: photos, pushKey: push?.publicKey ?? '',
          zones: [...new Set((catalog?.restaurants ?? []).map(place => place.zone))].sort(),
          catalog: catalog?.status ?? 'unconnected', upcoming: nextMeal(), today: datePart(),
        })
      }
      if (method === 'POST' && pathname === '/api/preview' && preview) {
        if (account) return send({ ok: true })
        const newSession = store.signIn('preview:' + token(), '', session)
        response.setHeader('Set-Cookie', setCookie(cookieName, newSession, sessionAge))
        return send({ ok: true })
      }
      assert(pathname.startsWith('/api/'), 404, 'notFound')
      assert(account, 401, 'signInRequired')
      if (method === 'POST' && pathname === '/api/logout') {
        const body = await json(request)
        if (body.endpoint) store.unsubscribe(account.id, text(body.endpoint, 1500))
        store.signOut(session)
        response.setHeader('Set-Cookie', setCookie(cookieName, '', 0))
        return send({ ok: true })
      }
      if (method === 'GET' && pathname === '/api/journal') {
        const before = url.searchParams.get('before') || difference(datePart(), 2)
        assert(isDate(before))
        const from = difference(before, -16)
        const entries = store.meals(account.id, from, 48, before)
        return send({ entries, from, before })
      }
      if (method === 'GET' && pathname === '/api/dishes') {
        const { restaurants } = await getCatalog()
        const query = normalize(text(url.searchParams.get('q'), 100))
        const found = new Map()
        for (const dish of restaurants.flatMap(place => place.dishes)) {
          if (!query || Object.values(dish.name).some(name => normalize(name).includes(query))) {
            found.set(dish.id, { id: dish.id, name: label(dish.name, account.preferences.locale), family: dish.family })
          }
        }
        return send([...found.values()].slice(0, 12))
      }
      const body = method === 'GET' ? {} : await json(request, pathname === '/api/photo' ? 4_100_000 : undefined)
      if (method === 'PUT' && pathname === '/api/meal') {
        const target = mealKey(body)
        assert(['planned', 'confirmed'].includes(body.status) && Array.isArray(body.dishes) && body.dishes.length <= 12)
        const dishes = body.dishes.map(editableDish).filter(Boolean)
        assert(dishes.length > 0)
        const today = datePart()
        assert(target.date <= (body.status === 'confirmed' ? today : difference(today, 1)))
        const { restaurants } = await getCatalog()
        if (body.status === 'planned') {
          const eligible = new Map(restaurants.flatMap(place => place.dishes).map(dish => [dish.id, dish]))
          assert(dishes.every(dish => eligible.has(dish.id)), 409, 'dishUnavailable')
        }
        const menu = restaurants.flatMap(place => place.dishes)
        for (const dish of dishes) {
          const known = menu.find(item => Object.values(item.name).some(name => name && normalize(name) === normalize(dish.name)))
          if (known) {
            dish.id = known.id
            dish.family = known.family
          } else if (body.status === 'confirmed') {
            dish.id = ''
            dish.family = ''
          }
        }
        const saved = store.saveMeal(account.id, { ...target, status: body.status, dishes }, body.status === 'planned')
        assert(saved, 409, 'alreadyConfirmed')
        return send({ ok: true })
      }
      if (method === 'DELETE' && ['/api/meal', '/api/plan'].includes(pathname)) {
        const { date, meal } = mealKey(body)
        store.deleteMeal(account.id, date, meal, pathname === '/api/plan')
        return send({ ok: true })
      }
      if (method === 'PUT' && pathname === '/api/preferences') {
        assert(['vi', 'fr'].includes(body.locale) && typeof body.zone === 'string' && typeof body.notify === 'boolean')
        assert(slots.every(meal => typeof body.times?.[meal] === 'string' && mealTime.test(body.times[meal])))
        const preferences = {
          locale: body.locale, zone: text(body.zone), notify: Boolean(body.notify && push),
          times: Object.fromEntries(slots.map(meal => [meal, body.times[meal]])),
        }
        store.savePreferences(account.id, preferences)
        return send(preferences)
      }
      if (method === 'POST' && pathname === '/api/push') {
        assert(push, 503, 'pushUnavailable')
        const subscription = pushSubscription(body)
        assert(subscription)
        store.subscribe(account.id, subscription)
        return send({ ok: true })
      }
      if (method === 'DELETE' && pathname === '/api/push') {
        store.unsubscribe(account.id, text(body.endpoint, 1500))
        return send({ ok: true })
      }
      if (method === 'POST' && pathname === '/api/today') {
        rateLimit(account.id, 'today', 20, 60_000)
        const { meal, date } = mealKey(body)
        const { coordinates, zone } = context(body)
        const { status, restaurants } = await getCatalog()
        const excluded = Array.isArray(body.exclude) ? body.exclude.filter(id => typeof id === 'string').slice(-60) : []
        const history = store.meals(account.id, difference(datePart(), -180), 540)
        const candidates = dailyCandidates(inArea(restaurants, zone, coordinates), meal, history, coordinates, excluded)
        const detailId = text(body.detailId, 96)
        const suggestions = detailId ? candidates.filter(candidate => candidate.id === detailId)
          : await rank(ai, 'daily', candidates, { meal, language: account.preferences.locale })
        const entry = store.meal(account.id, date, meal) ?? null
        return send({ status, suggestions, entry, hasArea: Boolean(zone || coordinates) })
      }
      if (method === 'POST' && pathname === '/api/outing') {
        rateLimit(account.id, 'outing', 12, 60_000)
        assert(integer(body.party, 2, 100) && integer(body.budget, 1, 100_000_000))
        const wish = text(body.wish, 180)
        const { coordinates, zone } = context(body)
        assert(zone || coordinates)
        const { status, restaurants } = await getCatalog()
        const candidates = groupCandidates(inArea(restaurants, zone, coordinates), body.party, body.budget, wish)
        const suggestions = await rank(ai, 'outing', candidates, { party: body.party, wish, language: account.preferences.locale })
        return send({ status, suggestions })
      }
      if (method === 'POST' && pathname === '/api/photo') {
        assert(photos, 503, 'photoUnavailable')
        rateLimit(account.id, 'photo', 6, 3_600_000)
        assert(Array.isArray(body.images) && body.images.length >= 1 && body.images.length <= 2)
        const jpeg = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/
        assert(body.images.every(image => typeof image === 'string' && image.length <= 2_000_000 && jpeg.test(image)))
        try {
          const result = await ai('photo', { language: account.preferences.locale, images: body.images })
          const names = Array.isArray(result.dishes) ? result.dishes.map(dish => text(dish, 100)).filter(Boolean) : []
          return send({ dishes: [...new Set(names)].slice(0, 12) })
        } catch {
          return send({ error: 'recognitionFailed' }, 502)
        }
      }
      return send({ error: 'notFound' }, 404)
    } catch (error) {
      if (error instanceof RequestError) return send({ error: error.message }, error.status)
      console.error('Unable to complete HELPEAT request', error.code ?? error.name)
      return send({ error: 'unexpected' }, 500)
    }
  })
  server.on('close', () => {
    push?.stop()
    store.close()
  })
  return { server, origin, host, port }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = buildApp(process.env, process.argv.includes('--preview'))
  app.server.listen(app.port, app.host, () => console.log('HELPEAT · ' + app.origin))
}
