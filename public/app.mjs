import { icon } from './icons.mjs'
import { slots, translations } from './copy.mjs'
import { createDemoApi, samplePhoto, staticDemo } from './demo.mjs'
import { nextMeal } from './time.mjs'

const main = document.querySelector('#content')
const header = document.querySelector('#header')
const nav = document.querySelector('#nav')
const dialog = document.querySelector('#dialog')
const toast = document.querySelector('#toast')
const search = new URLSearchParams(location.search)
const config = typeof __HELPEAT_REAL_CONFIG__ === 'undefined' ? null : __HELPEAT_REAL_CONFIG__
const onExpectedOrigin = !config?.origin || config.origin === location.origin
const pilotMode = Boolean(config?.pilotHashes && onExpectedOrigin && search.get('mode') === 'pilot')
const realConfig = onExpectedOrigin && (!config?.pilotHashes || pilotMode) ? config : null
const chosenMode = realConfig && (search.get('mode') ?? localStorage.getItem('helpeat-active-mode'))
const realMode = pilotMode || chosenMode === 'real'
const realModeName = pilotMode ? 'pilot' : 'real'
if (realConfig && !pilotMode) localStorage.setItem('helpeat-active-mode', realMode ? 'real' : 'demo')
const locationPreference = staticDemo && !realMode ? 'helpeat-demo-language' : 'helpeat-language'
const demoApi = staticDemo && !realMode ? createDemoApi(localStorage) : null
let realClient
const slotIcons = { breakfast: 'sun', lunch: 'sun', dinner: 'moon' }
const pages = { today: 'today', outing: 'group', journal: 'book', account: 'person' }
const state = {
  locale: localStorage.getItem(locationPreference) === 'fr' ? 'fr' : 'vi',
  session: null, preferences: null, target: null, coordinates: null, locating: false,
  daily: null, exclude: [], journal: null, outing: null, outingInput: null, form: null,
  loading: '', toastTimer: 0, dailyRequest: 0, notificationTarget: false, checkedAt: 0, habits: null,
}
const t = key => translations[state.locale][key] ?? translations[state.locale].unexpected
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch])
const lang = () => state.locale === 'fr' ? 'fr-FR' : 'vi-VN'
const name = item => item?.[state.locale] || item?.vi || item?.fr || ''
const price = value => new Intl.NumberFormat(lang(), { style: 'currency', currency: 'VND' }).format(value)
const priceRange = place => place.maxPrice > place.price
  ? price(place.price) + ' – ' + price(place.maxPrice) : price(place.price)
const signedIn = () => Boolean(state.session?.account)
const among = (value, list) => list.includes(value)
const shiftDay = (day, shift) => new Date(Date.parse(day) + shift * 86_400_000).toISOString().slice(0, 10)

function route() {
  const [screen, id] = location.hash.slice(1).split('/')
  return { screen: among(screen, [...Object.keys(pages), 'dish', 'addresses']) ? screen : 'today', id }
}

function formatDate(date) {
  return new Intl.DateTimeFormat(lang(), {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(date))
}

async function api(path, method = 'GET', body) {
  if (realClient) return realClient.api(path, method, body)
  if (demoApi) return demoApi(path, method, body)
  let response
  try {
    response = await fetch('/api/' + path, {
      method, cache: 'no-store', ...(method === 'GET' ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      }),
    })
  } catch {
    throw new Error('offline')
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}

function announce(message, error = false) {
  clearTimeout(state.toastTimer)
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.classList.add('visible')
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200)
}

function errorMessage(error) {
  if (dialog.open) {
    dialog.querySelector('.dialog-error')?.remove()
    const message = document.createElement('p')
    message.setAttribute('role', 'alert')
    message.className = 'dialog-error inline-error'
    message.textContent = t(error.message)
    dialog.querySelector('form')?.append(message)
  } else announce(t(error.message), true)
}

function button(action, text, symbol = '', kind = 'secondary', attributes = '') {
  return '<button type="button" class="button ' + kind + '" data-action="' + action + '" ' + attributes + '>'
    + (symbol ? icon(symbol) : '') + '<span>' + esc(text) + '</span></button>'
}

function heading(title, description, symbol) {
  return '<section class="page-heading"><div class="heading-icon">' + icon(symbol) + '</div>'
    + '<h1>' + esc(title) + '</h1><p>' + esc(description) + '</p></section>'
}

function empty(symbol, title, copy, action = '') {
  return '<div class="empty"><div class="empty-icon">' + icon(symbol) + '</div>'
    + '<h3>' + esc(title) + '</h3>' + (copy ? '<p>' + esc(copy) + '</p>' : '') + action + '</div>'
}

function demoTag() {
  return state.session.demo ? '<span class="demo-tag">' + t('demoTag') + '</span>' : ''
}

function renderChrome() {
  document.documentElement.lang = state.locale
  document.querySelector('#skip').textContent = t('skip')
  header.innerHTML = '<div class="header-inner"><a class="brand" href="#today"><span class="brand-icon">'
    + icon('bowl') + '</span><span>Helpeat</span></a><div class="header-actions">'
    + (state.session.demo ? '<span class="demo-mode">' + t('demoMode') + '</span>'
      : state.session.preview ? '<span class="preview-label">' + t('preview') + '</span>' : '')
    + (signedIn() ? button('area', state.preferences.zone || (state.coordinates ? t('near') : t('chooseArea')), 'pin', 'location-button')
      : button('language', state.locale === 'fr' ? 'Tiếng Việt' : 'Français', 'language', 'location-button'))
    + '</div></div>'
  nav.hidden = !signedIn()
  if (!signedIn()) return
  const active = route().screen
  nav.setAttribute('aria-label', 'Helpeat')
  nav.innerHTML = Object.entries(pages).map(([key, symbol]) => {
    const chosen = key === active || (key === 'today' && among(active, ['dish', 'addresses']))
    return '<a href="#' + key + '"' + (chosen ? ' aria-current="page"' : '') + '>'
      + '<span class="tab-icon">' + icon(symbol) + '</span><span>' + t(key) + '</span></a>'
  }).join('')
}

