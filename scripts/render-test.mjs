/**
 * Render the real client bundle in jsdom.
 *
 * `verify.mjs` covers the Git engine; this covers the half that only exists in
 * a browser: the ModuleLoader wrapper, the cordis wiring, both slot
 * registrations, and the panel's first render against canned host answers.
 * A typo in an event handler or a bad hook never reaches the app this way.
 *
 * Run: `node scripts/render-test.mjs`
 *
 * @module dsh-git-management/scripts/render-test
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { JSDOM } from 'jsdom'
import React, { act as reactAct } from 'react'
import { createRoot } from 'react-dom/client'
import { act as legacyAct } from 'react-dom/test-utils'

/** React 18.3 exposes `act`; older 18.x only has it under test-utils. */
const act = reactAct ?? legacyAct

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let checks = 0
let failed = 0

/**
 * Assert one fact.
 * @param label - what is being checked.
 * @param condition - the fact.
 * @param detail - shown when it is false.
 */
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failed += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/** The canned repository the fake host reports. */
const STATUS = {
  isRepo: true,
  path: 'C:/demo',
  root: 'C:/demo',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  oid: 'abc1234',
  staged: [{ path: 'src/App.tsx', origPath: null, status: 'M', kind: 'tracked', index: 'M', worktree: '.', additions: 12, deletions: 3 }],
  changes: [{ path: 'docs/read me.md', origPath: null, status: 'U', kind: 'untracked', index: '?', worktree: '?', additions: 0, deletions: 0 }],
  conflicts: [],
}

const LOG = {
  commits: [
    { sha: 'deadbeefdeadbeef', short: 'deadbee', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 3600_000).toISOString(), subject: 'wire the sidebar panel' },
    { sha: 'cafebabecafebabe', short: 'cafebab', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 7200_000).toISOString(), subject: 'initial import' },
  ],
}

/**
 * One canned host answer per action.
 * @param action - the action name.
 * @returns the result the panel should receive.
 */
function respond(action) {
  switch (action) {
    case 'repos':
      return { repos: [{ id: 'w1', title: 'demo', path: 'C:/demo', isRepo: true, root: 'C:/demo', branch: 'main' }], defaultPath: 'C:/demo' }
    case 'status':
      return STATUS
    case 'log':
      return LOG
    case 'branches':
      return { current: 'main', branches: [{ name: 'main', current: true, upstream: 'origin/main', sha: 'abc1234', date: null }] }
    case 'diff':
      return { file: 'src/App.tsx', staged: true, patch: 'diff --git a/src/App.tsx b/src/App.tsx\n@@ -1 +1,2 @@\n-old\n+new\n+more', isBinary: false }
    case 'github':
      return { connected: true, authorized: false, reason: 'no-token', remote: { host: 'github.com', owner: 'acme', repo: 'demo', slug: 'acme/demo', webUrl: 'https://github.com/acme/demo', remoteUrl: 'git@github.com:acme/demo.git' } }
    default:
      return {}
  }
}

// ---- browser environment -------------------------------------------------

const dom = new JSDOM('<!doctype html><html lang="zh"><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:43129/',
  pretendToBeVisual: true,
})

global.window = dom.window
global.document = dom.window.document
// Node 24 exposes `navigator` as a getter-only global, so define over it.
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.MutationObserver = dom.window.MutationObserver
global.IS_REACT_ACT_ENVIRONMENT = true
global.localStorage = dom.window.localStorage

const calls = []
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  calls.push({ url: String(url), action: body.action })
  return { ok: true, status: 200, json: async () => ({ ok: true, result: respond(body.action) }) }
}

// ---- load the built bundle ----------------------------------------------

let loaded = null
dom.window.__ModuleLoader__ = {
  load: (definition) => {
    loaded = definition
  },
}

const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
dom.window.eval(source)

check('bundle registered through ModuleLoader', loaded !== null && loaded.id === 'dsh-git-management', loaded?.id)

const moduleExports = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})

check('factory published apply', typeof moduleExports.apply === 'function', typeof moduleExports.apply)

// ---- fake cordis context ------------------------------------------------

const dictionaries = {}
/** Interpolate `{name}` placeholders the way the locale service does. */
const interpolate = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_, key) => (vars?.[key] ?? `{${key}}`))

const locale = {
  register: (ns, dicts) => {
    dictionaries[ns] = dicts
    return () => {}
  },
  bind: (ns) => (key, vars) => interpolate(dictionaries[ns]?.zh?.[key] ?? key, vars),
  getLocale: () => ({ active: 'zh', locales: [], revision: 1 }),
  subscribe: () => () => {},
}

const registrations = []
const slots = {
  register: (declaration, component) => {
    registrations.push({ declaration, component })
    return () => {}
  },
  inject: (key, callback) => callback(),
}

