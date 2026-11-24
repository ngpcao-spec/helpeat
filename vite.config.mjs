import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { googleTestPreview } from './supabase/auth-rollout/google-test-preview.mjs'

const root = fileURLToPath(new URL('./public/', import.meta.url))
const outDir = fileURLToPath(new URL('./dist/', import.meta.url))
const pwaAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']
const realKey = process.env.VITE_HELPEAT_SUPABASE_PUBLISHABLE_KEY
const realEnabled = process.env.VITE_HELPEAT_ENABLE_REAL === 'true'
const googleTest = googleTestPreview(process.env)
if (realEnabled && !/^sb_publishable_[\w-]+$/.test(realKey ?? '')) {
  throw new Error('A Supabase publishable key is required for an approved real-mode build')
}

export default defineConfig({
  root,
  publicDir: false,
  envDir: false,
  base: '/helpeat/',
  server: googleTest?.listen,
  preview: googleTest?.listen,
  define: {
    __HELPEAT_STATIC_DEMO__: true,
    __HELPEAT_REAL_CONFIG__: JSON.stringify(googleTest?.client ?? (realEnabled ? {
      url: 'https://ihuztjkblywzjdruusdj.supabase.co', key: realKey,
    } : null)),
  },
  build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 },
  plugins: [googleTest?.plugin, {
    name: 'helpeat-pwa',
    apply: 'build',
    async closeBundle() {
      await Promise.all(pwaAssets.map(file => copyFile(resolve(root, file), resolve(outDir, file))))
      if (googleTest) {
        const file = resolve(outDir, 'manifest.webmanifest')
        const manifest = JSON.parse(await readFile(file, 'utf8'))
        manifest.name = 'HELPEAT · Validation'
        manifest.short_name = 'HELPEAT Test'
        manifest.start_url = './?mode=real#today'
        await writeFile(file, JSON.stringify(manifest, null, 2))
      }
      const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name !== 'sw.js')
        .map(entry => relative(outDir, resolve(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort()
      const template = await readFile(resolve(root, 'sw.js'), 'utf8')
      const digest = createHash('sha256').update(template)
      for (const file of files) digest.update(await readFile(resolve(outDir, file)))
      const worker = template.replace("const release = 'source'", "const release = '" + digest.digest('hex').slice(0, 16) + "'")
        .replace(/const assetFiles = \[[\s\S]*?\]\n/, 'const assetFiles = ' + JSON.stringify(files) + '\n')
      await writeFile(resolve(outDir, 'sw.js'), worker)
    },
  }],
})
