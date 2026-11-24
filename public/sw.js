const scope = new URL(self.registration.scope)
const cachePrefix = 'helpeat-shell:' + scope.pathname + ':'
const release = 'source'
const assetFiles = ['styles.css', 'app.mjs', 'copy.mjs', 'icons.mjs', 'catalog.mjs', 'time.mjs', 'demo.mjs',
  'hero.webp', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']
const cacheName = cachePrefix + release
const shell = new Set([scope.href, ...assetFiles.map(file => new URL(file, scope).href)])

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([...shell])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  const navigation = event.request.mode === 'navigate' && url.pathname === scope.pathname
  if (!navigation && !shell.has(url.href)) return
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(cacheName)
    return (await cache.match(navigation ? scope.href : url.href)) ?? Response.error()
  }))
})
self.addEventListener('push', event => {
  try {
    const data = event.data?.json()
    if (!data?.body || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
      || !['breakfast', 'lunch', 'dinner'].includes(data.meal)) return
    event.waitUntil(self.registration.showNotification('Helpeat', {
      body: data.body, icon: new URL('icon-192.png', scope).href, badge: new URL('icon-192.png', scope).href,
      tag: data.date + '-' + data.meal, data: '?date=' + data.date + '&meal=' + data.meal + '#today',
    }))
  } catch {
    // Ignore malformed notification payloads.
  }
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const url = new URL(event.notification.data, scope)
    if (url.origin !== self.location.origin) return
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.length) {
      const client = await windows[0].navigate(url.href)
      if (client) return client.focus()
    }
    return self.clients.openWindow(url.href)
  })())
})
