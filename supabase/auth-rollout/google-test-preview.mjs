import { createHash, timingSafeEqual } from 'node:crypto'

const production = 'https://ihuztjkblywzjdruusdj.supabase.co'
const publicSite = 'https://ngpcao-spec.github.io'
const digest = value => createHash('sha256').update(value).digest()

function httpsOrigin(value, label) {
  let url
  try { url = new URL(value) } catch { throw new Error(label + ' must be an HTTPS origin') }
  if (url.protocol !== 'https:' || url.username || url.password || url.href !== url.origin + '/') {
    throw new Error(label + ' must be an HTTPS origin')
  }
  return url
}

export function googleTestPreview(env) {
  if (env.HELPEAT_GOOGLE_TEST !== 'true') return null
  if (env.VITE_HELPEAT_ENABLE_REAL === 'true') throw new Error('Choose the isolated preview or the production build')
  const url = httpsOrigin(env.HELPEAT_GOOGLE_TEST_SUPABASE_URL, 'Isolated Supabase')
  const origin = httpsOrigin(env.HELPEAT_GOOGLE_TEST_ORIGIN, 'Private preview')
  const key = env.HELPEAT_GOOGLE_TEST_PUBLISHABLE_KEY
  const password = env.HELPEAT_GOOGLE_TEST_PASSWORD
  if (!/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.port || url.origin === production) {
    throw new Error('Use a hosted isolated Supabase project or branch, distinct from HOME Reviews production')
  }
  if (origin.origin === publicSite || origin.origin === url.origin) {
    throw new Error('Use a separate private HTTPS frontend origin')
  }
  if (!/^sb_publishable_[\w-]+$/.test(key ?? '')) throw new Error('Use the isolated Supabase publishable key')
  if (!password || password.length < 20) throw new Error('Set a private preview password of at least 20 characters')

  const expectedHeader = digest('Basic ' + Buffer.from('helpeat:' + password).toString('base64'))
  const protect = server => {
    server.middlewares.use((request, response, next) => {
      response.setHeader('Cache-Control', 'private, no-store')
      response.setHeader('X-Robots-Tag', 'noindex, nofollow')
      if (timingSafeEqual(digest(request.headers.authorization ?? ''), expectedHeader)) return next()
      response.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="HELPEAT validation"',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end('Aperçu privé HELPEAT')
    })
  }
  return {
    client: { origin: origin.origin, url: url.origin, key },
    listen: { host: '127.0.0.1', port: 4183, strictPort: true, allowedHosts: [origin.hostname] },
    plugin: { name: 'helpeat-private-google-test', configureServer: protect, configurePreviewServer: protect },
  }
}
