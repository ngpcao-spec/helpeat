import { approvedCatalog, dailyCandidates, groupCandidates, inArea, label, normalize } from './catalog.mjs'
import { initialTimes, nextMeal, vietnamTime } from './time.mjs'

export const staticDemo = typeof __HELPEAT_STATIC_DEMO__ !== 'undefined' && __HELPEAT_STATIC_DEMO__
const zone = 'Đà Nẵng'
const databaseKey = 'helpeat:demonstration:v1'
const names = {
  pho: { vi: 'Phở bò', fr: 'Phở au bœuf' },
  bun: { vi: 'Bún thịt nướng', fr: 'Bún au porc grillé' },
  com: { vi: 'Cơm tấm sườn', fr: 'Cơm tấm au porc grillé' },
  rolls: { vi: 'Gỏi cuốn', fr: 'Rouleaux de printemps' },
}
const photos = {
  pho: new URL('./hero.webp', import.meta.url).href,
  bun: new URL('./bun.webp', import.meta.url).href,
  com: new URL('./com.webp', import.meta.url).href,
}
export const samplePhoto = photos.pho
const dishes = {
  pho: { family: 'phở', priceVnd: 69000 },
  bun: { family: 'bún', priceVnd: 59000 },
  com: { family: 'cơm', priceVnd: 65000 },
  rolls: { family: 'gỏi', priceVnd: 45000 },
}

function place(id, name, area, score, budget, capacity, dishIds, issues = []) {
  return {
    id, name, zone: area, published: true, homeScore: score, maxGroupSize: capacity,
    budgetPerPersonVnd: budget, recurringIssues: issues,
    dishes: dishIds.map(id => ({ id, name: names[id], ...dishes[id], confirmed: true, validUntil: '2099-01-01' })),
  }
}

const restaurants = approvedCatalog({ source: 'HOME Reviews', version: 1, restaurants: [
  place('demo-bol', { vi: 'Bếp Bát Mây', fr: 'Le Bol de Nuage' }, zone, 92, 125000, 8, ['pho']),
  place('demo-jardin', { vi: 'Vườn Bún', fr: 'Le Jardin des Nouilles' }, zone, 88, 145000, 12, ['bun', 'pho'],
    [{ vi: 'Chờ lâu vào giờ cao điểm', fr: 'Attente aux heures de pointe' }]),
  place('demo-feu', { vi: 'Bếp Than Hồng', fr: 'La Braise Douce' }, zone, 90, 150000, 10, ['com']),
  place('demo-herbes', { vi: 'Bếp Lá Non', fr: 'La Table des Herbes' }, zone, 75, 100000, 6, ['rolls']),
  place('demo-lotus', { vi: 'Góc Sen Nhỏ', fr: 'La Table du Petit Lotus' }, 'Hà Nội', 89, 120000, 10, ['pho', 'bun', 'com']),
  place('demo-soie', { vi: 'Bếp Lụa', fr: 'La Cuisine de Soie' }, 'Thành phố Hồ Chí Minh', 91, 140000, 12, ['pho', 'bun', 'com']),
] }).map(restaurant => ({
  ...restaurant, dishes: restaurant.dishes.map(dish => ({ ...dish, image: photos[dish.id] ?? '' })),
}))

const zones = [...new Set(restaurants.map(restaurant => restaurant.zone))]
const entriesBefore = (day, shift) => new Date(Date.parse(day) + shift * 86_400_000).toISOString().slice(0, 10)
const matchMeal = (entry, target) => entry.date === target.date && entry.meal === target.meal
const fail = key => { throw new Error(key) }

export function createDemoApi(storage) {
  const initialData = () => ({ preferences: { locale: 'vi', zone, notify: false, times: { ...initialTimes } }, entries: [] })
  function load() {
    try {
      const stored = JSON.parse(storage.getItem(databaseKey))
      if (stored?.preferences && Array.isArray(stored.entries)) return stored
    } catch {
      // A missing, inaccessible or obsolete local journal starts empty.
    }
    return null
  }

  let data = load() ?? initialData()
  function save(replacement) {
    data = replacement
    try {
      storage.setItem(databaseKey, JSON.stringify(data))
    } catch {
      // The current browser tab remains usable if storage is unavailable.
    }
  }

  return async (path, method, body = {}) => {
    data = load() ?? data
    const { date: today } = vietnamTime()
    const { preferences, entries } = data
    const matching = entries.find(entry => matchMeal(entry, body))
    if (path === 'session') return {
      account: { name: '', preferences }, preview: true, demo: true, google: false,
      photo: true, pushKey: '', zones, catalog: 'ready', upcoming: nextMeal(), today,
    }
    if (path === 'today') {
      const area = inArea(restaurants, body.zone)
      const candidates = dailyCandidates(area, body.meal, entries, null, body.exclude)
      return {
        status: 'ready', hasArea: Boolean(body.zone), entry: matching ?? null,
        suggestions: body.detailId ? candidates.filter(candidate => candidate.id === body.detailId) : candidates.slice(0, 3),
      }
    }
    if (path === 'outing') return {
      status: 'ready', suggestions: groupCandidates(inArea(restaurants, body.zone), body.party, body.budget, body.wish).slice(0, 3),
    }
    if (path.startsWith('dishes?')) {
      const q = normalize(new URLSearchParams(path.split('?')[1]).get('q') ?? '')
      return Object.entries(names).filter(([, name]) => Object.values(name).some(value => normalize(value).includes(q)))
        .map(([id, name]) => ({ id, name: label(name, preferences.locale), family: dishes[id].family }))
    }
    if (path.startsWith('journal')) {
      const before = new URLSearchParams(path.split('?')[1]).get('before') ?? entriesBefore(today, 2)
      const from = entriesBefore(before, -16)
      return { before, from, entries: entries.filter(entry => entry.date >= from && entry.date < before) }
    }
    if (path === 'preferences') {
      const updated = { ...body, notify: false }
      save({ ...data, preferences: updated })
      return updated
    }
    if (path === 'meal' && method === 'PUT') {
      if (body.status === 'planned' && matching?.status === 'confirmed') fail('alreadyConfirmed')
      const mealDishes = body.dishes.map(dish => {
        const item = Object.entries(names).find(([, name]) => Object.values(name)
          .some(value => normalize(value) === normalize(dish.name)))
        return { name: dish.name, id: item?.[0] ?? '', family: item ? dishes[item[0]].family : '' }
      })
      const entry = { meal: body.meal, date: body.date, status: body.status, dishes: mealDishes }
      save({ ...data, entries: [...entries.filter(item => !matchMeal(item, body)), entry] })
      return { ok: true }
    }
    if ((path === 'meal' || path === 'plan') && method === 'DELETE') {
      if (path === 'plan' && matching?.status !== 'planned') return { ok: true }
      save({ ...data, entries: entries.filter(item => !matchMeal(item, body)) })
      return { ok: true }
    }
    if (path === 'photo') return { dishes: [label(names.pho, preferences.locale), label(names.rolls, preferences.locale)] }
    return fail('unexpected')
  }
}