function hero(signed) {
  const target = state.target
  return '<section class="hero"><div class="hero-body">'
    + (signed ? '<p class="eyebrow"><span class="date-dot"></span>' + esc(formatDate(target.date)) + '</p>' : '')
    + '<h1>' + t('hero') + '</h1><p class="hero-copy">' + t(signed
      ? state.session.demo ? 'demoHeroCopy' : 'heroCopy' : 'signInCopy') + '</p>'
    + (signed ? '<div class="meal-badge">' + icon(slotIcons[target.meal]) + '<span>' + t('upcoming') + '</span>'
      + '<strong>' + t(target.meal) + '</strong></div>' : '')
    + '</div></section>'
}

function signIn() {
  const authError = state.session.authenticationError
  const error = authError ? t(authError)
    : search.get('auth') === 'failed' || search.has('error') || search.has('error_code') || search.has('code') ? t('authFailed') : ''
  return hero(false) + '<section class="panel sign-in"><h2>' + t('google') + '</h2>'
    + (error ? '<p class="inline-error">' + esc(error) + '</p>' : '')
    + (state.session.google ? button('google', t('google'), '', 'primary')
      : state.session.pilotHomeUrl
        ? '<p>' + t('pilotHomeRequired') + '</p><a class="button secondary" href="'
          + esc(state.session.pilotHomeUrl) + '">' + t('pilotOpenHome') + '</a>'
        : '<p>' + t('googleUnavailable') + '</p>') + '</section>' + modeLink()
}

function currentMeal() {
  const entry = state.daily?.entry
  const type = entry ? entry.status + 'Title' : 'journal'
  return '<aside class="panel journal-card"><span class="heading-icon">' + icon('book') + '</span>'
    + '<h2>' + t(type) + '</h2>'
    + '<p>' + (entry ? esc(entry.dishes.map(dish => dish.name).join(' · ')) : t('journalCopy')) + '</p>'
    + (entry?.status === 'planned'
      ? '<div class="action-row">' + button('confirm-current', t('confirmYes'), 'check', 'primary',
        !state.session.demo && entry.date > state.session.today ? 'disabled' : '')
        + button('replace-current', t('confirmOther'), '', 'secondary',
          !state.session.demo && entry.date > state.session.today ? 'disabled' : '')
        + button('skip-current', t('ignore'), 'close', 'secondary') + '</div>'
      : entry ? button('edit-current', t('edit'), 'book', 'primary')
      : button('add-current', t('add'), 'plus', 'primary'))
    + '</aside>'
}

function suggestionMedia(dish, restaurant) {
  const image = dish.image || restaurant.photo
  const backup = dish.image && restaurant.photo !== dish.image ? restaurant.photo : ''
  return '<div class="suggestion-media"><div class="suggestion-thumbnail">'
    + '<span class="dish-placeholder" aria-hidden="true">' + icon('bowl') + '</span>'
    + (image ? '<img class="suggestion-image" src="' + esc(image) + '" alt="" loading="lazy" decoding="async"'
      + ' referrerpolicy="no-referrer"' + (backup ? ' data-backup="' + esc(backup) + '"' : '') + '>' : '')
    + '</div>' + (restaurant.photo
      ? '<small class="suggestion-photo-label"' + (dish.image ? ' hidden' : '') + '>' + t('restaurantPhoto') + '</small>' : '')
    + '</div>'
}

main.addEventListener('error', ({ target: image }) => {
  if (!image.matches?.('.suggestion-image')) return
  const label = image.closest('.suggestion-media').querySelector('.suggestion-photo-label')
  const backup = image.dataset.backup
  if (backup) {
    delete image.dataset.backup
    if (label) label.hidden = false
    image.src = backup
  } else {
    if (label) label.hidden = true
    image.remove()
  }
}, true)

function dailySuggestions() {
  const data = state.daily
  if (state.loading === 'today' && !data) return empty('clock', t('loading'), '')
  if (data?.error) return empty('bowl', t(data.error), '', button('refresh', t('retry'), 'redo'))
  if (!data || data.status !== 'ready') return empty('bowl', t('catalogTitle'), t(data?.status || state.session.catalog))
  if (data.hasCatalog === false) return empty('bowl', t('catalogTitle'), t('catalogEmpty'))
  if (!data.hasArea) return empty('pin', t('noAreaTitle'), t('noArea'), button('area', t('chooseArea'), 'pin'))
  if (!data.suggestions.length) return empty('bowl', t('catalogTitle'), t('empty'),
    realMode ? button('area', t('changeArea'), 'pin') : '')
  return (data.exhausted ? '<p role="status">' + t('noMoreDishes') + '</p>' : '')
    + (data.source === 'fallback' && realMode ? '<p role="status">' + t('classicSuggestions') + '</p>' : '')
    + '<div class="suggestions">' + data.suggestions.map(dish => {
    const first = dish.restaurants[0]
    return '<a class="suggestion" href="#dish/' + esc(dish.id) + '">'
      + suggestionMedia(dish, first)
      + '<div class="suggestion-info"><h3>' + esc(name(dish.name)) + '</h3><p>' + esc(name(first.name)) + '</p>'
      + (first.price == null ? '' : '<strong class="suggestion-price">' + esc(priceRange(first)) + '</strong>')
      + (dish.reason ? '<p class="suggestion-reason">' + esc(dish.reason) + '</p>' : '')
      + (realMode && first.score == null ? '<small>' + t('scoreUnavailable') + '</small>' : '') + demoTag() + '</div></a>'
  }).join('') + '</div>'
}

