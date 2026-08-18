// Cross-platform package-entry / manifest validator (no child-process capture,
// so it works under the Windows ACL sandbox where spawn EPERM applies).
// Used by `npm run check`, `npm run build`, and `npm run prepack`.
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredFiles = [
  'index.js',
  'index.d.ts',
  'src/index.js',
  'src/trigger-core.mjs',
  'src/skill-utils.mjs',
  'src/call-analysis.mjs',
  'cordis.patch.yml',
]

let failed = false
for (const file of requiredFiles) {
  try {
    await access(join(root, file))
  } catch {
    console.error(`[check] missing required file: ${file}`)
    failed = true
  }
}

// Verify the runtime entry actually exports the Cordis plugin shape.
try {
  const entryUrl = pathToFileURL(join(root, 'index.js')).href
  const mod = await import(entryUrl)
  if (typeof mod.apply !== 'function' || typeof mod.name !== 'string' || !Array.isArray(mod.inject)) {
    throw new Error(`bad plugin entry shape: ${Object.keys(mod).join(',')}`)
  }
  console.log(`[check] entry ok: ${mod.name} inject=[${mod.inject.join(', ')}]`)
} catch (error) {
  console.error(`[check] entry import failed: ${error?.message ?? error}`)
  failed = true
}

// Verify package.json parses and carries the DSH bundle field.
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'dsh-jspace-trigger' || !pkg.dsh?.bundle?.patch) {
    throw new Error('package.json missing dsh.bundle.patch')
  }
  console.log(`[check] package.json ok: ${pkg.name}@${pkg.version} patch=${pkg.dsh.bundle.patch}`)
} catch (error) {
  console.error(`[check] package.json invalid: ${error?.message ?? error}`)
  failed = true
}

if (failed) process.exit(1)
console.log('[check] all checks passed')
