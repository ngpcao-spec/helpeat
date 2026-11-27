import { nextMeal, vietnamTime } from '../../../public/time.mjs'
import { compactProviderRequest, resolveCompactRecommendations } from './compact-request.mjs'
import { checkedRecommendations, prepareRecommendationContext, prompt, providerRequest, usageMetrics } from './recommendation.mjs'

const origin = 'https://ngpcao-spec.github.io'
const providerUrl = 'https://api.openai.com/v1/responses'
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const dateBefore = (date, days) => new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10)
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
}
const reply = (body, status = 200) => Response.json(body, { status, headers })

async function requestBody(request) {
  if (!request.body || Number(request.headers.get('content-length')) > 2048) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return JSON.parse(body + decoder.decode())
      size += value.length
      if (size > 2048) {
        await reader.cancel()
        return null
      }
      body += decoder.decode(value, { stream: true })
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function validCoordinates(value) {
  return Number.isFinite(value?.lat) && Math.abs(value.lat) <= 90
    && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180 ? { lat: value.lat, lng: value.lng } : null
}

async function hash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createHandler(env, network = fetch, clock = () => new Date()) {
  return async function handle(request) {
    if (request.headers.has('origin') && request.headers.get('origin') !== origin) return reply({ error: 'origin' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ error: 'method' }, 405)
    const auth = request.headers.get('authorization')
    if (!auth?.startsWith('Bearer ')) return reply({ error: 'unauthorized' }, 401)
    const body = await requestBody(request)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'invalid' }, 400)
    const zone = typeof body.zone === 'string' ? body.zone.trim().slice(0, 150) : ''
    const coordinates = validCoordinates(body.coordinates)
    const current = clock()
    const target = nextMeal(current)
    const today = vietnamTime(current).date
    const base = env('SUPABASE_URL')
    const anon = env('SUPABASE_ANON_KEY')
    const service = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!base || !anon || !service) return reply({ state: 'fallback' })

    const supabase = async (path, key, bearer, data) => network(base + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { apikey: key, Authorization: bearer, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'error', signal: AbortSignal.timeout(8000),
    })
    const rpc = async (name, data, admin = false) => {
      const response = await supabase('/rest/v1/rpc/' + name, admin ? service : anon, admin ? 'Bearer ' + service : auth, data)
      if (!response.ok) throw new Error('database')
      return response.json()
    }

    try {
      const identity = await supabase('/auth/v1/user', anon, auth)
      if (!identity.ok) return reply({ error: 'unauthorized' }, 401)
      const account = await identity.json()
      if (!uuid.test(account.id) || (account.app_metadata?.provider !== 'google'
        && !account.app_metadata?.providers?.includes('google'))) return reply({ error: 'unauthorized' }, 401)
      if ((!zone && !coordinates) || body.date !== target.date || body.meal !== target.meal) {
        return reply({ state: 'fallback' })
      }
      const settings = await rpc('helpeat_daily_ai_config', { p_user: account.id }, true)
      const key = env('OPENAI_API_KEY')?.trim()
      if (!settings || !key) return reply({ state: 'fallback' })
      const query = new URLSearchParams({
        select: 'meal_date,meal_slot,status,helpeat_meal_items(position,name)',
        user_id: 'eq.' + account.id, status: 'eq.confirmed', order: 'meal_date.desc,meal_slot.asc',
      })
      query.append('meal_date', 'gte.' + dateBefore(today, 179))
      query.append('meal_date', 'lte.' + today)
      const [catalog, habits, mealsResponse] = await Promise.all([
        rpc('helpeat_catalog', {}), rpc('helpeat_habits', {}),
        supabase('/rest/v1/helpeat_meals?' + query, anon, auth),
      ])
      if (!mealsResponse.ok) return reply({ state: 'fallback' })
      const { context, restaurantIdsByDish } = prepareRecommendationContext({
        catalog, habits, meals: await mealsResponse.json(), target, today, zone, coordinates, locale: body.locale,
      })
      if (!context.candidates.length) return reply({ state: 'exhausted' })
      // Keep the historical GPT-5.5 key so a model switch reuses already-generated recommendations.
      const cacheSettings = { model: 'gpt-5.5', effort: settings.effort }
      const reservation = await rpc('helpeat_daily_ai_reserve_for_format', {
        p_user: account.id, p_hash: await hash({ prompt, settings: cacheSettings, context }),
        p_refresh: uuid.test(body.refreshFrom) ? body.refreshFrom : null,
        p_meal: target.meal, p_model: settings.model, p_effort: settings.effort, p_candidates: context.candidates.length,
      }, true)
      if (reservation.state === 'success') return reply({ state: 'ai', id: reservation.id, recommendations: reservation.result })
      if (reservation.state === 'exhausted') return reply({ state: 'exhausted' })
      if (reservation.state !== 'reserved') return reply({ state: 'fallback' })

      const excluded = new Set(reservation.excluded)
      const available = { ...context, candidates: context.candidates.filter(dish => !excluded.has(dish.dish_id)) }
      const started = performance.now()
      let recommendations = null
      let usage = null
      let errorCode = 'invalid_request_context'
      try {
        const compact = reservation.format_version === 'compact_v1'
          ? compactProviderRequest(available, restaurantIdsByDish, settings)
          : null
        const providerBody = compact?.body ?? providerRequest(available, settings)
        errorCode = 'provider_unavailable'
        const upstream = await network(providerUrl, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(95000),
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify(providerBody),
        })
        if (upstream.ok) {
          const answer = await upstream.json()
          usage = usageMetrics(answer, settings.model)
          const output = answer.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text
          errorCode = 'invalid_response'
          if (answer.status === 'completed' && output) {
            const result = JSON.parse(output)
            recommendations = compact
              ? resolveCompactRecommendations(result, compact, available.candidates)
              : checkedRecommendations(result, available.candidates)
          }
        } else {
          errorCode = 'provider_http_' + upstream.status
          await upstream.body?.cancel()
        }
      } catch {
        // The technical log records only the outcome code and usage supplied by the provider.
      }
      const saved = await rpc('helpeat_daily_ai_finish', {
        p_run: reservation.id, p_result: recommendations, p_usage: usage,
        p_duration: Math.round(performance.now() - started), p_error: recommendations ? null : errorCode,
      }, true)
      return recommendations && saved
        ? reply({ state: 'ai', id: reservation.id, recommendations })
        : reply({ state: 'fallback' })
    } catch {
      return reply({ state: 'fallback' })
    }
  }
}

if (typeof Deno !== 'undefined') Deno.serve(createHandler(name => Deno.env.get(name)))