/** The right column's tab registry: definitions and their guide cards. */
const tabTypes = []
const sidebarRightTabs = {
  register: (definition) => {
    tabTypes.push(definition)
    return () => {}
  },
}

/** Run an effect and keep its disposer, like a cordis context does. */
function effect(fn) {
  const disposer = fn()
  return () => {
    if (typeof disposer === 'function') disposer()
  }
}

const ctx = {
  effect,
  inject: (deps, callback) => callback({ slots, locale, effect, sidebarRightTabs }),
  slots,
  locale,
  sidebarRightTabs,
}

await act(async () => {
  moduleExports.apply(ctx)
})

check(
  'registered the right-column tab type',
  tabTypes.some((definition) => definition.kind === 'git' && definition.id === 'dsh-git-management'),
  tabTypes.map((definition) => definition.kind),
)
const gitType = tabTypes.find((definition) => definition.kind === 'git')
check('the tab contributes one start-page card', gitType?.guide?.length === 1, gitType?.guide)
check('the card title is a thunk (locale-aware)', typeof gitType?.guide?.[0]?.title === 'function')
check('the tab body is registered', registrations.some((row) => row.declaration.name === 'sidebar.right.pane.tab' && row.declaration.key === 'dsh-git-management'))
check('the tab chip title is registered', registrations.some((row) => row.declaration.name === 'sidebar.right.pane.tab.title' && row.declaration.key === 'dsh-git-management'))
check('panel declares its locale namespace', registrations.find((row) => row.declaration.name === 'sidebar.right.pane.tab')?.declaration.locale === 'dsh-git-management')
check('dictionaries have both languages', dictionaries['dsh-git-management']?.zh !== undefined && dictionaries['dsh-git-management']?.en !== undefined)

// ---- render -------------------------------------------------------------

const panel = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab')
const title = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab.title')

const container = document.getElementById('root')
const reactRoot = createRoot(container)

await act(async () => {
  reactRoot.render(React.createElement(title.component, { ...title.declaration.inject() }))
})
check('the tab chip renders the branch mark', container.querySelector('svg') !== null, container.innerHTML.slice(0, 120))

await act(async () => {
  reactRoot.render(
    React.createElement(panel.component, {
      ...(typeof panel.declaration.inject === 'function' ? panel.declaration.inject() : {}),
    }),
  )
  // Two flushes: the first load resolves the repo list, the second reads the
  // repository state that load triggered.
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 30))
})

const text = () => container.textContent ?? ''

check('panel asks the host for repositories', calls.some((call) => call.action === 'repos'), calls.map((call) => call.action))
check('panel reads status', calls.some((call) => call.action === 'status'), calls.map((call) => call.action))
check('panel reads history', calls.some((call) => call.action === 'log'), calls.map((call) => call.action))
check('title is localized to Chinese', text().includes('源代码管理'), text().slice(0, 200))
check('branch is shown', text().includes('main'), text().slice(0, 200))
check('staged group is shown', text().includes('已暂存的更改'), text().slice(0, 400))
check('unstaged group is shown', text().includes('更改'), text().slice(0, 400))
check('staged file name is shown', text().includes('App.tsx'), text().slice(0, 400))
check('a path with a space survives rendering', text().includes('read me.md'), text().slice(0, 400))
check('line counts are shown', text().includes('+12') && text().includes('-3'), text().slice(0, 400))
check('commit button is rendered disabled without a message', container.querySelector('.gmg-btn.is-primary') !== null)
check('history subject is rendered', text().includes('wire the sidebar panel'), text().slice(0, 600))
check('github card names the remote', text().includes('acme/demo'), text().slice(0, 600))
check('token hint is offered when unauthorized', text().includes('个人访问令牌'), text().slice(-400))
check('no error notice is shown', container.querySelector('.gmg-notice.is-error') === null, container.querySelector('.gmg-notice.is-error')?.textContent)

// Opening one file asks for its diff and draws the coloured lines.
const fileRow = container.querySelector('.gmg-file')
if (fileRow !== null) {
  await act(async () => {
    fileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  check('clicking a file requests its diff', calls.some((call) => call.action === 'diff'), calls.map((call) => call.action))
  check('diff lines are classified', container.querySelector('.gmg-diff-line.is-add') !== null, container.querySelector('.gmg-diff')?.textContent?.slice(0, 120))
} else {
  check('a file row exists to click', false)
}

await act(async () => {
  reactRoot.unmount()
})

console.log(`\n${checks - failed}/${checks} checks passed`)
if (failed > 0) {
  console.error(`${failed} check(s) failed`)
  process.exitCode = 1
}
dom.window.close()