function today() {
  return hero(true) + '<div class="daily-grid"><section><div class="section-heading"><div><h2>' + t('recommendations') + '</h2>'
    + '<p>' + t(state.session.demo ? 'demoSource' : 'source') + '</p></div>'
    + button('refresh', t(realMode ? 'aiRefresh' : 'refresh'), 'redo', 'secondary', state.loading === 'today' ? 'disabled' : '')
    + '</div><div class="panel recommendation-panel">' + dailySuggestions() + '</div></section>'
    + currentMeal() + '</div>'
}

function weeklyHours(hours) {
  const weekday = new Intl.DateTimeFormat(lang(), { weekday: 'long', timeZone: 'UTC' })
  const time = minutes => {
    const hour = minutes === 1440 ? 24 : Math.floor(minutes / 60) % 24
    return String(hour).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
  }
  return '<details><summary>' + t('weeklyHours') + '</summary><ul>'
    + hours.map(day => '<li>' + esc(weekday.format(new Date(Date.UTC(2023, 0, 1 + day.day)))) + ' · '
      + (day.status === 'closed' ? t('closedDay') : day.intervals.map(slot => time(slot.start) + '–' + time(slot.end)).join(', '))
      + '</li>').join('') + '</ul></details>'
}

function restaurantCard(place, isGroup = false) {
  const issues = place.issues?.length ? '<details><summary>' + t('issues') + '</summary><ul>'
    + place.issues.map(issue => '<li>' + esc(name(issue)) + '</li>').join('') + '</ul></details>' : ''
  const distance = place.distanceKm == null ? '' : new Intl.NumberFormat(lang(), {
    style: 'unit', unit: 'kilometer', maximumFractionDigits: 1,
  }).format(place.distanceKm)
  const location = [place.address || place.zone, distance].filter(Boolean).join(' · ')
  const specialty = name(place.specialty)
  return '<article class="panel restaurant">'
    + (place.photo ? '<img class="detail-photo" loading="lazy" referrerpolicy="no-referrer" src="'
      + esc(place.photo) + '" alt="' + esc(name(place.name)) + '">' : '')
    + '<div class="section-heading"><div><h3>' + esc(name(place.name)) + '</h3>'
    + '<p>' + esc(location) + '</p>'
    + (place.venueType === 'street_food' ? '<p>' + t('streetFood') + '</p>' : '')
    + (specialty ? '<p>' + t('specialty') + ' · ' + esc(specialty) + '</p>' : '')
    + (realMode && place.score == null ? '<p>' + t('scoreUnavailable') + '</p>' : '') + demoTag() + '</div>'
    + (place.score == null ? '' : '<span class="score" title="' + t(state.session.demo ? 'demoScore' : 'score') + '">'
      + icon('star') + esc(place.score) + '/' + esc(place.scoreMax ?? 100) + '</span>') + '</div>'
    + (place.price == null ? '' : '<p>' + esc(priceRange(place)) + (isGroup ? ' ' + t('perPerson') : '') + '</p>')
    + (place.hours?.length ? weeklyHours(place.hours)
      : realMode && place.mealSlotsKnown === false ? '<p>' + t('serviceUnknown') + '</p>' : '')
    + (isGroup ? (place.total == null ? '<p>' + t('budgetUnknown') + '</p>'
      : '<p>' + t(state.session.demo ? 'demoTotal' : 'estimatedTotal') + ' · <strong>' + esc(price(place.total)) + '</strong></p>')
      + (place.capacity == null ? '<p>' + t('capacityUnknown') + '</p>' : '<p>' + t('capacity') + ' · ' + esc(place.capacity) + '</p>')
      + '<details><summary>' + t('menu') + '</summary><ul>'
      + place.menu.map(item => '<li>' + esc(name(item)) + '</li>').join('') + '</ul></details>' : '')
    + issues + (place.maps ? '<a class="button secondary" href="' + esc(place.maps) + '" target="_blank" rel="noopener noreferrer">'
      + icon('external') + t('directions') + '</a>' : '') + '</article>'
}

function dishPage(id, addresses) {
  const dish = state.daily?.suggestions?.find(item => item.id === id)
  if (state.loading === 'today' && (realMode || !dish)) return empty('clock', t('loading'), '')
  if (!dish) return '<a class="back" href="#today">' + icon('back') + t('back') + '</a>'
    + empty('bowl', t('dishUnavailable'), '')
  const alternatives = dish.restaurants.slice(1)
  return '<a class="back" href="#' + (addresses ? 'dish/' + esc(id) : 'today') + '">' + icon('back') + t('back') + '</a>'
    + heading(addresses ? t('other') : name(dish.name), addresses ? name(dish.name) : t('best'), addresses ? 'pin' : 'bowl')
    + (addresses ? (alternatives.length ? alternatives.map(place => restaurantCard(place)).join('') : empty('pin', t('otherEmpty'), ''))
      : (dish.image ? '<img class="detail-photo" src="' + esc(dish.image) + '" alt="">' : '') + restaurantCard(dish.restaurants[0])
        + '<div class="action-row">' + button('confirm-dish', t('confirm'), 'check', 'primary',
          'data-id="' + esc(id) + '"' + (!state.session.demo && state.target.date > state.session.today ? ' disabled' : ''))
        + button('plan-dish', t('plan'), 'clock', 'secondary', 'data-id="' + esc(id) + '"')
        + '<a class="button secondary" href="#addresses/' + esc(id) + '">' + icon('pin') + t('other') + '</a></div>')
}

