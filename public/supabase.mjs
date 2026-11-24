import { createClient } from '@supabase/supabase-js'
import { initialTimes, nextMeal, vietnamTime } from './time.mjs'

const storageKey = 'helpeat-supabase-auth-v1'
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

export function googleOptions(base) {
  const redirect = new URL(base)
  redirect.searchParams.set('mode', 'real')
  return { redirectTo: redirect.href, queryParams: { prompt: 'select_account' } }
}

function mapMeal(row) {
  return {
    date: row.meal_date, meal: row.meal_slot, status: row.status,
    dishes: [...row.helpeat_meal_items].sort((a, b) => a.position - b.position).map(item => ({ name: item.name })),
  }
}

export function createRealApi(config, base, client = createClient(config.url, config.key, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey },
})) {
  async function session() {
    const { session } = unwrap(await client.auth.getSession())
    const common = {
      real: true, demo: false, preview: false, google: true, photo: false, pushKey: '',
      zones: [], catalog: 'unconnected', upcoming: nextMeal(), today: vietnamTime().date,
    }
    if (!session) return { ...common, account: null }
    const { claims } = unwrap(await client.auth.getClaims())
    if (!googleClaims(claims) || claims.sub !== session.user.id) {
      unwrap(await client.auth.signOut({ scope: 'local' }))
      return { ...common, account: null, authenticationError: 'signInRequired' }
    }
    const [profileResult, settingsResult] = await Promise.all([
      client.from('helpeat_profiles').select('locale,zone').eq('user_id', claims.sub).maybeSingle(),
      client.from('helpeat_notification_settings').select('breakfast,lunch,dinner').eq('user_id', claims.sub).maybeSingle(),
    ])
    const profile = unwrap(profileResult)
    const settings = unwrap(settingsResult)
    const name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || ''
    const times = settings ? Object.fromEntries(Object.keys(initialTimes).map(meal => [meal, settings[meal].slice(0, 5)])) : initialTimes
    return {
      ...common, account: { id: claims.sub, name, preferences: {
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
    if (path.startsWith('dishes?')) return []
    if (path === 'today') {
      const row = unwrap(await client.from('helpeat_meals').select(columns)
        .eq('meal_date', body.date).eq('meal_slot', body.meal).maybeSingle())
      return { status: 'unconnected', entry: row ? mapMeal(row) : null, suggestions: [], hasArea: Boolean(body.zone) }
    }
    if (path === 'outing') return { status: 'unconnected', suggestions: [] }
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
      unwrap(await client.auth.signInWithOAuth({ provider: 'google', options: googleOptions(base) }))
    },
    watch(listener) {
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') setTimeout(() => listener(session?.user.id ?? null), 0)
      })
    },
  }
}
