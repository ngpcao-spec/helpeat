import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('./public/', import.meta.url))
const outDir = fileURLToPath(new URL('./dist/', import.meta.url))
const pwaAssets = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']

export default defineConfig({
  root,
  publicDir: false,
  envDir: false,
  base: '/helpeat/',
  define: { __HELPEAT_STATIC_DEMO__: true },
  build: { outDir, emptyOutDir: true, assetsInlineLimit: 0 },
  plugins: [{
    name: 'helpeat-pwa',
    apply: 'build',
    async closeBundle() {
      await Promise.all(pwaAssets.map(file => copyFile(resolve(root, file), resolve(outDir, file))))
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