function journal() {
  const data = state.journal
  const days = []
  if (data?.from) {
    for (let day = shiftDay(data.before, -1); day >= data.from; day = shiftDay(day, -1)) days.push(day)
  }
  return heading(t('journal'), t(state.session.demo ? 'demoJournal' : 'journalIntro'), 'book')
    + '<div class="action-row">' + button('add', t('add'), 'plus', 'primary')
    + button('photo', t('photo'), 'camera', 'secondary', state.session.photo ? '' : 'disabled title="' + t('photoUnavailable') + '"')
    + '</div>'
    + (data?.error ? empty('book', t(data.error), '', button('journal-retry', t('retry'), 'redo')) : '')
    + (!data ? '<p role="status">' + t('loading') + '</p>' : '')
    + days.map(date => {
      const entries = data.entries.filter(entry => entry.date === date)
      if (date > state.session.today && !entries.length) return ''
      return '<section class="panel journal-day"><h2>' + esc(formatDate(date)) + '</h2>'
        + slots.map(meal => {
          const entry = entries.find(item => item.meal === meal)
          if (!entry && date > state.session.today) return ''
          return '<button type="button" class="journal-row" data-action="edit-meal" data-date="' + date + '" data-meal="' + meal
            + '"><span class="slot-icon">' + icon(slotIcons[meal]) + '</span><span><strong>' + t(meal)
            + '</strong>' + (entry ? '<small>' + esc(entry.dishes.map(dish => dish.name).join(' · ')) + '</small>' : '')
            + '</span><span class="status ' + (entry?.status ?? '') + '">' + t(entry?.status ?? 'missing') + '</span></button>'
        }).join('') + '</section>'
    }).join('') + (days.length ? button('older', t('older'), 'clock') : '')
}

function outing() {
  const values = state.outingInput ?? { party: 2, budget: '', zone: state.preferences.zone, wish: '' }
  const data = state.outing
  return heading(t('outingTitle'), t('outingIntro'), 'group')
    + '<form id="outing-form" class="panel form-panel"><div class="form-grid"><label>' + t('party')
    + '<input name="party" type="number" min="2" max="100" required value="' + esc(values.party) + '"></label><label>' + t('budget')
    + '<input name="budget" type="number" min="1" max="100000000" inputmode="numeric" required value="' + esc(values.budget) + '"></label>'
    + '<label>' + t('region') + '<input name="zone" list="known-zones" maxlength="150" value="' + esc(values.zone)
    + '" placeholder="' + t(state.coordinates ? 'near' : 'areaExample') + '"' + (state.coordinates ? '' : ' required') + '></label>'
    + '<label>' + t('wish') + '<input name="wish" maxlength="180" value="' + esc(values.wish) + '" placeholder="' + t('wishExample') + '"></label>'
    + '</div><datalist id="known-zones">' + zoneOptions() + '</datalist>'
    + '<button class="button primary"' + (state.loading === 'outing' ? ' disabled' : '') + '>'
    + icon('search') + t(state.loading === 'outing' ? 'loading' : 'find') + '</button></form>'
    + (data ? '<section class="outing-results"><h2>' + t('outingResults') + '</h2>'
      + (data.error ? empty('group', t(data.error), '')
        : data.status !== 'ready' ? empty('group', t('catalogTitle'), t(data.status))
          : data.hasCatalog === false ? empty('group', t('catalogTitle'), t('catalogEmpty'))
          : !data.suggestions.length ? empty('group', t('groupEmpty'), '',
            realMode ? button('outing-area', t('changeArea'), 'pin') : '')
            : data.suggestions.map(place => restaurantCard(place, true)).join('')) + '</section>' : '')
}

function modeLink() {
  if (!realConfig) return ''
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('mode', realMode ? 'demo' : 'real')
  return '<a class="button secondary" href="' + esc(url.pathname + url.search) + '">'
    + t(realMode ? 'openDemo' : 'openReal') + '</a>'
}

function habitsPanel() {
  if (!realMode) return ''
  const habits = state.habits
  const list = (items, getName) => '<ul>' + items.map(item => '<li>' + esc(getName(item))
    + ' · ' + esc(item.count) + '</li>').join('') + '</ul>'
  let content = '<p role="status">' + t('loading') + '</p>'
  if (habits?.error) content = '<p>' + t(habits.error) + '</p>'
  else if (habits && !habits.dishes.length) content = '<p>' + t('habitsEmpty') + '</p>'
  else if (habits) {
    content = list(habits.dishes, item => item.name)
      + (habits.families.length ? '<h3>' + t('families') + '</h3>' + list(habits.families, item => t(item.family)) : '')
      + slots.filter(slot => habits.byMeal[slot]?.length).map(slot =>
        '<h3>' + t(slot) + '</h3>' + list(habits.byMeal[slot], item => item.name)).join('')
      + '<h3>' + t('recentMeals') + '</h3><ul>'
      + habits.recent.map(meal => '<li>' + esc(formatDate(meal.date)) + ' · ' + t(meal.meal)
        + ' · ' + esc(meal.dishes.join(', ')) + '</li>').join('') + '</ul>'
  }
  return '<section id="habits" class="panel form-panel"><h2>' + t('habits') + '</h2>' + content + '</section>'
}

