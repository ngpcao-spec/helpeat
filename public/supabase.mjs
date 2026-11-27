import { createClient } from '@supabase/supabase-js'
import { dailyCandidates, groupCandidates, homeCatalog, inArea, label, normalize } from './catalog.mjs'
import { initialTimes, nextMeal, vietnamTime } from './time.mjs'

const storageKey = 'helpeat-supabase-auth-v1'
const homeReviewsUrl = 'https://ngpcao-spec.github.io/home-reviews-demo/'
const moveDate = (date, shift) => new Date(Date.parse(date) + shift * 86_400_000).toISOString().slice(0, 10)
const columns = 'meal_date,meal_slot,status,helpeat_meal_items(position,name)'
const publicErrors = new Set(['alreadyConfirmed', 'invalid', 'signInRequired'])

function unwrap(result) {
  if (!result.error) return result.data
  const { message, code, status } = result.error
  if (publicErrors.has(message)) throw new Error(message)
  if (code === '42501' || status === 401 || status === 403) throw new Error('signInRequired')
  if (message?.includes('Failed to fetch')) throw new Error('offline')
  throw new Error('unexpected')
}

export function googleClaims(claims) {
  const providers = claims?.app_metadata?.providers
  return Boolean(claims?.sub && (claims.app_metadata?.provider === 'google'
    || (Array.isArray(providers) && providers.includes('google'))) && Array.isArray(claims.amr)
    && claims.amr.some(entry => entry.method === 'oauth'))
}

async function approvedPilotSubject(subject, hashes) {
  if (typeof subject !== 'string') return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return hashes.includes(hash)
}

export function homePilotGate(config, storage = localStorage, verifier = createClient(config.url, config.key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'helpeat-pilot-verifier' },
})) {
  const project = new URL(config.url).hostname.split('.')[0]
  return async () => {
    try {
      const homeSession = JSON.parse(storage.getItem('sb-' + project + '-auth-token') ?? 'null')
      if (typeof homeSession?.access_token !== 'string') return ''
      const { data, error } = await verifier.auth.getClaims(homeSession.access_token)
      const claims = data?.claims
      if (error || !googleClaims(claims) || typeof claims.email !== 'string'
        || !await approvedPilotSubject(claims.sub, config.pilotHashes)) return ''
      return claims.email
    } catch {
      return ''
    }
  }
}

export function googleOptions(base, mode = 'real', loginHint = '') {
  const redirect = new URL(base)
  redirect.searchParams.set('mode', mode)
  const queryParams = mode === 'pilot'
    ? { prompt: 'none', login_hint: loginHint }
    : { prompt: 'select_account' }
  return { redirectTo: redirect.href, queryParams }
}

export function googleReturn(href) {
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const isProviderReturn = parameters => ['code', 'sb', 'error', 'error_code', 'access_token', 'refresh_token']
    .some(key => parameters.has(key))
  const hasCode = url.searchParams.has('code') || fragment.has('code')
  const hasProviderFragment = isProviderReturn(fragment)
  if (!hasProviderFragment && !isProviderReturn(url.searchParams)) return null
  for (const key of ['code', 'sb', 'sb_flow_id', 'error', 'error_code', 'error_description', 'type',
    'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_type', 'expires_in', 'expires_at']) {
    url.searchParams.delete(key)
  }
  if (hasProviderFragment) url.hash = ''
  return { href: url.href, hasCode }
}

function mapMeal(row) {
  return {
    date: row.meal_date, meal: row.meal_slot, status: row.status,
    dishes: [...row.helpeat_meal_items].sort((a, b) => a.position - b.position).map(item => ({ name: item.name })),
  }
}

