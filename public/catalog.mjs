const meals = new Set(['breakfast', 'lunch', 'dinner'])
const key = /^[a-zA-Z0-9_-]{1,96}$/
const cacheDuration = 60_000
const verificationLifetime = 90 * 24 * 60 * 60 * 1000

export function label(value, locale = 'vi') {
  return value[locale] || value.vi || value.fr
}

export function normalize(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd').trim()
}

function text(value, limit = 200) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function localized(value) {
  if (typeof value === 'string') return { vi: text(value), fr: '' }
  return { vi: text(value?.vi), fr: text(value?.fr) }
}

function httpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

function number(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function approvedCatalog(payload, now = Date.now()) {
  if (payload?.source !== 'HOME Reviews' || payload.version !== 1 || !Array.isArray(payload.restaurants)) {
    throw new Error('Invalid HOME Reviews export')
  }
  return readRestaurants(payload.restaurants, now, false)
}

export function demoCatalog(restaurants) {
  return readRestaurants(restaurants, Date.now(), true)
}

function readRestaurants(items, now, demo) {
  const restaurants = new Map()
  for (const item of items) {
    if (!item || item.published !== true || typeof item.id !== 'string' || !key.test(item.id)) continue
    if (!demo && item.venueType !== 'street_food') continue
    const name = localized(item.name)
    const zone = text(item.zone)
    if (!label(name) || !zone) continue
    const dishes = []
    const seen = new Set()
    for (const dish of Array.isArray(item.dishes) ? item.dishes : []) {
      if (!dish || dish.confirmed !== true || (!demo && dish.enabled !== true)) continue
      const verifiedAt = Date.parse(dish.verifiedAt)
      const endDate = dish.validUntil == null ? Infinity : Date.parse(dish.validUntil)
      const expiresAt = demo ? Infinity : Math.min(verifiedAt + verificationLifetime, endDate)
      if (!demo && (!(verifiedAt <= now) || !(expiresAt > now))) continue
      const dishName = localized(dish.name)
      if (typeof dish.id !== 'string' || !key.test(dish.id) || !label(dishName) || seen.has(dish.id)) continue
      seen.add(dish.id)
      dishes.push({
        id: dish.id,
        name: dishName,
        family: text(dish.family, 80),
        meals: Array.isArray(dish.meals) ? dish.meals.filter(meal => meals.has(meal)) : [],
        price: number(dish.priceVnd, 1, 10_000_000),
        image: httpsUrl(dish.imageUrl),
        verifiedAt: dish.verifiedAt ?? null,
        expiresAt,
      })
    }
    if (!dishes.length) continue
    restaurants.set(item.id, {
      id: item.id, name, zone, address: text(item.address), maps: httpsUrl(item.mapsUrl),
      venueType: item.venueType === 'street_food' || item.venueType === 'restaurant' ? item.venueType : null,
      lat: number(item.latitude, -90, 90), lng: number(item.longitude, -180, 180),
      score: number(item.homeScore, 0, 100),
      budget: number(item.budgetPerPersonVnd, 1, 10_000_000),
      capacity: number(item.maxGroupSize, 1, 1000),
      issues: Array.isArray(item.recurringIssues) ? item.recurringIssues.map(localized).filter(issue => label(issue)).slice(0, 8) : [],
      dishes,
    })
  }
  return [...restaurants.values()]
}

export function catalogClient(url, token) {
  if (url) {
    const endpoint = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password) {
      throw new Error('HOME_CATALOG_URL must use HTTPS outside loopback')
    }
  }
  let cache
  let request
  return async () => {
    if (!url) return { status: 'unconnected', restaurants: [] }
    if (cache?.expiresAt > Date.now()) return cache.value
    request ??= (async () => {
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          redirect: 'error', signal: AbortSignal.timeout(6000),
        })
        if (!response.ok) throw new Error('HOME Reviews unavailable')
        const restaurants = approvedCatalog(await response.json())
        const expiresAt = restaurants.flatMap(item => item.dishes).reduce(
          (expiry, dish) => Math.min(expiry, dish.expiresAt), Date.now() + cacheDuration,
        )
        const value = { status: 'ready', restaurants }
        cache = { expiresAt, value }
        return value
      } catch {
        return { status: 'unavailable', restaurants: [] }
      }
    })()
    try {
      return await request
    } finally {
      request = undefined
    }
  }
}

function distance(coordinates, restaurant) {
  if (!coordinates || restaurant.lat == null || restaurant.lng == null) return Infinity
  const radians = Math.PI / 180
  const { lat, lng } = coordinates
  const averageLatitude = (lat + restaurant.lat) / 2 * radians
  return 111.195 * Math.hypot(lat - restaurant.lat, (lng - restaurant.lng) * Math.cos(averageLatitude))
}