function account() {
  const preferences = state.preferences
  const supported = Boolean(state.session.pushKey && 'PushManager' in window
    && 'Notification' in window && 'serviceWorker' in navigator)
  return heading(state.session.account.name || t('account'), 'Helpeat', 'person')
    + '<section class="panel form-panel"><h2>' + t('language') + '</h2>'
    + '<div class="language-switch">' + ['vi', 'fr'].map(locale =>
      button('select-language', locale === 'vi' ? 'Tiếng Việt' : 'Français', '', 'secondary',
        'data-locale="' + locale + '" aria-pressed="' + (state.locale === locale) + '"')).join('') + '</div></section>'
    + '<section class="panel form-panel"><h2>' + t('notify') + '</h2><p>' + t('notifyCopy') + '</p>'
    + '<form id="times-form"><div class="form-grid times">' + slots.map(meal => '<label>' + t(meal)
      + '<input type="time" name="' + meal + '" value="' + esc(preferences.times[meal]) + '" required></label>').join('')
    + '</div><div class="action-row"><button class="button secondary">' + t('save') + '</button>'
    + (supported ? button('push', t(preferences.notify ? 'disablePush' : 'enablePush'), 'bell', 'primary') : '')
    + '</div></form>' + (supported ? '' : '<p class="muted">' + t(state.session.demo ? 'demoPush' : 'notifyUnavailable') + '</p>') + '</section>'
    + habitsPanel() + '<div class="action-row">' + (!state.session.preview ? button('logout', t('logout')) : '')
    + modeLink() + '</div>'
}

function render() {
  if (!state.session) return
  renderChrome()
  if (!signedIn()) {
    main.innerHTML = signIn()
    return
  }
  const { screen, id } = route()
  main.innerHTML = screen === 'dish' || screen === 'addresses' ? dishPage(id, screen === 'addresses')
    : { today, outing, journal, account }[screen]()
}

function zoneOptions() {
  return (state.session.zones ?? []).map(zone => '<option value="' + esc(zone) + '"></option>').join('')
}

async function daily(exclude = false) {
  const request = ++state.dailyRequest
  const last = state.daily
  const previous = state.daily?.suggestions ?? []
  if (exclude) state.exclude = [...new Set([...state.exclude, ...previous.map(item => item.id)])].slice(-60)
  state.loading = 'today'
  render()
  try {
    const { screen, id } = route()
    const detailId = ['dish', 'addresses'].includes(screen) ? id : ''
    const data = await api('today', 'POST', {
      ...state.target, coordinates: state.coordinates, zone: state.preferences.zone, detailId,
      exclude: detailId ? [] : state.exclude, locale: state.locale, refresh: exclude,
      refreshFrom: exclude ? last?.aiId : null, previousIds: exclude ? previous.map(dish => dish.id) : [],
    })
    if (request === state.dailyRequest) {
      if (data.preserveAI && last?.source === 'ai') {
        data.source = 'ai'
        data.aiId = last.aiId
        data.suggestions = data.suggestions.map(dish => ({ ...dish, reason: previous.find(item => item.id === dish.id)?.reason }))
      }
      state.daily = data
    }
  } catch (error) {
    if (request === state.dailyRequest) state.daily = { error: error.message }
  } finally {
    if (request === state.dailyRequest) {
      if (state.loading === 'today') state.loading = ''
      if (among(route().screen, ['today', 'dish', 'addresses'])) render()
    }
  }
}

async function loadJournal(older = false) {
  const previous = state.journal
  try {
    const data = await api('journal' + (older ? '?before=' + previous.from : ''))
    state.journal = older ? { ...data, before: previous.before, entries: [...previous.entries, ...data.entries] } : data
  } catch (error) {
    state.journal = previous?.entries ? previous : { error: error.message }
    if (previous?.entries) errorMessage(error)
  }
  if (route().screen === 'journal') render()
}

async function loadHabits() {
  if (!realMode) return
  try {
    state.habits = await api('habits')
  } catch (error) {
    state.habits = { error: error.message }
  }
  const panel = document.querySelector('#habits')
  if (panel && route().screen === 'account') panel.outerHTML = habitsPanel()
}

async function savePreferences(update) {
  state.preferences = await api('preferences', 'PUT', { ...state.preferences, ...update })
  state.locale = state.preferences.locale
  localStorage.setItem(locationPreference, state.locale)
  render()
}

async function geolocate(save = false) {
  if (state.locating) return
  if (!navigator.geolocation) {
    if (save) announce(t('geoError'), true)
    return
  }
  state.locating = true
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve, reject, { timeout: 7000, maximumAge: 300_000 },
    ))
    state.coordinates = { lat: Math.round(position.coords.latitude * 1000) / 1000,
      lng: Math.round(position.coords.longitude * 1000) / 1000 }
    if (save) {
      await savePreferences({ zone: '' })
      if (dialog.open) dialog.close()
    }
    state.exclude = []
    if (route().screen === 'today') await daily()
    else render()
  } catch {
    if (save) announce(t('geoError'), true)
  } finally {
    state.locating = false
  }
}

function showDialog(title, copy, content) {
  dialog.innerHTML = '<div class="dialog-title"><h2 id="dialog-title">' + esc(title)
    + '</h2><button type="button" class="icon-button" data-action="close" aria-label="' + t('close') + '">'
    + icon('close') + '</button></div>' + (copy ? '<p>' + esc(copy) + '</p>' : '') + content
  dialog.setAttribute('aria-labelledby', 'dialog-title')
  if (!dialog.open) dialog.showModal()
  sizeDialog()
}

function areaDialog() {
  showDialog(t('chooseArea'), '', '<form id="area-form"><label>' + t('manualArea')
    + '<input name="zone" required maxlength="150" list="dialog-zones" value="' + esc(state.preferences.zone)
    + '" placeholder="' + t('areaExample') + '"></label><datalist id="dialog-zones">' + zoneOptions()
    + '</datalist><div class="action-row"><button class="button primary">' + t('save') + '</button>'
    + (state.session.demo ? '' : button('position', t('position'), 'near')) + '</div></form>')
}