export function createRealApi(config, base, client = createClient(config.url, config.key, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey },
}), gate = config.pilotHashes ? homePilotGate(config) : null) {
  let catalogRequest
  const dailyRequests = new Map()

  function getDailySelection({ date, meal, zone, coordinates, locale, refreshFrom }) {
    if (!client.functions) return null
    const body = { date, meal, zone, coordinates, locale, refreshFrom }
    const key = JSON.stringify(body)
    if (!dailyRequests.has(key)) {
      dailyRequests.set(key, client.functions.invoke('helpeat-daily', { body, timeout: 115000 })
        .catch(() => null).finally(() => dailyRequests.delete(key)))
    }
    return dailyRequests.get(key)
  }

  async function getCatalog() {
    // Share concurrent reads without keeping withdrawn restaurants in a client cache.
    catalogRequest ??= (async () => {
      try {
        const { data, error } = await client.rpc('helpeat_catalog')
        if (error) return { status: error.code === 'PGRST202' ? 'unconnected' : 'unavailable', restaurants: [] }
        const restaurants = homeCatalog(data).map(place => {
          const destination = place.address || (place.lat != null && place.lng != null ? `${place.lat},${place.lng}` : '')
          if (place.maps || !destination) return place
          const maps = new URL('https://www.google.com/maps/dir/')
          maps.search = new URLSearchParams({ api: '1', destination }).toString()
          return { ...place, maps: maps.href }
        })
        return { status: 'ready', restaurants }
      } catch {
        return { status: 'unavailable', restaurants: [] }
      }
    })().finally(() => { catalogRequest = undefined })
    return catalogRequest
  }

  async function signedOut(common, authenticationError) {
    const needsHome = gate && !await gate()
    return { ...common, account: null, google: !needsHome, pilotHomeUrl: needsHome ? homeReviewsUrl : '', authenticationError }
  }

  async function session() {
    const { session } = unwrap(await client.auth.getSession())
    const common = {
      real: true, demo: false, preview: false, google: true, photo: false, pushKey: '',
      zones: [], catalog: 'unconnected', upcoming: nextMeal(), today: vietnamTime().date,
    }
    if (!session) return signedOut(common)
    const { claims } = unwrap(await client.auth.getClaims())
    const excluded = config.pilotHashes && !await approvedPilotSubject(claims?.sub, config.pilotHashes)
    if (!googleClaims(claims) || claims.sub !== session.user.id || excluded) {
      unwrap(await client.auth.signOut({ scope: 'local' }))
      return signedOut(common, excluded ? 'pilotAccountRequired' : 'signInRequired')
    }
    const [profileResult, settingsResult, catalog] = await Promise.all([
      client.from('helpeat_profiles').select('locale,zone').eq('user_id', claims.sub).maybeSingle(),
      client.from('helpeat_notification_settings').select('breakfast,lunch,dinner').eq('user_id', claims.sub).maybeSingle(),
      getCatalog(),
    ])
    const profile = unwrap(profileResult)
    const settings = unwrap(settingsResult)
    const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || ''
    const times = settings ? Object.fromEntries(Object.keys(initialTimes).map(meal => [meal, settings[meal].slice(0, 5)])) : initialTimes
    return {
      ...common, catalog: catalog.status, zones: [...new Set(catalog.restaurants.map(place => place.zone).filter(Boolean))].sort(),
      account: { id: claims.sub, name, preferences: {
        locale: profile?.locale || 'vi', zone: profile?.zone || '', times, notify: false,
      } },
    }
  }

  async function api(path, method, body = {}) {
    if (path === 'session') return session()
    if (path === 'logout') {
      unwrap(await client.auth.signOut({ scope: 'local' }))
      return { ok: true }
    }
    if (path === 'habits') return unwrap(await client.rpc('helpeat_habits'))
    if (path.startsWith('dishes?')) {
      const q = normalize(new URLSearchParams(path.split('?')[1]).get('q') ?? '')
      if (q.length < 2) return []
      const { restaurants } = await getCatalog()
      const matches = new Map()
      for (const place of restaurants) {
        for (const dish of place.dishes) {
          if (Object.values(dish.name).some(value => normalize(value).includes(q))) {
            matches.set(dish.id, { id: dish.id, name: label(dish.name), family: dish.family })
          }
        }
      }
      return [...matches.values()].slice(0, 12)
    }
    if (path === 'today') {
      const [meal, { status, restaurants }] = await Promise.all([
        client.from('helpeat_meals').select(columns).eq('meal_date', body.date).eq('meal_slot', body.meal).maybeSingle(),
        getCatalog(),
      ])
      const row = unwrap(meal)
      const area = inArea(restaurants, body.zone, body.coordinates)
      const response = { status, entry: row ? mapMeal(row) : null, suggestions: [],
        hasArea: Boolean(body.zone || body.coordinates), hasCatalog: restaurants.length > 0 }
      if (!area.length) return response
      if (body.detailId) {
        const places = area.map(place => ({ ...place, dishes: place.dishes.filter(dish => dish.id === body.detailId) }))
        return { ...response, suggestions: dailyCandidates(places, body.meal, [], body.coordinates) }
      }
      const [habits, selection] = await Promise.all([
        client.rpc('helpeat_habits'),
        getDailySelection(body),
      ])
      const eligible = dailyCandidates(area, body.meal, habits.data ?? [], body.coordinates, [], Infinity)
      const byId = new Map(eligible.map(dish => [dish.id, dish]))
      const result = selection?.data
      if (!selection?.error && result?.state === 'ai' && Array.isArray(result.recommendations)) {
        const picks = result.recommendations
        if (picks.length > 0 && picks.length <= 3 && new Set(picks.map(item => item?.dish_id)).size === picks.length
          && picks.every(item => byId.has(item?.dish_id) && typeof item.reason === 'string')) {
          return { ...response, source: 'ai', aiId: result.id,
            suggestions: picks.map(item => ({ ...byId.get(item.dish_id), reason: item.reason })) }
        }
      }
      const fresh = eligible.filter(dish => !body.exclude?.includes(dish.id))
      if (body.refresh && (result?.state === 'exhausted' || (!fresh.length && eligible.length))) {
        return { ...response, source: 'fallback', exhausted: true, preserveAI: result?.state === 'exhausted',
          suggestions: (body.previousIds ?? []).filter(id => byId.has(id)).map(id => byId.get(id)) }
      }
      return { ...response, source: 'fallback', suggestions: (fresh.length ? fresh : eligible).slice(0, 3) }
    }
    if (path === 'outing') {
      const { status, restaurants } = await getCatalog()
      const area = inArea(restaurants, body.zone, body.coordinates)
      const suggestions = groupCandidates(area, body.party, body.budget, body.wish, body.coordinates).slice(0, 3)
      return { status, suggestions, hasCatalog: restaurants.length > 0 }
    }
    if (path.startsWith('journal')) {
      const today = vietnamTime().date
      const before = new URLSearchParams(path.split('?')[1]).get('before') ?? moveDate(today, 2)
      const from = moveDate(before, -16)
      const rows = unwrap(await client.from('helpeat_meals').select(columns)
        .gte('meal_date', from).lt('meal_date', before).order('meal_date', { ascending: false }).limit(48))
      return { from, before, entries: rows.map(mapMeal) }
    }
    if (path === 'meal' && method === 'PUT') {
      unwrap(await client.rpc('helpeat_save_meal', {
        p_date: body.date, p_slot: body.meal, p_status: body.status, p_dishes: body.dishes.map(dish => dish.name),
      }))
      return { ok: true }
    }
    if ((path === 'meal' || path === 'plan') && method === 'DELETE') {
      let deletion = client.from('helpeat_meals').delete().eq('meal_date', body.date).eq('meal_slot', body.meal)
      if (path === 'plan') deletion = deletion.eq('status', 'planned')
      unwrap(await deletion)
      return { ok: true }
    }
    if (path === 'preferences') {
      unwrap(await client.rpc('helpeat_save_preferences', {
        p_locale: body.locale, p_zone: body.zone,
        p_breakfast: body.times.breakfast, p_lunch: body.times.lunch, p_dinner: body.times.dinner,
      }))
      return { ...body, notify: false }
    }
    throw new Error('unexpected')
  }

  return {
    api,
    async signIn() {
      const email = gate ? await gate() : ''
      if (gate && !email) throw new Error('pilotHomeRequired')
      unwrap(await client.auth.signInWithOAuth({ provider: 'google', options: googleOptions(base, gate ? 'pilot' : 'real', email) }))
    },
    watch(listener) {
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') setTimeout(() => listener(session?.user.id ?? null), 0)
      })
    },
  }
}