export function inArea(restaurants, zone, coordinates) {
  if (zone) return restaurants.filter(restaurant => normalize(restaurant.zone) === normalize(zone))
  if (coordinates) return restaurants.filter(restaurant => distance(coordinates, restaurant) <= 12)
  return []
}

export function publicRestaurant(restaurant, dish, coordinates) {
  const distanceKm = distance(coordinates, restaurant)
  return {
    id: restaurant.id, name: restaurant.name, zone: restaurant.zone, address: restaurant.address,
    venueType: restaurant.venueType, distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    maps: restaurant.maps, score: restaurant.score, price: dish ? dish.price : restaurant.budget, issues: restaurant.issues,
    mealSlotsKnown: dish ? dish.meals.length > 0 : null,
  }
}

function historyWeight(history, dish, meal) {
  const names = Object.values(dish.name).filter(Boolean).map(normalize)
  if (!Array.isArray(history)) {
    const count = items => items?.find(item => names.includes(normalize(item.name)))?.count ?? 0
    const timeCount = count(history.byMeal?.[meal])
    const recent = history.recent?.filter(entry => entry.dishes.some(name => names.includes(normalize(name)))).length ?? 0
    const family = history.families?.find(item => item.family === dish.family)?.count ?? 0
    return Math.max(count(history.dishes), timeCount, recent) * 1.6 + timeCount * 0.8 + family * 0.8
  }
  let weight = 0
  for (const entry of history) {
    if (entry.status !== 'confirmed') continue
    for (const consumed of entry.dishes) {
      const exact = consumed.id === dish.id || names.includes(normalize(consumed.name))
      const family = dish.family && normalize(consumed.family || '') === normalize(dish.family)
      if (exact || family) weight += (exact ? 1.6 : 0.8) * (entry.meal === meal ? 1.5 : 1)
    }
  }
  return weight
}

export function dailyCandidates(restaurants, meal, history, coordinates, excluded = []) {
  const groups = new Map()
  for (const restaurant of restaurants) {
    for (const dish of restaurant.dishes) {
      if (dish.meals.length && !dish.meals.includes(meal)) continue
      const group = groups.get(dish.id) ?? { dish, places: [] }
      const distanceKm = distance(coordinates, restaurant)
      const quality = (restaurant.score ?? 0) / 8 - restaurant.issues.length * 1.3
      const score = quality - (Number.isFinite(distanceKm) ? distanceKm * 0.35 : 0)
      group.places.push({ restaurant, dish, score })
      groups.set(dish.id, group)
    }
  }
  const candidates = [...groups.values()].map(({ dish, places }) => {
    places.sort((a, b) => b.score - a.score)
    const habit = historyWeight(history, dish, meal)
    const { restaurant, dish: recommendedDish, score } = places[0]
    return {
      id: dish.id, name: dish.name, family: dish.family, image: recommendedDish.image,
      restaurants: places.map(place => publicRestaurant(place.restaurant, place.dish, coordinates)),
      score: score + Math.min(habit, 8) + (habit === 0 ? 2 : 0),
      familiar: habit > 0,
      near: distance(coordinates, restaurant) < 3,
    }
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  const fresh = candidates.filter(candidate => !excluded.includes(candidate.id))
  return (fresh.length ? fresh : candidates).slice(0, 12)
}

export function groupCandidates(restaurants, party, budget, wish = '', coordinates) {
  const terms = normalize(wish).split(/\s+/).filter(term => term.length > 2)
  return restaurants.filter(restaurant => (restaurant.budget == null || restaurant.budget * party <= budget)
    && (restaurant.capacity == null || restaurant.capacity >= party))
    .map(restaurant => {
      const keywords = normalize(restaurant.dishes.map(dish => `${label(dish.name, 'vi')} ${label(dish.name, 'fr')} ${dish.family}`).join(' '))
      return {
        ...publicRestaurant(restaurant, null, coordinates), capacity: restaurant.capacity,
        total: restaurant.budget == null ? null : restaurant.budget * party,
        rank: terms.filter(term => keywords.includes(term)).length * 5 - restaurant.issues.length * 8,
        menu: restaurant.dishes.map(dish => dish.name).slice(0, 12),
      }
    }).sort((a, b) => Number(a.total == null) - Number(b.total == null)
      || b.rank - a.rank
      || Number(a.score == null) - Number(b.score == null)
      || (a.score != null && b.score != null ? b.score - a.score : 0)
      || a.id.localeCompare(b.id)).slice(0, 12)
}