function editorForm() {
  const form = state.form
  const rows = form.dishes.map((dish, index) =>
    '<div class="dish-input"><input name="dish" type="text" list="matching-' + index + '" maxlength="100" '
      + 'aria-label="' + t('search') + '" placeholder="' + t('dishExample') + '" value="' + esc(dish.name)
      + '"><datalist id="matching-' + index + '"></datalist>'
      + '<button class="icon-button" type="button" data-action="remove-dish" data-index="' + index
      + '" aria-label="' + t('deleteDish') + '"' + (form.dishes.length === 1 ? ' disabled' : '') + '>' + icon('close') + '</button></div>'
  ).join('')
  const title = form.fromPhoto ? (state.session.demo ? 'demoReview' : 'review') : form.existing ? 'edit' : 'add'
  const dateLimit = state.session.demo && form.date > state.session.today ? form.date : state.session.today
  showDialog(t(title), form.fromPhoto ? t(state.session.demo ? 'demoReviewCopy' : 'reviewCopy') : '',
    '<form id="meal-form"><div class="form-grid"><label>' + t('mealDate')
    + '<input name="date" type="date" required max="' + dateLimit + '" value="' + esc(form.date) + '"'
    + (form.existing ? ' readonly' : '') + '></label><label>'
    + t('mealSlot') + '<select name="meal"' + (form.existing ? ' disabled' : '') + '>' + slots.map(meal => '<option value="' + meal + '"'
      + (form.meal === meal ? ' selected' : '') + '>' + t(meal) + '</option>').join('') + '</select></label></div>'
    + '<div class="field-heading">' + t('dishes') + '</div>' + rows + '<div class="action-row">'
    + button('add-dish', t('addDish'), 'plus', 'secondary', form.dishes.length >= 12 ? 'disabled' : '')
    + (state.session.photo ? button('photo-editor', t('photo'), 'camera') : '')
    + '</div><div class="action-row dialog-actions"><button class="button primary">'
    + icon('check') + t(form.existing?.status === 'planned' ? 'confirm' : 'save') + '</button>'
    + (form.existing ? button('delete-meal', t('remove'), '', 'danger') : '') + '</div></form>')
}

function openEditor(target = state.target, entry = null, dishes = entry?.dishes, fromPhoto = false) {
  state.form = {
    date: entry?.date ?? (target.date > state.session.today ? state.session.today : target.date),
    meal: entry?.meal ?? target.meal, dishes: (dishes?.length ? dishes : [{ name: '' }]).map(dish => ({ ...dish })),
    existing: entry, fromPhoto,
  }
  editorForm()
}

function readEditor() {
  const element = dialog.querySelector('#meal-form')
  if (!element) return
  const draft = new FormData(element)
  state.form.date = draft.get('date')
  state.form.meal = draft.get('meal') ?? state.form.meal
  state.form.dishes = draft.getAll('dish').map(name => ({ name: name.trim() }))
}

function photoDialog() {
  const demo = state.session.demo
  showDialog(t('photoTitle'), t(demo ? 'demoPhotoCopy' : 'photoCopy'), '<form id="photo-form"><div class="form-grid photo-fields">'
    + '<label>' + t('photo') + '<input name="photo" type="file" accept="image/*" capture="environment" required></label>'
    + '<label>' + t('secondPhoto') + '<input name="second" type="file" accept="image/*" capture="environment"></label>'
    + '</div>' + (demo ? '<img class="sample-photo" src="' + esc(samplePhoto) + '" alt="' + t('demoSampleAlt') + '">' : '')
    + '<div class="action-row"><button class="button ' + (demo ? 'secondary' : 'primary') + '">' + icon('camera')
    + t(demo ? 'demoAnalyze' : 'analyze') + '</button>'
    + (demo ? button('demo-photo', t('demoSample'), 'camera', 'primary') : '') + '</div></form>')
}

async function resizedImage(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const jpeg = canvas.toDataURL('image/jpeg', 0.78)
    if (!jpeg.startsWith('data:image/jpeg;base64,') || jpeg.length > 2_000_000) throw new Error('tooLarge')
    return jpeg
  } catch (error) {
    throw new Error(error.message === 'tooLarge' ? 'tooLarge' : 'imageFailed')
  } finally {
    bitmap?.close()
  }
}

async function finishPhoto(form, images) {
  const result = await api('photo', 'POST', state.session.demo ? {} : { images })
  if (!dialog.open || !form.isConnected) return
  const draft = state.form
  openEditor(draft ?? state.target, draft?.existing, [...(draft?.dishes ?? []).filter(dish => dish.name),
    ...result.dishes.map(name => ({ name }))].slice(0, 12), true)
  if (!result.dishes.length) announce(t('noPhotoDishes'))
}

async function refreshAfterMeal() {
  state.habits = null
  state.exclude = []
  if (route().screen === 'journal') return loadJournal()
  if (route().screen !== 'today') location.hash = 'today'
  else await daily()
}

async function submitMeal() {
  readEditor()
  const { date, meal, dishes, existing } = state.form
  const complete = dishes.filter(dish => dish.name)
  if (!complete.length) throw new Error('addAtLeastOne')
  const known = state.journal?.entries.find(entry => entry.date === date && entry.meal === meal)
    ?? (state.daily?.entry?.date === date && state.daily.entry.meal === meal ? state.daily.entry : null)
  if (known?.status === 'confirmed' && (existing?.date !== date || existing?.meal !== meal)
      && !window.confirm(t('sameSlot'))) return
  await api('meal', 'PUT', { date, meal, status: 'confirmed', dishes: complete })
  dialog.close()
  announce(t('saved'))
  await refreshAfterMeal()
}

