import { sendNotification } from 'web-push'
import { slots, vietnamTime } from '../public/time.mjs'

const names = {
  vi: { breakfast: 'bữa sáng', lunch: 'bữa trưa', dinner: 'bữa tối' },
  fr: { breakfast: 'petit-déjeuner', lunch: 'déjeuner', dinner: 'dîner' },
}

export function pushSubscription(value) {
  if (typeof value?.endpoint !== 'string' || value.endpoint.length > 1500) return null
  const allowedDomains = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com',
    'notify.windows.com', 'push.apple.com']
  try {
    const url = new URL(value.endpoint)
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null
  } catch {
    return null
  }
  const { p256dh, auth } = value.keys ?? {}
  if (!/^[\w-]{87}=?$/.test(p256dh ?? '') || !/^[\w-]{22}={0,2}$/.test(auth ?? '')) return null
  return { endpoint: value.endpoint, keys: { p256dh, auth } }
}

export function configurePush(store, env, origin) {
  const { WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey, WEB_PUSH_SUBJECT: subject } = env
  if (!publicKey || !privateKey || !subject || !origin.startsWith('https://')) return null
  const vapidDetails = { subject, publicKey, privateKey }
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  let running = false
  async function tick() {
    if (running) return
    running = true
    try {
      const now = new Date()
      const { date, time } = vietnamTime(now)
      store.prunePush(vietnamTime(new Date(+now - 7 * 86_400_000)).date)
      for (const row of store.preferencesForPush()) {
        const lang = row.preferences.locale
        for (const meal of slots) {
          const late = minutes(time) - minutes(row.preferences.times[meal])
          if (late < 0 || late > 10 || store.meal(row.account, date, meal)?.status === 'confirmed'
            || !store.claimPush(row.endpoint, date, meal, +now)) continue
          const name = names[lang][meal]
          const body = lang === 'fr' ? `Découvrir les suggestions pour le ${name}.` : `Xem gợi ý cho ${name} của bạn.`
          try {
            await sendNotification(row.subscription, JSON.stringify({
              body, date, meal, url: `/?date=${date}&meal=${meal}#today`,
            }), { vapidDetails, TTL: 600, timeout: 5000 })
            store.markPush(row.endpoint, date, meal)
          } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) store.unsubscribe(row.account, row.endpoint)
          }
        }
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick().catch(() => console.error('Push scheduler failed')), 25_000)
  timer.unref()
  return { publicKey, stop: () => clearInterval(timer) }
}
