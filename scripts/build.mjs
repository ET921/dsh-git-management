/**
 * Build `lib/` from `src/`.
 *
 * No bundler, on purpose. The two halves have two different, very simple
 * contracts and Node can satisfy both:
 *
 *   lib/index.js      the node half, already plain ESM — copied verbatim,
 *                     together with the two modules it imports.
 *   lib/client.js     the browser half, wrapped in the shell's ModuleLoader
 *                     registration so that executing the file only *registers*
 *                     the factory; materialization happens when the module
 *                     system first imports the entry.
 *
 * The browser half is authored as several small files under `src/client/`
 * (utility, store, icons, styles, panel, plugin wiring) that share one factory
 * scope. Concatenating them in filename order is what a bundler would do for
 * this dependency-free code, minus the dependency.
 *
 * @module dsh-git-management/scripts/build
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'lib')

/** The id the shell's module table registers, and the boot graph addresses this bundle by. */
const PLUGIN_ID = 'dsh-git-management'

/** Host-half modules copied alongside the entry (the entry imports them by relative path). */
const HOST_MODULES = ['index.js', 'actions.js', 'git.js']

/**
 * Mirrors the head of every shipped `@deepseek-ai/*` client bundle: introduce a
 * CommonJS facade inside the factory so the body can publish `exports`.
 */
const banner = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

`

const footer = `
    return module.exports;
  }
});
`

/** Indent a factory body one level so the emitted artifact reads as one unit. */
function indent(body) {
  return body
    .split('\n')
    .map((line) => (line === '' ? line : `    ${line}`))
    .join('\n')
}

mkdirSync(outdir, { recursive: true })

for (const file of HOST_MODULES) {
  writeFileSync(join(outdir, file), readFileSync(join(root, 'src', file), 'utf8'), 'utf8')
}

const clientDir = join(root, 'src', 'client')
const clientFiles = readdirSync(clientDir)
  .filter((file) => file.endsWith('.js'))
  .sort()

if (clientFiles.length === 0) throw new Error('src/client has no .js sources')

const sections = clientFiles.map((file) => {
  const source = readFileSync(join(clientDir, file), 'utf8')
  if (/^\s*(import|export)\s/m.test(source)) {
    throw new Error(`${file} uses ESM syntax; the browser half is one CommonJS factory body`)
  }
  return `// ---- ${file} ----\n${source.trimEnd()}\n`
})

const body = `${banner}${indent(sections.join('\n'))}${footer}`

// Fail the build, not the page: a syntax error here would surface as a blank
// panel with no hint about which source file caused it.
try {
  // eslint-disable-next-line no-new-func
  new Function('window', body)
} catch (error) {
  throw new Error(`client bundle does not parse: ${error.message}`)
}

writeFileSync(join(outdir, 'client.js'), body, 'utf8')

console.log(`build done → lib/${HOST_MODULES.join(', lib/')}, lib/client.js (id ${PLUGIN_ID})`)
console.log(`client sources: ${clientFiles.join(', ')}`)