async function togglePush() {
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (state.preferences.notify) {
    await savePreferences({ notify: false })
    if (subscription) {
      await api('push', 'DELETE', { endpoint: subscription.endpoint })
      await subscription.unsubscribe()
    }
  } else {
    if (await Notification.requestPermission() !== 'granted') throw new Error('notifyDenied')
    if (!subscription) {
      const key = state.session.pushKey.replace(/-/g, '+').replace(/_/g, '/')
      const applicationServerKey = Uint8Array.from(atob(key), ch => ch.charCodeAt(0))
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    }
    await api('push', 'POST', subscription.toJSON())
    await savePreferences({ notify: true })
  }
  announce(t('saved'))
}

async function action(element) {
  const { action, id, date, meal, index, locale } = element.dataset
  const entry = state.daily?.entry
  const dish = state.daily?.suggestions?.find(item => item.id === id)
  const chosen = dish && [{ id, name: name(dish.name), family: dish.family }]
  const actions = {
    google: () => realClient?.signIn(),
    area: areaDialog,
    'outing-area': () => document.querySelector('#outing-form [name="zone"]')?.focus(),
    position: () => geolocate(true),
    language: () => {
      state.locale = state.locale === 'fr' ? 'vi' : 'fr'
      localStorage.setItem(locationPreference, state.locale)
      render()
      if (realMode && route().screen === 'today') void daily()
    },
    'select-language': () => savePreferences({ locale }),
    refresh: () => daily(true),
    add: () => openEditor(),
    'add-current': () => openEditor(),
    'confirm-current': async () => {
      await api('meal', 'PUT', { ...entry, status: 'confirmed' })
      announce(t('saved'))
      await refreshAfterMeal()
    },
    'replace-current': () => openEditor(state.target, entry, [{ name: '' }]),
    'skip-current': async () => {
      await api('plan', 'DELETE', { date: entry.date, meal: entry.meal })
      await refreshAfterMeal()
    },
    'edit-current': () => openEditor(state.target, entry),
    'confirm-dish': () => {
      const existing = entry?.dishes ?? []
      const dishes = existing.some(item => item.id === id || item.name === chosen[0].name) ? existing : [...existing, ...chosen]
      openEditor(state.target, entry, dishes.slice(0, 12))
    },
    'plan-dish': async () => {
      await api('meal', 'PUT', { ...state.target, status: 'planned', dishes: chosen })
      announce(t('saved'))
      location.hash = 'today'
    },
    'edit-meal': () => openEditor({ date, meal }, state.journal?.entries.find(row => row.date === date && row.meal === meal)),
    older: () => loadJournal(true),
    'journal-retry': () => loadJournal(),
    'add-dish': () => {
      readEditor()
      if (state.form.dishes.length >= 12) return
      state.form.dishes.push({ name: '' })
      editorForm()
      ;[...dialog.querySelectorAll('[name="dish"]')].at(-1)?.focus()
    },
    'remove-dish': () => {
      readEditor()
      state.form.dishes.splice(Number(index), 1)
      editorForm()
    },
    'delete-meal': async () => {
      if (!window.confirm(t('deleteConfirm'))) return
      const { date, meal } = state.form.existing
      await api('meal', 'DELETE', { date, meal })
      dialog.close()
      await refreshAfterMeal()
    },
    photo: () => {
      state.form = null
      photoDialog()
    },
    'photo-editor': () => {
      readEditor()
      photoDialog()
    },
    'demo-photo': () => finishPhoto(dialog.querySelector('#photo-form')),
    close: () => dialog.close(),
    push: togglePush,
    logout: async () => {
      await api('logout', 'POST')
      const url = new URL(location.pathname, location.origin)
      if (realMode) url.searchParams.set('mode', realModeName)
      location.replace(url.href)
    },
  }
  if (actions[action]) await actions[action]()
}

document.addEventListener('click', async event => {
  const element = event.target.closest('button[data-action]')
  if (!element || element.disabled) return
  element.disabled = true
  try {
    await action(element)
  } catch (error) {
    errorMessage(error)
  } finally {
    element.disabled = false
  }
})

document.addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.target
  const values = new FormData(form)
  const submitter = event.submitter
  if (submitter) submitter.disabled = true
  try {
    if (form.id === 'area-form') {
      await savePreferences({ zone: String(values.get('zone')).trim() })
      dialog.close()
      state.exclude = []
      state.outing = null
      state.outingInput = null
      if (route().screen === 'today') await daily()
      else render()
    } else if (form.id === 'meal-form') {
      await submitMeal()
    } else if (form.id === 'photo-form') {
      if (state.session.demo) await finishPhoto(form)
      else {
        if (submitter) submitter.textContent = t('processing')
        const files = [values.get('photo'), values.get('second')].filter(file => file?.size)
        await finishPhoto(form, await Promise.all(files.map(resizedImage)))
      }
    } else if (form.id === 'outing-form') {
      const party = Number(values.get('party'))
      const budget = Number(values.get('budget'))
      const zone = String(values.get('zone')).trim()
      const wish = String(values.get('wish')).trim()
      state.outingInput = { party, budget, zone, wish }
      state.loading = 'outing'
      render()
      try {
        state.outing = await api('outing', 'POST', { ...state.outingInput, coordinates: state.coordinates })
      } catch (error) {
        state.outing = { error: error.message }
      } finally {
        if (state.loading === 'outing') state.loading = ''
        if (route().screen === 'outing') render()
      }
    } else if (form.id === 'times-form') {
      await savePreferences({ times: Object.fromEntries(values) })
      announce(t('saved'))
    }
  } catch (error) {
    errorMessage(error)
  } finally {
    if (submitter) {
      submitter.disabled = false
      if (form.id === 'photo-form' && !state.session.demo) submitter.textContent = t('analyze')
    }
  }
})

