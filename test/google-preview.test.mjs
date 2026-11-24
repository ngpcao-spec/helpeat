import assert from 'node:assert/strict'
import test from 'node:test'
import { googleTestPreview } from '../supabase/auth-rollout/google-test-preview.mjs'

const env = {
  HELPEAT_GOOGLE_TEST: 'true',
  HELPEAT_GOOGLE_TEST_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  HELPEAT_GOOGLE_TEST_ORIGIN: 'https://helpeat-test.example.test',
  HELPEAT_GOOGLE_TEST_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  HELPEAT_GOOGLE_TEST_PASSWORD: 'fixture-only-password-for-test',
}

test('the protected preview is explicit and rejects production and privileged keys', () => {
  assert.equal(googleTestPreview({}), null)
  assert.throws(() => googleTestPreview({
    ...env, HELPEAT_GOOGLE_TEST_SUPABASE_URL: 'https://ihuztjkblywzjdruusdj.supabase.co',
  }), /distinct/)
  assert.throws(() => googleTestPreview({ ...env, HELPEAT_GOOGLE_TEST_PUBLISHABLE_KEY: 'sb_secret_fixture' }), /publishable/)
  assert.throws(() => googleTestPreview({ ...env, HELPEAT_GOOGLE_TEST_ORIGIN: 'https://ngpcao-spec.github.io' }), /separate/)
  assert.throws(() => googleTestPreview({ ...env, HELPEAT_GOOGLE_TEST_PASSWORD: 'short' }), /password/)
  assert.throws(() => googleTestPreview({ ...env, VITE_HELPEAT_ENABLE_REAL: 'true' }), /isolated/)
})

test('the preview challenges unauthorized requests and keeps the password out of its browser configuration', () => {
  const preview = googleTestPreview(env)
  assert.equal(preview.listen.host, '127.0.0.1')
  assert.equal(preview.client.origin, env.HELPEAT_GOOGLE_TEST_ORIGIN)
  assert.ok(!JSON.stringify(preview.client).includes(env.HELPEAT_GOOGLE_TEST_PASSWORD))
  let middleware
  const middlewares = { use(fn) { middleware = fn; return this } }
  assert.equal(preview.plugin.configurePreviewServer({ middlewares }), undefined)
  const request = authorization => {
    const headers = {}
    let status
    let next = false
    middleware({ headers: { authorization } }, {
      setHeader(name, value) { headers[name] = value },
      writeHead(code, values) { status = code; Object.assign(headers, values) },
      end() {},
    }, () => { next = true })
    return { status, headers, next }
  }
  assert.equal(request('').status, 401)
  assert.match(request('Basic invalid').headers['WWW-Authenticate'], /HELPEAT validation/)
  assert.ok(request('Basic ' + Buffer.from('helpeat:' + env.HELPEAT_GOOGLE_TEST_PASSWORD).toString('base64')).next)
})