const lookupTimers = new WeakMap()
dialog.addEventListener('input', event => {
  const input = event.target
  if (input.name !== 'dish') return
  clearTimeout(lookupTimers.get(input))
  const query = input.value.trim()
  if (!query) return input.list?.replaceChildren()
  lookupTimers.set(input, setTimeout(async () => {
    try {
      const matches = await api('dishes?q=' + encodeURIComponent(query))
      if (!input.isConnected || input.value.trim() !== query) return
      input.list?.replaceChildren(...matches.map(dish => new Option('', dish.name)))
    } catch {
      // Free-text journal entry remains available.
    }
  }, 220))
})
function sizeDialog() {
  const viewport = window.visualViewport
  if (!dialog.open || !viewport) return
  const keyboardVisible = document.documentElement.clientHeight - viewport.height > 100
  dialog.classList.toggle('keyboard-open', keyboardVisible)
  dialog.style.setProperty('--visible-dialog-height', Math.max(120, viewport.height - 24) + 'px')
  dialog.style.setProperty('--visible-dialog-top', (viewport.offsetTop + 12) + 'px')
}

window.visualViewport?.addEventListener('resize', sizeDialog)
window.visualViewport?.addEventListener('scroll', sizeDialog)
dialog.addEventListener('close', () => { state.form = null })
document.querySelector('#skip').addEventListener('click', event => {
  event.preventDefault()
  main.focus()
  main.scrollIntoView()
})
window.addEventListener('hashchange', () => {
  if (!signedIn()) return
  if (dialog.open) dialog.close()
  window.scrollTo(0, 0)
  render()
  main.focus({ preventScroll: true })
  const { screen, id } = route()
  if (screen === 'today' || (['dish', 'addresses'].includes(screen)
    && (realMode || !state.daily?.suggestions?.some(item => item.id === id)))) void daily()
  if (screen === 'journal') void loadJournal()
  if (screen === 'account') void loadHabits()
})

async function initialize() {
  if (pilotMode) document.querySelector('link[rel="manifest"]').href = './manifest-pilot.webmanifest'
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', document.baseURI)).catch(() => {})
  let callback
  try {
    if (realMode) {
      const { createRealApi, googleReturn } = await import('./supabase.mjs')
      callback = googleReturn(location.href)
      realClient = createRealApi(realConfig, new URL(location.pathname, location.origin))
    }
    state.session = await api('session')
    if (callback) {
      history.replaceState(history.state, '', callback.href)
      if (!state.session.account && !state.session.authenticationError) {
        state.session.authenticationError = callback.hasCode ? 'authRestart' : pilotMode ? 'pilotGoogleFailed' : 'authFailed'
      }
    }
    if (state.session.preview && !state.session.account) {
      await api('preview', 'POST')
      state.session = await api('session')
    }
    if (signedIn()) {
      state.preferences = state.session.account.preferences
      state.locale = state.session.preview
        ? localStorage.getItem(locationPreference) || state.preferences.locale : state.preferences.locale
      localStorage.setItem(locationPreference, state.locale)
      const date = search.get('date')
      const meal = search.get('meal')
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Number.isFinite(Date.parse(date))
        && new Date(date).toISOString().startsWith(date)
      state.notificationTarget = validDate && slots.includes(meal)
      state.target = state.notificationTarget ? { date, meal } : state.session.upcoming
      state.checkedAt = Date.now()
    }
    render()
    realClient?.watch(id => {
      if (id !== (state.session.account?.id ?? null)) location.reload()
    })
    if (signedIn()) {
      if (['today', 'dish', 'addresses'].includes(route().screen)) void daily()
      if (route().screen === 'journal') void loadJournal()
      if (route().screen === 'account') void loadHabits()
      if (!state.session.demo && !state.preferences.zone && state.session.catalog === 'ready'
        && state.session.zones.length) void geolocate()
    }
  } catch (error) {
    if (callback) history.replaceState(history.state, '', callback.href)
    const retry = esc(location.pathname + (realMode ? '?mode=' + realModeName : ''))
    main.innerHTML = empty('bowl', t(error.message), '')
      + '<a class="button secondary" href="' + retry + '">' + t('retry') + '</a>'
  }
}

async function syncVisibleApp() {
  if (document.hidden || !signedIn() || Date.now() - state.checkedAt < (realMode ? 8000 : 60_000)) return
  state.checkedAt = Date.now()
  try {
    const fresh = await api('session')
    if (!fresh.account) {
      location.reload()
      return
    }
    if (realMode && fresh.account.id !== state.session.account.id) {
      location.reload()
      return
    }
    const changedDay = fresh.today !== state.session.today
    state.session = fresh
    const changedMeal = !state.notificationTarget
      && (fresh.upcoming.date !== state.target.date || fresh.upcoming.meal !== state.target.meal)
    if (changedMeal) {
      state.target = fresh.upcoming
      state.exclude = []
      state.daily = null
    }
    if ((changedMeal || (realMode && state.loading !== 'today')) && route().screen === 'today' && !dialog.open) await daily()
    if ((changedDay || realMode) && route().screen === 'journal' && !dialog.open) await loadJournal()
    if (realMode && route().screen === 'account' && !dialog.open) {
      state.preferences = fresh.account.preferences
      state.locale = state.preferences.locale
      render()
      await loadHabits()
    }
  } catch {
    // Preserve the current screen while the connection recovers.
  }
}

document.addEventListener('visibilitychange', syncVisibleApp)
window.addEventListener('focus', syncVisibleApp)
if (realMode) setInterval(() => {
  if (!signedIn() || state.notificationTarget || document.hidden || dialog.open || route().screen !== 'today') return
  const upcoming = nextMeal()
  if (upcoming.date !== state.target.date || upcoming.meal !== state.target.meal) void syncVisibleApp()
}, 60_000)

void initialize()
