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
import * as reactDom from 'react-dom'
import { act as legacyAct, Simulate } from 'react-dom/test-utils'

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
  operation: null,
}

/** What the host answers for `status`; a test swaps this to stage a conflict. */
let statusPayload = STATUS

/** What `pull` answers: a merge that stops on conflicts is a normal 200. */
let pullResult = null

/** Runs after a `commit` reaches the host, so a test can move the state on. */
let commitSideEffect = null

/** A branch nobody has pushed yet: `fetch` must still be pressable (G12). */
const NO_UPSTREAM = { ...STATUS, upstream: null, ahead: 0, behind: 0 }

/** A bare repository: a repo, but with no worktree and nothing to stage (S8). */
const BARE = { ...STATUS, bare: true, staged: [], changes: [], conflicts: [], upstream: null, ahead: 0, behind: 0 }

/** The narrow stash surface's host state (S11). */
const stashHost = { count: 1, popConflicts: false }

/** One-shot host failures by action: `{ status, body }`, an envelope (S13). */
const failures = new Map()

/** The GitHub card answers unauthorized while the token round-trip runs (S24). */
let githubAuthorized = true

/** Actions whose fake answer waits this many ms — the in-flight lock cases. */
const delayedActions = new Map()

/** The conflicted state: one file in both sides, so the panel must offer a way out. */
const CONFLICTED = {
  ...STATUS,
  conflicts: [{ path: 'src/clash.ts', origPath: null, status: 'UU', kind: 'tracked', index: 'U', worktree: 'U', additions: 0, deletions: 0 }],
}

/**
 * The canned history: a two-lane shape, so the rail has a merge to draw.
 *
 *   deadbeef ─ merge1 ─ main1 ─┐
 *                  └── side1 ──┴─ base
 */
const LOG = {
  commits: [
    { sha: 'deadbeefdeadbeef', short: 'deadbee', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 3600_000).toISOString(), subject: 'wire the sidebar panel', parents: ['aaaaaaaaaaaaaaaa'], refs: ['HEAD -> main', 'origin/main'] },
    { sha: 'aaaaaaaaaaaaaaaa', short: 'aaaaaaa', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 4000_000).toISOString(), subject: 'merge the sidebar work', parents: ['bbbbbbbbbbbbbbbb', 'cccccccccccccccc'], refs: [] },
    { sha: 'bbbbbbbbbbbbbbbb', short: 'bbbbbbb', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 5000_000).toISOString(), subject: 'main line change', parents: ['dddddddddddddddd'], refs: ['origin/release'] },
    { sha: 'cccccccccccccccc', short: 'ccccccc', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 6000_000).toISOString(), subject: 'side branch change', parents: ['dddddddddddddddd'], refs: ['dev', 'origin/dev'] },
    { sha: 'dddddddddddddddd', short: 'ddddddd', author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 7200_000).toISOString(), subject: 'initial import', parents: [], refs: [] },
  ],
}

/**
 * One canned host answer per action.
 * @param action - the action name.
 * @returns the result the panel should receive.
 */
function respond(action, params) {
  switch (action) {
    case 'repos':
      return {
        repos: [
          { id: 'w1', title: 'demo', path: 'C:/demo', isRepo: true, root: 'C:/demo', branch: 'main' },
          { id: 'w2', title: 'other', path: 'C:/other', isRepo: true, root: 'C:/other', branch: 'dev' },
        ],
        defaultPath: 'C:/demo',
      }
    case 'status':
      return statusPayload
    case 'log':
      return LOG
    case 'branches':
      return {
        current: 'main',
        defaultRemote: 'origin/dev',
        remotes: ['origin'],
        branches: [
          { name: 'main', current: true, upstream: 'origin/main', sha: 'abc1234', date: null },
          { name: 'dev', current: false, upstream: null, sha: 'def5678', date: null },
        ],
      }
    case 'diff':
      // A conflicted file comes back as git's combined format, which the parser
      // refuses to model; the panel must say so instead of drawing nonsense.
      if (params?.file === 'src/clash.ts') {
        return { file: 'src/clash.ts', staged: false, isBinary: false, patch: ['diff --cc src/clash.ts', 'index 1111111,2222222..0000000', '--- a/src/clash.ts', '+++ b/src/clash.ts', '@@@ -1,1 -1,1 +1,5 @@@', '++<<<<<<< HEAD', ' +ours', '++=======', '+ theirs', '++>>>>>>> side'].join('\n') }
      }
      return {
        file: 'src/App.tsx',
        staged: true,
        isBinary: false,
        patch: [
          'diff --git a/src/App.tsx b/src/App.tsx',
          'index 1111111..2222222 100644',
          '--- a/src/App.tsx',
          '+++ b/src/App.tsx',
          '@@ -1,5 +1,6 @@',
          ' import x',
          ' const a = 1',
          '-old',
          '--a comment line that starts with two dashes',
          '+new',
          '+more',
          ' const b = 2',
          ' export default a',
        ].join('\n'),
      }
    case 'pull':
      return pullResult ?? {}
    case 'stash':
      if (params?.op === 'count') return { op: 'count', count: stashHost.count }
      if (params?.op === 'push') {
        stashHost.count += 1
        return { op: 'push', stashed: true, summary: 'Saved working directory and index state', count: stashHost.count }
      }
      if (stashHost.popConflicts === true) {
        stashHost.count = 0
        return { op: 'pop', summary: 'Auto-merging src/clash.ts', count: 0, conflicts: true }
      }
      stashHost.count = Math.max(0, stashHost.count - 1)
      return { op: 'pop', summary: 'Dropped refs/stash@{0}', count: stashHost.count, conflicts: false }
    case 'github':
      // The token round-trip flips this to serve `no-token` answers.
      if (githubAuthorized === false) return { connected: true, authorized: false, reason: 'no-token' }
      if (params?.action === 'commit') return { connected: true, authorized: true, commit: { sha: params.sha, login: 'EvT', name: 'EvT', avatarUrl: null } }
      if (params?.action === 'pulls') return { connected: true, authorized: true, defaultBranch: 'main', pulls: [] }
      if (params?.action === 'issues') return { connected: true, authorized: true, issues: [] }
      return {
        connected: true,
        authorized: true,
        remote: { host: 'github.com', owner: 'acme', repo: 'demo', slug: 'acme/demo', webUrl: 'https://github.com/acme/demo', remoteUrl: 'git@github.com:acme/demo.git' },
        repo: { fullName: 'acme/demo', description: 'demo', private: true, stars: 0, forks: 0, openIssues: 0, defaultBranch: 'main', htmlUrl: 'https://github.com/acme/demo' },
      }
    case 'commitDetail':
      return {
        sha: 'deadbeefdeadbeef',
        short: 'deadbee',
        author: 'Ada',
        date: new Date().toISOString(),
        subject: 'wire the sidebar panel',
        // Longer than the card used to slice at: the tail proves nothing is
        // truncated on the way to the DOM.
        body: `A longer body line.\n\n${'Body line that keeps going, so the card has to grow rather than clip. '.repeat(8)}BODY-TAIL`,
        files: 2,
        additions: 10,
        deletions: 3,
      }
    case 'commitDiff':
      return {
        sha: params.sha,
        short: String(params.sha).slice(0, 7),
        author: 'Ada',
        email: 'ada@example.com',
        date: new Date().toISOString(),
        subject: 'wire the sidebar panel',
        body: '',
        parents: ['aaaaaaaaaaaaaaaa'],
        merge: false,
        additions: 3,
        deletions: 1,
        total: 65,
        truncated: true,
        files: [
          {
            path: 'src/App.tsx',
            oldPath: null,
            status: 'M',
            additions: 3,
            deletions: 1,
            binary: false,
            patch: [
              'diff --git a/src/App.tsx b/src/App.tsx',
              'index 1111111..2222222 100644',
              '--- a/src/App.tsx',
              '+++ b/src/App.tsx',
              '@@ -1,4 +1,6 @@',
              ' import x',
              '-old line',
              '+new line',
              '+added line',
              '+one more added line',
              ' export default x',
            ].join('\n'),
          },
          {
            path: 'assets/logo.png',
            oldPath: null,
            status: 'A',
            additions: 0,
            deletions: 0,
            binary: true,
            patch: ['diff --git a/assets/logo.png b/assets/logo.png', 'new file mode 100644', 'index 0000000..1111111', 'Binary files /dev/null and b/assets/logo.png differ'].join('\n'),
          },
          {
            path: 'src/new.ts',
            oldPath: 'src/legacy.ts',
            status: 'R',
            additions: 1,
            deletions: 1,
            binary: false,
            patch: [
              'diff --git a/src/legacy.ts b/src/new.ts',
              'similarity index 90%',
              'rename from src/legacy.ts',
              'rename to src/new.ts',
              'index 1111111..2222222 100644',
              '--- a/src/legacy.ts',
              '+++ b/src/new.ts',
              '@@ -1,2 +1,2 @@',
              '-export const legacy = 1',
              '+export const fresh = 1',
              ' export default legacy',
            ].join('\n'),
          },
        ],
      }
    case 'branchDetail':
      return { branch: 'main', exists: true, short: 'abc1234', author: 'Ada', date: new Date().toISOString(), subject: 'wire the sidebar panel', upstream: 'origin/main', track: null }
    case 'worktrees':
      return {
        isRepo: true,
        root: 'C:/demo',
        rootKey: 'c:/demo',
        truncated: false,
        worktrees: [
          { path: 'C:/demo', key: 'c:/demo', branch: 'main', head: 'abc1234', main: true, detached: false, bare: false, locked: false, prunable: false, dirty: 3, dirtyKnown: true },
          { path: 'C:/demo/.agents/worktrees/fix-ui', key: 'c:/demo/.agents/worktrees/fix-ui', branch: 'worktree-fix-ui', head: 'def5678', main: false, detached: false, bare: false, locked: false, prunable: false, dirty: 0, dirtyKnown: true },
        ],
      }
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
/** When set, every `commitDiff` call fails with this message (a stale host). */
let commitDiffFailure = null
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  calls.push({ url: String(url), action: body.action, params: body.params, token: body.token ?? null })
  if (body.action === 'commit' && typeof commitSideEffect === 'function') commitSideEffect()
  const failure = failures.get(body.action)
  if (failure !== undefined) {
    return { ok: false, status: failure.status, json: async () => failure.body }
  }
  if (body.action === 'commitDiff' && commitDiffFailure !== null) {
    return { ok: false, status: 404, json: async () => ({ ok: false, error: commitDiffFailure }) }
  }
  const delay = delayedActions.get(body.action)
  if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay))
  return { ok: true, status: 200, json: async () => ({ ok: true, result: respond(body.action, body.params) }) }
}

// A PAT that an older build left on disk must not survive the new bundle
// loading at all (plan-v2 S24): seed it, then assert the load wiped it.
dom.window.localStorage.setItem('dsh-git-management/github-token', 'ghp_legacy_secret')

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
  if (id === 'react-dom') return reactDom
  throw new Error(`unexpected require: ${id}`)
})

// S24: loading the bundle must wipe the token a legacy build left on disk.
check('the legacy localStorage token is cleared on load', dom.window.localStorage.getItem('dsh-git-management/github-token') === null, dom.window.localStorage.getItem('dsh-git-management/github-token'))

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

/** Every `sidebarRight.openTab` call, so the click's navigation is assertable. */
const tabOpens = []
const sidebarRight = {
  openTab: (kind, options) => {
    tabOpens.push({ kind, params: options?.params ?? null })
  },
}

/** Run an effect and keep its disposer, like a cordis context does. */
function effect(fn) {  const disposer = fn()
  return () => {
    if (typeof disposer === 'function') disposer()
  }
}

/** Every `layout.selectPanel` call, so navigation itself is assertable. */
const panelSelections = []

const layout = {
  panelInfo: { getSnapshot: () => ({ activePanelId: panelSelections.length === 0 ? null : panelSelections[panelSelections.length - 1] }) },
  selectPanel: (id) => {
    panelSelections.push(id)
  },
}

const ctx = {
  effect,
  inject: (deps, callback) => callback({ slots, locale, effect, sidebarRightTabs, layout, sidebarRight }),
  slots,
  locale,
  sidebarRightTabs,
  layout,
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

// The commit tab: independently addressable, so every history click is a tab.
const commitType = tabTypes.find((definition) => definition.kind === 'git-commit')
check('a commit tab type is registered', commitType?.id === 'dsh-git-commit', tabTypes.map((definition) => definition.kind))
check('the commit tab is multi-instance', commitType?.multiple === true, commitType)
check('the commit tab has no start-page card', Array.isArray(commitType?.guide) && commitType.guide.length === 0, commitType?.guide)
check('the commit tab body is registered', registrations.some((row) => row.declaration.name === 'sidebar.right.pane.tab' && row.declaration.key === 'dsh-git-commit'))
check('the commit tab chip is registered', registrations.some((row) => row.declaration.name === 'sidebar.right.pane.tab.title' && row.declaration.key === 'dsh-git-commit'))

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

// A group folds away on one click, and the count stays readable while folded.
{
  const changesGroup = [...container.querySelectorAll('.gmg-group')].find((group) => (group.querySelector('.gmg-group-head')?.textContent ?? '').includes('更改'))
  const fold = changesGroup?.querySelector('.gmg-collapse')
  check('the changes group has a fold control', fold !== null && fold?.tagName === 'BUTTON', changesGroup?.querySelector('.gmg-group-head')?.textContent)
  check('it starts expanded', fold?.getAttribute('aria-expanded') === 'true', fold?.getAttribute('aria-expanded'))
  const filesBefore = changesGroup?.querySelectorAll('.gmg-file').length ?? 0
  check('the group shows its rows while open', filesBefore > 0, filesBefore)
  if (fold !== null && fold !== undefined) {
    await act(async () => {
      fold.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const folded = [...container.querySelectorAll('.gmg-group')].find((group) => (group.querySelector('.gmg-group-head')?.textContent ?? '').includes('更改'))
    check('folding hides the rows', folded?.querySelectorAll('.gmg-file').length === 0, folded?.querySelectorAll('.gmg-file').length)
    check('the folded header keeps the count', (folded?.querySelector('.gmg-count')?.textContent ?? '') === String(filesBefore), folded?.querySelector('.gmg-count')?.textContent)
    check('the fold control reports the state', folded?.querySelector('.gmg-collapse')?.getAttribute('aria-expanded') === 'false')
    await act(async () => {
      folded?.querySelector('.gmg-collapse')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const reopened = [...container.querySelectorAll('.gmg-group')].find((group) => (group.querySelector('.gmg-group-head')?.textContent ?? '').includes('更改'))
    check('folding again brings the rows back', reopened?.querySelectorAll('.gmg-file').length === filesBefore, reopened?.querySelectorAll('.gmg-file').length)
  }
}

// The local/remote relationship in the branch bar: ahead 2, behind 1 is the
// diverged case, and it must say so in class as well as in arrows.
{
  const track = container.querySelector('.gmg-track')
  check('the upstream line exists', track !== null, container.querySelector('.gmg-branchbar')?.textContent)
  check('a diverged branch is marked as diverged', track?.classList.contains('is-diverged') === true, track?.className)
  check('the arrow counts are still rendered', (track?.textContent ?? '').includes('↑2') && (track?.textContent ?? '').includes('↓1'), track?.textContent)
  const trackCss = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('each sync state has its own colour', ['.gmg-track.is-synced', '.gmg-track.is-ahead', '.gmg-track.is-behind', '.gmg-track.is-diverged'].every((rule) => trackCss.includes(rule)), trackCss.match(/\.gmg-track\.is-[a-z]+/g))
}
check('staged group is shown', text().includes('已暂存的更改'), text().slice(0, 400))
check('unstaged group is shown', text().includes('更改'), text().slice(0, 400))
check('staged file name is shown', text().includes('App.tsx'), text().slice(0, 400))
check('a path with a space survives rendering', text().includes('read me.md'), text().slice(0, 400))
check('line counts are shown', text().includes('+12') && text().includes('-3'), text().slice(0, 400))
check('commit button is rendered disabled without a message', container.querySelector('.gmg-btn.is-primary') !== null)

// A disabled primary used to be faded to 45%, which left a pale label on a pale
// surface: it read as an empty grey box. It must stay legible and say why.
{
  const commit = container.querySelector('.gmg-commit .gmg-btn.is-primary')
  check('the commit button is disabled before staging', commit?.disabled === true, commit?.outerHTML?.slice(0, 120))
  check('the disabled button still carries its label', (commit?.textContent ?? '').includes('提交'), commit?.textContent)
  check('the disabled button explains why', /先/.test(commit?.getAttribute('title') ?? ''), commit?.getAttribute('title'))
  const css = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('a disabled primary is not just faded', /\.gmg-btn\.is-primary:disabled\s*\{[^}]*opacity:\s*1/.test(css) && /\.gmg-btn\.is-primary:disabled\s*\{[^}]*color:\s*color-mix/.test(css), css.match(/\.gmg-btn\.is-primary:disabled[^}]*/)?.[0])
}

// The light theme needs its own surfaces: the theme's layers are white on white.
{
  const css = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  // The literal palette lives on :root and the surfaces on .gmg-root, so the
  // light overrides come as two blocks under one media query; both count.
  const lightCss = css.slice(css.indexOf('@media (prefers-color-scheme: light)'))
  check(
    'cards, controls and edges get light-theme values',
    ['--gmg-surface', '--gmg-control', '--gmg-edge'].every((name) => lightCss.includes(`${name}:`)),
    lightCss.slice(0, 200),
  )
  check('the card reads its theme-aware surface', /\.gmg-card\s*\{[^}]*var\(--gmg-surface\)/.test(css))
  check('a button reads its theme-aware surface', /\.gmg-btn\s*\{[^}]*var\(--gmg-control\)/.test(css))
  // The brand fill is near-white in the dark theme and near-black in the light
  // one, so a hardcoded white label disappeared into the dark theme's button.
  // The ink has to be the surface colour the accent is paired with.
  check(
    'a primary button inks its label with the surface, not a hardcoded white',
    /\.gmg-btn\.is-primary\s*\{[^}]*color:\s*var\(--dsw-alias-bg-base\)/.test(css),
    css.match(/\.gmg-btn\.is-primary[^}]*\}/)?.[0],
  )
}
check('history subject is rendered', text().includes('wire the sidebar panel'), text().slice(0, 600))

// ---- the per-row graph ---------------------------------------------------
// The rail behind the whole list is gone; every row now draws its own 22px
// slice (16-graph.js). These assertions pin the new contract: one svg per
// row, first child of the row, lane grid on 11px, node counts that read
// checkout/merge/plain, and arcs instead of cubics.
{
  const styleCss = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  const rows = [...container.querySelectorAll('.gmg-commit-row')]
  check('every commit got a row', rows.length === 5, rows.length)
  check('the commit id is gone from the row', rows.every((row) => row.querySelector('.gmg-sha') === null), rows[0]?.innerHTML.slice(0, 160))
  check('the old rail drawing is gone', container.querySelector('.gmg-graph-dot') === null, container.querySelector('.gmg-history')?.innerHTML?.slice(0, 160))
  check('the list reserves no rail width', (container.querySelector('.gmg-history')?.getAttribute('style') ?? '').includes('--gmg-graph-w') === false, container.querySelector('.gmg-history')?.getAttribute('style'))

  // The swimlane walk over the canned LOG (deadbeef→aaaa; aaaaaaaa merges
  // bbbb+cccc; both lines rejoin at the root dddd) is [1,2,2,2,2] lane
  // columns wide, and a row is 11*(lanes+1) px: 22, 33, 33, 33, 33.
  const graphs = rows.map((row) => row.firstElementChild)
  check('every row opens with its own graph svg', graphs.every((svg) => svg !== null && svg.tagName.toLowerCase() === 'svg' && svg.classList.contains('gmg-graph')), graphs.map((svg) => svg?.outerHTML?.slice(0, 60)))
  check('every graph cell is 22px tall', graphs.every((svg) => svg.getAttribute('height') === '22'), graphs.map((svg) => svg.getAttribute('height')))
  check('every graph is 11*(lanes+1) wide', graphs.map((svg) => svg.getAttribute('width')).join(',') === '22,33,33,33,33', graphs.map((svg) => svg.getAttribute('width')))
  check('every viewBox covers its cell', graphs.every((svg) => svg.getAttribute('viewBox') === `0 0 ${svg.getAttribute('width')} 22`), graphs.map((svg) => svg.getAttribute('viewBox')))
  const nodes = graphs.map((svg) => [...svg.querySelectorAll('.gmg-graph-node')])
  check('lane columns sit on the 11px grid', nodes.every((list) => list.every((node) => Number(node.getAttribute('cx')) % 11 === 0)), nodes.map((list) => list.map((node) => node.getAttribute('cx'))))
  check('the checkout and the merge are double nodes, plain commits single', nodes.map((list) => list.length).join(',') === '2,2,1,1,1', nodes.map((list) => list.length))
  check('the two lanes render at two columns', new Set(nodes.flat().map((node) => node.getAttribute('cx'))).size === 2, nodes.flat().map((node) => node.getAttribute('cx')))
  const edgePaths = graphs.flatMap((svg) => [...svg.querySelectorAll('.gmg-graph-edge')])
  check('every edge starts from a move and stays quadratic', edgePaths.length > 0 && edgePaths.every((path) => /^M /.test(path.getAttribute('d') ?? '') && !/C/.test(path.getAttribute('d') ?? '')), edgePaths.map((path) => path.getAttribute('d')?.slice(0, 48)))
  check('lanes converge and fork on 11px arcs', edgePaths.some((path) => (path.getAttribute('d') ?? '').includes('A 11 11 0 0 1')), edgePaths.map((path) => path.getAttribute('d')?.slice(0, 60)))

  // The checkout is the first fixture commit; it owns the is-current row and
  // the bolder subject — asserted through the class rules the shipped CSS
  // pins, since jsdom applies no cascade here.
  check('exactly one row is the checkout', rows.filter((row) => row.classList.contains('is-current')).length === 1 && rows[0].classList.contains('is-current'), rows.map((row) => row.className))
  check('the checkout subject reads bolder by rule', /\.gmg-commit-row\.is-current \.gmg-subject\s*\{[^}]*font-weight:\s*600/.test(styleCss), styleCss.match(/\.gmg-commit-row\.is-current \.gmg-subject[^}]*\}/)?.[0])
  check('rows are 22px at 13px type', /\.gmg-commit-row\s*\{[^}]*height:\s*22px/.test(styleCss) && /\.gmg-commit-row\s*\{[^}]*font-size:\s*13px/.test(styleCss), styleCss.match(/\.gmg-commit-row\s*\{[^}]*\}/)?.[0])
  check('the graph rides in the row flow', /\.gmg-commit-row \.gmg-graph\s*\{[^}]*flex:\s*none/.test(styleCss))
  check('edges paint thin and round-capped by rule', /\.gmg-graph-edge\s*\{[^}]*stroke-width:\s*1/.test(styleCss))

  const rowFor = (subject) => rows.find((row) => row.textContent.includes(subject))
  const chipsOf = (subject) => [...(rowFor(subject)?.querySelectorAll('.gmg-ref') ?? [])]
  const chipName = (chip) => chip.querySelector('.gmg-ref-name')?.textContent ?? ''
  check('the current branch is labelled on its commit', container.querySelector('.gmg-ref.is-head .gmg-ref-name')?.textContent === 'main', container.querySelector('.gmg-ref.is-head')?.textContent)
  // Cursor names only the lead chip; every other family collapses to a glyph.
  const checkoutChips = chipsOf('wire the sidebar panel')
  check('the checkout row names its lead ref', checkoutChips.length === 2 && checkoutChips[0].classList.contains('is-head') && chipName(checkoutChips[0]) === 'main', checkoutChips.map((chip) => `${chip.className}:${chipName(chip)}`))
  check('the published copy collapses to an icon-only chip', checkoutChips[1]?.classList.contains('is-cluster') === true && checkoutChips[1]?.querySelector('.gmg-ref-name') === null, checkoutChips[1]?.outerHTML?.slice(0, 200))
  check('a topic remote is labelled in the graph view', chipsOf('main line change').map(chipName).join('|') === 'origin/release', chipsOf('main line change').map((chip) => `${chip.className}:${chipName(chip)}`))
  const sideChips = chipsOf('side branch change')
  check('a local branch and its published copy both label', sideChips.length === 2 && chipName(sideChips[0]) === 'origin/dev' && sideChips[1].classList.contains('is-cluster') === true && sideChips[1].classList.contains('is-branch') === true && sideChips[1].querySelector('.gmg-ref-name') === null, sideChips.map((chip) => `${chip.className}:${chipName(chip)}`))
  check('every badge chip carries a glyph', rows.every((row) => [...row.querySelectorAll('.gmg-ref')].every((chip) => chip.querySelector('svg') !== null)), rows.map((row) => row.querySelectorAll('.gmg-ref').length))
  check('a row without refs wears no chip', chipsOf('initial import').length === 0, chipsOf('initial import').map((chip) => chip.outerHTML))
  // The graph is the collaboration view: it opens on every ref (so a
  // colleague's pushed branch has a lane) and puts the fetch that brings those
  // refs in beside the list itself.
  check('the graph opens on every ref', container.querySelector('.gmg-scope')?.textContent === '全部引用', container.querySelector('.gmg-scope')?.textContent)
  check('the graph offers a fetch beside the list', container.querySelector('.gmg-graph-fetch') !== null, container.querySelector('.gmg-group-head')?.innerHTML?.slice(0, 240))

  const refCss = styleCss
  check('a ref name is its own box so it can ellipsize', /\.gmg-ref-name\s*\{[^}]*text-overflow:\s*ellipsis/.test(refCss))
  check('local and remote are different hues', /--gmg-remote:\s*#[0-9a-f]{6}/i.test(refCss) && /\.gmg-ref\.is-remote\s*\{[^}]*var\(--gmg-remote\)/.test(refCss), refCss.match(/--gmg-remote[^;]*/)?.[0])
  check('a local branch is the local hue', /--gmg-local:\s*#[0-9a-f]{6}/i.test(refCss) && /\.gmg-ref\.is-branch\s*\{[^}]*var\(--gmg-local\)/.test(refCss), refCss.match(/--gmg-local[^;]*/)?.[0])
  check('the checked-out chip is filled, not tinted', /\.gmg-ref\.is-head\s*\{[^}]*background:\s*var\(--gmg-local\)/.test(refCss))
  check('light surfaces get their own darker inks', /prefers-color-scheme:\s*light/.test(refCss) && /--gmg-remote:\s*#7c3aed/i.test(refCss))
}
check('github card names the remote', text().includes('acme/demo'), text().slice(0, 600))
check('the github card lists the pulls tab', text().includes('拉取请求'), text().slice(-400))
check('no error notice is shown', container.querySelector('.gmg-notice.is-error') === null, container.querySelector('.gmg-notice.is-error')?.textContent)

// ---- feedback that survives the scroll, and a keyboard that shows ---------
{
  const injected = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('notices stay in view while the panel scrolls', /\.gmg-notice\.is-error[^{]*\{[^}]*position:\s*sticky/.test(injected), injected.slice(0, 60))
  check('keyboard focus is visible on rows and buttons', /\.gmg-file:focus-visible/.test(injected) && /outline:\s*2px solid var\(--dsw-alias-brand-primary\)/.test(injected))
}

// ---- a file action re-reads only the status ------------------------------
{
  const before = calls.length
  const stageButton = [...container.querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '暂存')
  check('an unstaged row offers a stage action', stageButton !== undefined, [...container.querySelectorAll('.gmg-file .gmg-actions button')].map((button) => button.getAttribute('aria-label')))
  if (stageButton !== undefined) {
    await act(async () => {
      stageButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const after = calls.slice(before)
    check('staging asks the host to stage the file', after.some((call) => call.action === 'stage'), after.map((call) => call.action))
    check('staging does not re-read the whole panel', after.some((call) => call.action === 'status') && after.some((call) => call.action === 'log') === false, after.map((call) => call.action))
  }
}

// ---- an in-progress merge -------------------------------------------------
{
  statusPayload = CONFLICTED
  const refreshButton = container.querySelector('.gmg-icon-btn[aria-label="刷新"]')
  check('the header offers a refresh', refreshButton !== null)
  if (refreshButton !== null) {
    await act(async () => {
      refreshButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    const commitButton = container.querySelector('.gmg-commit .gmg-btn.is-primary')
    check('a conflicted tree cannot be committed', commitButton !== null && commitButton.disabled === true, commitButton?.outerHTML?.slice(0, 120))
    check('the reason is spelled out', text().includes('未解决的冲突'), text().slice(0, 900))
    const resolveButton = [...container.querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '标记为已解决')
    check('a conflicted row can be marked resolved', resolveButton !== undefined, [...container.querySelectorAll('.gmg-file .gmg-actions button')].map((button) => button.getAttribute('aria-label')))
    const abortButton = [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('中止合并'))
    check('the merge can be aborted from the panel', abortButton !== undefined, container.querySelector('.gmg-conflict')?.textContent)
    if (abortButton !== undefined) {
      const before = calls.length
      dom.window.confirm = () => false
      await act(async () => {
        abortButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('declining the confirmation keeps the merge', calls.slice(before).some((call) => call.action === 'abortMerge') === false, calls.slice(before).map((call) => call.action))
      dom.window.confirm = () => true
      await act(async () => {
        abortButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      check('confirming the abort reaches the host', calls.slice(before).some((call) => call.action === 'abortMerge'), calls.slice(before).map((call) => call.action))
    }
  }
  statusPayload = STATUS
}

// The worktree block: both checkouts, the main tag, and the dirty badge.
check('worktree section renders', text().includes('工作樹'), text().slice(0, 900))
check('the secondary worktree is listed', text().includes('worktree-fix-ui'), text().slice(0, 900))
check('the main worktree is tagged', text().includes('主'), text().slice(0, 900))
check('the current worktree is marked', container.querySelector('.gmg-wt.is-current') !== null)
check(
  'the dirty badge shows the tracked count',
  container.querySelector('.gmg-wt-dirty.is-dirty')?.textContent === '3',
  container.querySelector('.gmg-wt-dirty')?.textContent,
)
check('a clean worktree says so', container.querySelectorAll('.gmg-wt').length === 2)

// Clicking a file swaps the tab body to the diff — the conversation column is
// never touched, so the panel must render in this same container.
const fileRow = container.querySelector('.gmg-file')
check('no `main` panel is registered (the diff stays in the column)', registrations.every((entry) => entry.declaration.name !== 'main'), registrations.map((entry) => entry.declaration.name))

if (fileRow !== null) {
  await act(async () => {
    fileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  check('clicking a file opens the diff tab', tabOpens.length === 1 && tabOpens[0].kind === 'git-diff', tabOpens)
  check('the tab carries the file as navigation params', tabOpens[0]?.params?.file === 'src/App.tsx', tabOpens[0]?.params)
  check('the change list is still on screen', container.querySelector('.gmg-file') !== null)

  // The diff tab body renders from those params, the way the column feeds it.
  const params = tabOpens[0]?.params ?? null
  const diffRegistration = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab' && entry.declaration.key === 'dsh-git-diff')
  check('the diff tab body is registered', diffRegistration !== undefined, registrations.map((entry) => entry.declaration.key))

  if (diffRegistration !== undefined && params !== null) {
    const diffContainer = document.createElement('div')
    document.body.appendChild(diffContainer)
    const diffRoot = createRoot(diffContainer)
    let closed = false
    await act(async () => {
      diffRoot.render(
        React.createElement(diffRegistration.component, {
          ...diffRegistration.declaration.inject(),
          actions: { close: () => { closed = true } },
          useTabInfo: () => ({ tab: { id: 'tab-1', navigation: { params, revision: 1 } } }),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    const diffCall = calls.filter((call) => call.action === 'diff').pop()
    check('the diff tab requests the patch', diffCall !== undefined, calls.map((call) => call.action))
    check('the patch is requested with full file context', diffCall?.params?.context === 'full', diffCall?.params)
    check('added lines are drawn', diffContainer.querySelector('.gmg-diff-cell.is-add') !== null, diffContainer.innerHTML.slice(0, 200))
    check('removed lines are drawn', diffContainer.querySelector('.gmg-diff-cell.is-del') !== null)
    check('both gutters carry numbers', diffContainer.querySelectorAll('.gmg-diff-no').length >= 4)
    check('the whole file is drawn, not just the hunk', diffContainer.querySelectorAll('.gmg-diffrow').length >= 10, diffContainer.querySelectorAll('.gmg-diffrow').length)

    // A removed line whose text starts with `--` prints as `--- ...` inside the
    // hunk; treating that as a file header lost the line and shifted the rest.
    const dashRow = [...diffContainer.querySelectorAll('.gmg-diffrow')].find((row) => (row.textContent ?? '').includes('a comment line that starts with two dashes'))
    check('a content line that looks like a header is still content', dashRow?.classList.contains('is-del') === true, dashRow?.className)
    check('the dasher keeps its gutter number', dashRow?.querySelector('.gmg-diff-no')?.textContent === '4', dashRow?.textContent)
    const afterRow = [...diffContainer.querySelectorAll('.gmg-diffrow')].find((row) => (row.textContent ?? '').includes('const b = 2'))
    const afterNumbers = [...(afterRow?.querySelectorAll('.gmg-diff-no') ?? [])].map((cell) => cell.textContent)
    check('the lines after it keep their numbers', afterNumbers.length === 2 && afterNumbers[0] === '5' && afterNumbers[1] === '5', afterNumbers)

    // The split toggle re-pairs the same rows.
    const splitButton = [...diffContainer.querySelectorAll('button')].find((button) => /[并並]排|Split/.test(button.textContent ?? ''))
    if (splitButton !== undefined) {
      await act(async () => {
        splitButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      check('split mode draws paired cells', diffContainer.querySelector('.gmg-diffbody.is-split') !== null)
    const splitRows = [...diffContainer.querySelectorAll('.gmg-diffrow.is-splitrow')].filter((row) => row.classList.contains('is-hunk') === false)
    check('every split row carries two gutters and two cells', splitRows.length > 0 && splitRows.every((row) => row.children.length === 4), splitRows.map((row) => row.children.length))
    check(
      'a removal keeps its red half in side-by-side',
      splitRows.some((row) => row.children[0].classList.contains('is-del') && row.children[1].classList.contains('is-del')),
      splitRows.map((row) => row.innerHTML.slice(0, 80)),
    )
    check(
      'an addition keeps its green half in side-by-side',
      splitRows.some((row) => row.children[2].classList.contains('is-add') && row.children[3].classList.contains('is-add')),
      splitRows.map((row) => row.innerHTML.slice(0, 80)),
    )
    const splitCss = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
    check(
      'side-by-side halves are tinted by CSS',
      splitCss.includes('.gmg-diffbody.is-split .gmg-diff-cell.is-add') && splitCss.includes('.gmg-diffbody.is-split .gmg-diff-no.is-del'),
      splitCss.slice(0, 60),
    )
    } else {
      check('a split toggle exists', false, diffContainer.querySelector('.gmg-diffhead')?.textContent)
    }

    // The review loop closes here: the file's own diff offers the same two
    // actions the row does, without going back to the list first. The staging
    // button is symmetric — a staged file gets “取消暂存”, not a missing one
    // three layers away (poweruser G4).
    const stageButton = [...diffContainer.querySelectorAll('.gmg-diffhead button')].find((button) => (button.textContent ?? '').trim() === '取消暂存')
    const discardButton = [...diffContainer.querySelectorAll('.gmg-diffhead button')].find((button) => (button.textContent ?? '').includes('放弃更改'))
    check('a staged diff offers unstage', stageButton !== undefined, diffContainer.querySelector('.gmg-diffhead')?.textContent)
    check('the diff header offers discard', discardButton !== undefined, diffContainer.querySelector('.gmg-diffhead')?.textContent)
    if (discardButton !== undefined) {
      const before = calls.length
      dom.window.confirm = () => false
      await act(async () => {
        discardButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('declining the discard leaves the file alone', calls.slice(before).some((call) => /discard|deleteUntracked/.test(call.action)) === false, calls.slice(before).map((call) => call.action))
      dom.window.confirm = () => true
    }
    if (stageButton !== undefined) {
      const before = calls.length
      await act(async () => {
        stageButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      const after = calls.slice(before)
      check('unstage from the diff header reaches the host', after.some((call) => call.action === 'unstage' && call.params?.files?.[0] === 'src/App.tsx'), after.map((call) => call.action))
      const reRead = after.filter((call) => call.action === 'diff').pop()
      check('the diff reopens on the worktree side', reRead?.params?.staged === false, reRead?.params)
    }

    // Closing goes through the tab's own action, so the strip drops the tab.
    const closeButton = [...diffContainer.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('返回'))
    if (closeButton !== undefined) {
      await act(async () => {
        closeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      check('closing the diff asks the tab to close', closed === true)
    } else {
      check('a back button exists', false)
    }

    await act(async () => {
      diffRoot.unmount()
    })
    diffContainer.remove()

    // The worktree side of the same panel: an untracked file, which has its
    // own pair of actions (stage, delete).
    const worktreeContainer = document.createElement('div')
    document.body.appendChild(worktreeContainer)
    const worktreeRoot = createRoot(worktreeContainer)
    await act(async () => {
      worktreeRoot.render(
        React.createElement(diffRegistration.component, {
          ...diffRegistration.declaration.inject(),
          actions: { close: () => {} },
          useTabInfo: () => ({ tab: { id: 'tab-2', navigation: { params: { path: 'C:/demo', file: 'docs/read me.md', staged: false, status: 'U' }, revision: 2 } } }),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    const worktreeStage = [...worktreeContainer.querySelectorAll('.gmg-diffhead button')].find((button) => (button.textContent ?? '').trim().endsWith('暂存'))
    check('an unstaged diff offers stage', worktreeStage !== undefined, worktreeContainer.querySelector('.gmg-diffhead')?.textContent)
    const worktreeDelete = [...worktreeContainer.querySelectorAll('.gmg-diffhead button')].find((button) => (button.textContent ?? '').includes('删除文件'))
    check('an untracked diff offers delete, not discard', worktreeDelete !== undefined, worktreeContainer.querySelector('.gmg-diffhead')?.textContent)
    if (worktreeStage !== undefined) {
      const before = calls.length
      await act(async () => {
        worktreeStage.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      check('staging from the diff reaches the host', calls.slice(before).some((call) => call.action === 'stage'), calls.slice(before).map((call) => call.action))
    }
    await act(async () => {
      worktreeRoot.unmount()
    })
    worktreeContainer.remove()

    // A conflicted file: git answers with a combined diff, and the panel says
    // so rather than rendering two-column prefixes as if they were content.
    const clashContainer = document.createElement('div')
    document.body.appendChild(clashContainer)
    const clashRoot = createRoot(clashContainer)
    await act(async () => {
      clashRoot.render(
        React.createElement(diffRegistration.component, {
          ...diffRegistration.declaration.inject(),
          actions: { close: () => {} },
          useTabInfo: () => ({ tab: { id: 'tab-3', navigation: { params: { path: 'C:/demo', file: 'src/clash.ts', staged: false, status: 'UU' }, revision: 3 } } }),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    check('a conflicted file explains itself instead of drawing garbage', (clashContainer.textContent ?? '').includes('冲突'), clashContainer.textContent?.slice(0, 200))
    check('no combined-diff prefix reaches the body', clashContainer.querySelector('.gmg-diff-cell') === null, clashContainer.querySelector('.gmg-diffbody')?.textContent)
    await act(async () => {
      clashRoot.unmount()
    })
    clashContainer.remove()
  }
} else {
  check('a file row exists to click', false)
}

// ---- clicking a commit in the history opens its own tab -------------------
// The row is the way in: the list must stay put and the commit's whole change
// set must arrive as one tab with a block per file.
{
  const commitRow = container.querySelector('.gmg-commit-row')
  check(
    'every history row is a click target',
    commitRow?.getAttribute('role') === 'button' && commitRow?.getAttribute('tabindex') === '0',
    commitRow?.outerHTML.slice(0, 160),
  )
  check(
    'the row does not raise a native tooltip over the list',
    commitRow?.getAttribute('title') === null,
    commitRow?.getAttribute('title'),
  )

  if (commitRow !== null) {
    const before = tabOpens.length
    await act(async () => {
      commitRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    check('clicking a commit opens a commit tab', tabOpens.length === before + 1 && tabOpens[before].kind === 'git-commit', tabOpens)
    check(
      'the tab carries the commit and its repository as params',
      tabOpens[before]?.params?.sha === 'deadbeefdeadbeef' && tabOpens[before]?.params?.path === 'C:/demo',
      tabOpens[before]?.params,
    )
    check('the change list is still on screen', container.querySelector('.gmg-file') !== null)

    const params = tabOpens[before]?.params ?? null
    const commitRegistration = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab' && entry.declaration.key === 'dsh-git-commit')
    check('the commit tab body is registered', commitRegistration !== undefined, registrations.map((entry) => entry.declaration.key))

    if (commitRegistration !== undefined && params !== null) {
      const commitContainer = document.createElement('div')
      document.body.appendChild(commitContainer)
      const commitRoot = createRoot(commitContainer)
      let closed = false
      await act(async () => {
        commitRoot.render(
          React.createElement(commitRegistration.component, {
            ...commitRegistration.declaration.inject(),
            actions: { close: () => { closed = true } },
            useTabInfo: () => ({ tab: { id: 'tab-commit', navigation: { params, revision: 1 } } }),
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 40))
      })

      const commitCall = calls.filter((call) => call.action === 'commitDiff').pop()
      check('the commit tab asks the host for that commit', commitCall?.params?.sha === 'deadbeefdeadbeef', commitCall?.params)
      check('the tab stacks one block per file', commitContainer.querySelectorAll('.gmg-cdiff-file').length === 3, commitContainer.querySelectorAll('.gmg-cdiff-file').length)
      check('the header names the commit subject', (commitContainer.querySelector('.gmg-cdiff-subject')?.textContent ?? '').includes('wire the sidebar panel'), commitContainer.querySelector('.gmg-cdiff-subject')?.textContent)
      check('the header carries the short id', (commitContainer.querySelector('.gmg-sha')?.textContent ?? '') === 'deadbee', commitContainer.querySelector('.gmg-sha')?.textContent)
      // P2-1: the header carries the same quiet pair the hover card does.
      {
        const quickLinks = commitContainer.querySelector('.gmg-cdiff-headline .gmg-quicklinks')
        check(
          'the commit tab header offers copy and the exact-commit GitHub link',
          quickLinks?.querySelector('button[aria-label="复制提交号"]') !== null && quickLinks?.querySelector('a[href="https://github.com/acme/demo/commit/deadbeefdeadbeef"]') !== null,
          quickLinks?.innerHTML,
        )
      }
      check('the header counts every file, not only the loaded ones', (commitContainer.textContent ?? '').includes('65 個檔案'), commitContainer.querySelector('.gmg-cdiff-subline')?.textContent)
      check('added lines are drawn', commitContainer.querySelector('.gmg-diffbody .gmg-diff-cell.is-add') !== null)
      check('removed lines are drawn', commitContainer.querySelector('.gmg-diffbody .gmg-diff-cell.is-del') !== null)
      check('the file header noise is not repeated', (commitContainer.textContent ?? '').includes('diff --git') === false, commitContainer.textContent?.slice(0, 200))
      check('a binary file says so instead of drawing', (commitContainer.textContent ?? '').includes('二進位檔'), commitContainer.textContent?.slice(0, 300))
      check('a rename shows the path it came from', (commitContainer.querySelector('.gmg-cdiff-rename')?.textContent ?? '').includes('src/legacy.ts'), commitContainer.querySelector('.gmg-cdiff-rename')?.textContent)
      check('a truncated list says what it left out', /共 65 個檔案/.test(commitContainer.textContent ?? ''), commitContainer.textContent?.slice(-200))
      const commitCss = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
      check('file headers stick while their diff scrolls', /\.gmg-cdiff-filehead\s*\{[^}]*position:\s*sticky/.test(commitCss), commitCss.slice(-200))
      check(
        'a file header lives inside the scrolling list, in its own section',
        commitContainer.querySelector('.gmg-cdiff-scroll .gmg-cdiff-file > .gmg-cdiff-filehead') !== null,
        commitContainer.querySelector('.gmg-cdiff-scroll')?.innerHTML.slice(0, 160),
      )
      const rootBlocks = commitCss.match(/:root\s*\{[^}]*\}/g) ?? []
      check(
        'the literal palette sits on :root, the scope a portalled card still inherits',
        rootBlocks.some((block) => block.includes('--gmg-ok:')) && rootBlocks.every((block) => block.includes('--dsw-alias-') === false),
        rootBlocks.slice(0, 2),
      )
      check(
        'surface tokens stay on .gmg-root, where the theme aliases (published on body) exist',
        /\.gmg-root\s*\{[^}]*--gmg-surface:\s*var\(--dsw-alias-bg-layer-2\)/.test(commitCss),
        commitCss.slice(0, 600),
      )
      const hoverToken = /--gmg-hover:\s*([^;]+);/.exec(commitCss)?.[1]?.trim() ?? ''
      check(
        'the row highlight tints the text colour instead of repeating the surface',
        hoverToken.includes('--dsw-alias-label-primary') && hoverToken.includes('transparent'),
        hoverToken,
      )
      check(
        'the hover card header reads a theme token, not a panel-scoped one',
        /\.gmg-hoverzone\.is-head\s*\{[^}]*background:\s*var\(--dsw-alias-bg-layer-2\)/.test(commitCss),
        commitCss.slice(-600),
      )
      check(
        'the stat colours and row highlight are drawn from those tokens',
        /\.gmg-stat-add\s*\{[^}]*--gmg-ok/.test(commitCss) && /\.gmg-stat-del\s*\{[^}]*--gmg-bad/.test(commitCss) && /\.gmg-commit-row:hover\s*\{[^}]*var\(--gmg-hover\)/.test(commitCss),
        commitCss.slice(-400),
      )

      // Folding one block leaves its neighbour alone.
      const firstHead = commitContainer.querySelector('.gmg-cdiff-filehead')
      await act(async () => {
        firstHead.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      check(
        'folding a file hides only its diff',
        commitContainer.querySelectorAll('.gmg-cdiff-file.is-folded').length === 1 &&
          commitContainer.querySelector('.gmg-cdiff-file.is-folded .gmg-cdiff-body') === null &&
          commitContainer.querySelectorAll('.gmg-cdiff-body').length === 1,
        commitContainer.querySelectorAll('.gmg-cdiff-body').length,
      )

      const collapseAll = [...commitContainer.querySelectorAll('button')].find((button) => /收合全部/.test(button.textContent ?? ''))
      check('a collapse-all control exists', collapseAll !== undefined, commitContainer.querySelector('.gmg-cdiff-subline')?.textContent)
      if (collapseAll !== undefined) {
        await act(async () => {
          collapseAll.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        check('collapse all folds every block', commitContainer.querySelectorAll('.gmg-cdiff-file.is-folded').length === 3)
        const expandAll = [...commitContainer.querySelectorAll('button')].find((button) => /展開全部/.test(button.textContent ?? ''))
        await act(async () => {
          expandAll?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        check('expand all brings the diffs back', commitContainer.querySelectorAll('.gmg-cdiff-file.is-folded').length === 0 && commitContainer.querySelectorAll('.gmg-cdiff-body').length === 2)
      }

      // Two tabs on the same commit share one host read.
      const beforeDedupe = calls.filter((call) => call.action === 'commitDiff').length
      const twinContainer = document.createElement('div')
      document.body.appendChild(twinContainer)
      const twinRoot = createRoot(twinContainer)
      await act(async () => {
        twinRoot.render(
          React.createElement(commitRegistration.component, {
            ...commitRegistration.declaration.inject(),
            actions: { close: () => {} },
            useTabInfo: () => ({ tab: { id: 'tab-commit-twin', visible: true, navigation: { params, revision: 1 } } }),
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      check('two tabs on one commit ask git once', calls.filter((call) => call.action === 'commitDiff').length === beforeDedupe, calls.map((call) => call.action))
      check('the second tab renders from the cache', twinContainer.querySelectorAll('.gmg-cdiff-file').length === 3, twinContainer.querySelectorAll('.gmg-cdiff-file').length)
      await act(async () => {
        twinRoot.unmount()
      })
      twinContainer.remove()

      // Escape closes the tab it belongs to (docs promise this), but a hidden
      // tab in a split strip must not answer for the visible one.
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      check('Escape closes the commit tab', closed === true)

      const hiddenContainer = document.createElement('div')
      document.body.appendChild(hiddenContainer)
      const hiddenRoot = createRoot(hiddenContainer)
      let hiddenClosed = false
      await act(async () => {
        hiddenRoot.render(
          React.createElement(commitRegistration.component, {
            ...commitRegistration.declaration.inject(),
            actions: { close: () => { hiddenClosed = true } },
            useTabInfo: () => ({ tab: { id: 'tab-commit-hidden', visible: false, navigation: { params, revision: 1 } } }),
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      check('a hidden commit tab ignores Escape', hiddenClosed === false)
      await act(async () => {
        hiddenRoot.unmount()
      })
      hiddenContainer.remove()

      // A page newer than the host process: the action is unknown until a full
      // restart, and the panel must say that instead of sending the reader to
      // reload a page that is already current.
      commitDiffFailure = 'unknown action: commitDiff'
      const staleParams = { ...params, sha: 'feedfacefeedface', short: 'feedfac', subject: 'a commit the old host does not know' }
      const staleContainer = document.createElement('div')
      document.body.appendChild(staleContainer)
      const staleRoot = createRoot(staleContainer)
      await act(async () => {
        staleRoot.render(
          React.createElement(commitRegistration.component, {
            ...commitRegistration.declaration.inject(),
            actions: { close: () => {} },
            useTabInfo: () => ({ tab: { id: 'tab-stale', visible: true, navigation: { params: staleParams, revision: 1 } } }),
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      check('a stale host is explained, not just reported', (staleContainer.textContent ?? '').includes('完全結束'), staleContainer.textContent?.slice(0, 300))
      check('the stale host still offers retry', staleContainer.querySelector('.gmg-form button') !== null)
      commitDiffFailure = null
      const retryButton = staleContainer.querySelector('.gmg-form button')
      if (retryButton !== null) {
        await act(async () => {
          retryButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 40))
        })
        check('retry after the restart loads the commit', staleContainer.querySelectorAll('.gmg-cdiff-file').length === 3, staleContainer.querySelectorAll('.gmg-cdiff-file').length)
      }
      await act(async () => {
        staleRoot.unmount()
      })
      staleContainer.remove()

      const backButton = [...commitContainer.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('返回'))
      if (backButton !== undefined) {
        await act(async () => {
          backButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        })
        check('back asks the tab to close', closed === true)
      } else {
        check('a back button exists', false)
      }

      await act(async () => {
        commitRoot.unmount()
      })
      commitContainer.remove()

      // The chip names the commit, so a strip of commit tabs is readable.
      const commitTitle = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab.title' && entry.declaration.key === 'dsh-git-commit')
      if (commitTitle !== undefined) {
        const titleContainer = document.createElement('div')
        document.body.appendChild(titleContainer)
        const titleRoot = createRoot(titleContainer)
        await act(async () => {
          titleRoot.render(
            React.createElement(commitTitle.component, {
              ...commitTitle.declaration.inject(),
              useTabInfo: () => ({ tab: { id: 'tab-commit', navigation: { params, revision: 1 } } }),
            }),
          )
        })
        check('the commit chip names the commit', (titleContainer.textContent ?? '').includes('wire the sidebar panel'), titleContainer.textContent)
        await act(async () => {
          titleRoot.unmount()
        })
        titleContainer.remove()
      }
    }
  } else {
    check('a commit row exists to click', false)
  }
}

// Hovering a commit floats its card in the gap to the left of the column.
// React derives onMouseEnter from mouseover, which is the event it listens for.
// jsdom has no layout engine, so the two boxes the card is placed against are
// stubbed: a 1440px-wide window whose source-control column sits at 1040..1400.
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) })
const realRect = dom.window.Element.prototype.getBoundingClientRect
dom.window.Element.prototype.getBoundingClientRect = function measure() {
  const classes = this.classList
  if (classes?.contains('gmg-hover')) return box(0, 0, 344, 420)
  if (classes?.contains('gmg-commit-row')) return box(1048, 300, 344, 22)
  if (classes?.contains('gmg-root')) return box(1040, 40, 360, 700)
  return realRect.call(this)
}

const commitRow = container.querySelector('.gmg-commit-row')
if (commitRow !== null) {
  await act(async () => {
    commitRow.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 40, clientY: 60 }))
    await new Promise((resolve) => setTimeout(resolve, 380))
  })
  const card = document.body.querySelector('.gmg-hover')
  const cardText = card?.textContent ?? ''
  const cardLeft = Number.parseFloat(card?.style?.left ?? 'NaN')
  const cardWidth = Number.parseFloat(card?.style?.width ?? 'NaN')
  check('resting on a commit floats a card', card !== null, container.innerHTML.slice(-240))
  check(
    "the card hangs off the column's left edge, not over the rows",
    Number.isFinite(cardLeft) && Number.isFinite(cardWidth) && cardLeft >= 8 && cardLeft + cardWidth <= 1040 - 12 + 0.5,
    card?.getAttribute('style'),
  )
  check('the card height follows its content', (card?.style?.maxHeight ?? '') === '', card?.getAttribute('style'))
  check('the whole commit body is rendered', cardText.includes('BODY-TAIL'), cardText.slice(-120))
  const injectedCss = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('the CSS does not clip the body zone', !/\.gmg-hoverzone\.is-body\s*\{[^}]*max-height/.test(injectedCss), injectedCss.slice(0, 80))
  check('the card carries the commit subject', cardText.includes('wire the sidebar panel'), cardText.slice(0, 160))
  check('the author is the GitHub account, not git user.name', cardText.includes('EvT') && cardText.includes('Ada') === false, cardText.slice(0, 120))
  check('the card renders the commit body', cardText.includes('A longer body line.'), cardText.slice(0, 240))
  check('the card carries the full stat line', /2 個檔案變更，10 行插入\(\+\)，3 行刪除\(-\)/.test(cardText), cardText.slice(0, 240))
  check('the card is split into four zones', card.querySelectorAll('.gmg-hoverzone').length === 4, card.querySelectorAll('.gmg-hoverzone').length)
  check('the subject has its own zone', card.querySelector('.gmg-hoverzone.is-subject')?.textContent?.includes('wire the sidebar panel') === true)
  check('the head zone is marked', card.querySelector('.gmg-hoverzone.is-head') !== null)
  check('the body zone is marked', card.querySelector('.gmg-hoverzone.is-body') !== null)
  check('the foot zone is marked', card.querySelector('.gmg-hoverzone.is-foot') !== null)
  check('insertions and deletions are coloured apart', card.querySelector('.gmg-stat-add') !== null && card.querySelector('.gmg-stat-del') !== null)
  check('the ratio bar has two segments', card.querySelectorAll('.gmg-statbar span').length === 2)
  // P2-1 turned the dead-end card into a way out: copy the sha, and open that
  // exact commit — the link only exists because the GitHub card already
  // resolved a webUrl; nothing here fetches anything new.
  {
    const links = card.querySelector('.gmg-quicklinks')
    check(
      'the card links to the exact commit on GitHub',
      links?.querySelector('a[href="https://github.com/acme/demo/commit/deadbeefdeadbeef"]') !== null,
      links?.innerHTML,
    )
    const copiedTexts = []
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { copiedTexts.push(value) } },
    })
    const copyButton = links?.querySelector('button[aria-label="复制提交号"]')
    check('the card offers a copy control', copyButton !== null && copyButton !== undefined)
    if (copyButton !== null && copyButton !== undefined) {
      await act(async () => {
        copyButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      check('copying takes the full sha', copiedTexts.includes('deadbeefdeadbeef'), copiedTexts)
      check('the control answers without moving the card', copyButton.getAttribute('title') === '已复制', copyButton.getAttribute('title'))
    }
  }
  check('the card fetches the commit stat', calls.some((call) => call.action === 'commitDetail'), calls.map((call) => call.action))

  // A window shorter than the card pins it to the top edge and lets it scroll,
  // instead of letting the bottom run past the viewport.
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 300 })
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('resize'))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  check(
    'a card taller than the window is pinned to the top and scrolls',
    card.style.maxHeight === '284px' && card.style.overflowY === 'auto' && card.style.top === '8px',
    card.getAttribute('style'),
  )
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 768 })
} else {
  check('a commit row exists to hover', false)
}

// The branch pill opens a themed menu, not the OS <select> popup.
const branchPill = container.querySelector('.gmg-branch')
if (branchPill !== null) {
  check('the branch pill is a button, not a select', branchPill.tagName === 'BUTTON' && container.querySelector('select.gmg-branch-select') === null)

  await act(async () => {
    branchPill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const branchMenu = document.body.querySelector('.gmg-branchmenu')
  check('clicking the pill opens a menu', branchMenu !== null, document.body.innerHTML.slice(-200))
  check('the menu lists every local branch', branchMenu?.querySelectorAll('.gmg-branchitem').length === 2, branchMenu?.textContent)
  check('the current branch is marked once', branchMenu?.querySelectorAll('.gmg-branchitem.is-current').length === 1, branchMenu?.textContent)
  check('the menu opens on the current branch', branchMenu?.querySelector('.gmg-branchitem.is-active')?.textContent?.includes('main') === true, branchMenu?.textContent)

  await act(async () => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  check('Escape closes the menu', document.body.querySelector('.gmg-branchmenu') === null)

  await act(async () => {
    branchPill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const devRow = [...document.body.querySelectorAll('.gmg-branchitem')].find((item) => item.textContent === 'dev')
  if (devRow !== undefined) {
    await act(async () => {
      devRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    check('picking a branch asks the host to switch', calls.some((call) => call.action === 'switch' && call.params?.branch === 'dev'), calls.map((call) => `${call.action}:${call.params?.branch ?? ''}`))
    check('the menu closes after picking', document.body.querySelector('.gmg-branchmenu') === null)
  } else {
    check('a dev row is offered', false, document.body.querySelector('.gmg-branchmenu')?.textContent)
  }
} else {
  check('a branch pill exists', false)
}

// ---- W2-4: the row that is working locks only itself ----------------------
{
  const setValue = (element, value) => {
    const proto =
      element.tagName === 'TEXTAREA'
        ? dom.window.HTMLTextAreaElement.prototype
        : element.tagName === 'SELECT'
          ? dom.window.HTMLSelectElement.prototype
          : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    if (element.tagName === 'SELECT') {
      element.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    } else {
      // React's controlled fields compare against their own value tracker, and
      // a bare `input` event on a directly-assigned value never reaches
      // `onChange` here; Simulate walks the same listeners the browser would.
      Simulate.change(element)
    }
  }
  const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  const wait = async (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  // “更改” as a substring also matches “已暂存的更改”, whose group is first in
  // the DOM; locate a group by the row it actually contains instead.
  const groupWithRow = (path) =>
    [...container.querySelectorAll('.gmg-group')].find((group) =>
      [...group.querySelectorAll('.gmg-file')].some((file) => (file.getAttribute('title') ?? '').startsWith(path)))

  {
    delayedActions.set('stage', 120)
    const changesGroup = groupWithRow('docs/read me.md')
    const rowStage = [...changesGroup.querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '暂存')
    const rowDiscard = [...changesGroup.querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '删除文件')
    await act(async () => {
      click(rowStage)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    check('an in-flight stage locks its own row', rowStage.disabled === true, rowStage.outerHTML.slice(0, 120))
    check('a second click while in flight cannot queue', (() => {
      const before = calls.filter((call) => call.action === 'stage').length
      click(rowStage)
      return calls.filter((call) => call.action === 'stage').length === before
    })(), 'a disabled button swallows the click')
    check('the neighbouring row keeps working', rowDiscard.disabled === false, rowDiscard.outerHTML.slice(0, 120))
    const stagedRowUnstage = [...container.querySelectorAll('.gmg-group')].find((group) => (group.querySelector('.gmg-group-head')?.textContent ?? '').includes('已暂存'))?.querySelector('.gmg-file .gmg-actions button')
    check('the other group is not locked by this row', stagedRowUnstage?.disabled === false, stagedRowUnstage?.getAttribute('aria-label'))
    await wait(160)
    delayedActions.delete('stage')
    // The answer lands, the row re-renders: judge the button that is in the
    // document now, not the node the click happened on.
    const releasedStage = [...groupWithRow('docs/read me.md').querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '暂存')
    check('the row releases when the work lands', releasedStage?.disabled === false, releasedStage?.outerHTML.slice(0, 120))

    // The group header's bulk action is its own operation: it locks that one
    // button, and leaves every row inside still usable.
    delayedActions.set('stage', 120)
    {
      const bulk = () => groupWithRow('docs/read me.md').querySelector('.gmg-group-head .gmg-icon-btn')
      const rowStage = () => [...groupWithRow('docs/read me.md').querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '暂存')
      await act(async () => {
        click(bulk())
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('a bulk stage locks its own header button', bulk().disabled === true, bulk().outerHTML.slice(0, 120))
      // The bulk action names every change as its target, so a row inside it
      // *should* be locked; the isolation that matters is the other group.
      check('a bulk stage locks the rows it targets', rowStage().disabled === true, rowStage().outerHTML.slice(0, 120))
      const stagedRowButton = [...container.querySelectorAll('.gmg-group')].find((group) => (group.querySelector('.gmg-group-head')?.textContent ?? '').includes('已暂存'))?.querySelector('.gmg-file .gmg-actions button')
      check('a bulk stage leaves the other group pressable', stagedRowButton?.disabled === false, stagedRowButton?.outerHTML?.slice(0, 120))
      await wait(160)
      delayedActions.delete('stage')
      check('the header button releases with the work', bulk().disabled === false, bulk().outerHTML.slice(0, 120))
    }
  }

  // ---- a success notice fades; the panel stays calm ------------------------
  {
    dom.window.confirm = () => true
    const changesGroup = groupWithRow('docs/read me.md')
    const deleteButton = [...changesGroup.querySelectorAll('.gmg-file .gmg-actions button')].find((button) => button.getAttribute('aria-label') === '删除文件')
    await act(async () => {
      click(deleteButton)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const notice = container.querySelector('.gmg-notice.is-ok')
    check('the delete leaves a visible notice', notice !== null, container.querySelector('.gmg-notice')?.textContent)
    await wait(3600)
    check('the notice starts fading on its own', container.querySelector('.gmg-notice.is-ok.is-fading') !== null, container.querySelector('.gmg-notice.is-ok')?.className)
    await wait(400)
    check('the faded notice is gone', container.querySelector('.gmg-notice.is-ok') === null, container.querySelector('.gmg-notice.is-ok')?.textContent)
  }

  // ---- amend brings the whole message back and says what it rewrites -------
  {
    // A notice appearing above the card remounts the card subtree (React shifts
    // unkeyed siblings), so every handle is looked up again right before use
    // instead of being held across a re-render.
    const boxes = () => [...container.querySelectorAll('.gmg-commit-foot .gmg-check input')]
    const stageAllBox = () => boxes()[0]
    const amendBox = () => boxes()[1]
    const textarea = () => container.querySelector('.gmg-textarea')
    const commitButton = () => container.querySelector('.gmg-commit .gmg-btn.is-primary')
    await act(async () => {
      amendBox().click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    check(
      'amend fills subject and body, not just the subject',
      textarea().value.includes('BODY-TAIL') && textarea().value.startsWith('wire the sidebar panel'),
      textarea().value.slice(0, 80),
    )
    check('the preview names the commit it will rewrite', (container.querySelector('.gmg-amend-preview')?.textContent ?? '').includes('将改写 deadbee'), container.querySelector('.gmg-amend-preview')?.textContent)
    await act(async () => {
      setValue(textarea(), 'typed draft')
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    check('the typed draft reached the store', textarea().value === 'typed draft', textarea().value)
    await act(async () => {
      amendBox().click()
      await new Promise((resolve) => setTimeout(resolve, 10))
      amendBox().click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    check('refilling never overwrites what the reader typed', textarea().value === 'typed draft', textarea().value)
    // amend + stage all widens the rewrite; it must ask first.
    await act(async () => {
      stageAllBox().click()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    check('stage all is on for the widen check', stageAllBox().checked === true, boxes().map((box) => box.checked))
    const commitBefore = calls.filter((call) => call.action === 'commit').length
    dom.window.confirm = () => false
    await act(async () => {
      click(commitButton())
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    check('amend with stage all asks before widening the rewrite', calls.filter((call) => call.action === 'commit').length === commitBefore, calls.slice(-4).map((call) => call.action))
    dom.window.confirm = () => true
    await act(async () => {
      click(commitButton())
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const landed = calls.filter((call) => call.action === 'commit').pop()
    check('confirming sends the amend with both flags', landed?.params?.amend === true && landed?.params?.stageAll === true, landed?.params)
    check(
      'a landed commit clears the flags and the draft',
      textarea().value === '' && amendBox().checked === false && stageAllBox().checked === false,
      { message: textarea().value, amend: amendBox().checked, stageAll: stageAllBox().checked },
    )
  }

  // ---- fetch does not need an upstream, and the panel says when it read ----
  {
    statusPayload = NO_UPSTREAM
    const refreshButton = container.querySelector('.gmg-icon-btn[aria-label="刷新"]')
    await act(async () => {
      click(refreshButton)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    check('an unpublished branch says so', (container.querySelector('.gmg-track')?.textContent ?? '').includes('尚未发布'), container.querySelector('.gmg-track')?.textContent)
    const fetchButton = [...container.querySelectorAll('.gmg-branchbar button')].find((button) => button.getAttribute('aria-label') === '获取' || (button.textContent ?? '').includes('获取'))
    check('fetch is pressable without an upstream', fetchButton !== undefined && fetchButton.disabled === false, fetchButton?.outerHTML?.slice(0, 120))
    const fetchBefore = calls.filter((call) => call.action === 'fetch').length
    await act(async () => {
      click(fetchButton)
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    check('fetch reaches the host without one', calls.filter((call) => call.action === 'fetch').length === fetchBefore + 1, calls.slice(-3).map((call) => call.action))
    statusPayload = STATUS
    await act(async () => {
      click(refreshButton)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    check('the header says when the data was last read', (container.querySelector('.gmg-last-sync')?.textContent ?? '').includes('更新于'), container.querySelector('.gmg-last-sync')?.textContent)
  }

  // ---- remounting the panel re-reads at once, not after the poll tick ------
  {
    const logsBefore = calls.filter((call) => call.action === 'log').length
    const remountEl = document.createElement('div')
    document.body.appendChild(remountEl)
    const remountRoot = createRoot(remountEl)
    await act(async () => {
      remountRoot.render(
        React.createElement(panel.component, {
          ...(typeof panel.declaration.inject === 'function' ? panel.declaration.inject() : {}),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    check('a remount re-reads the history without waiting for the tick', calls.filter((call) => call.action === 'log').length > logsBefore, { logsBefore, now: calls.filter((call) => call.action === 'log').length })
    await act(async () => {
      remountRoot.unmount()
    })
    remountEl.remove()
  }

  // ---- switching repositories wipes the other repository's draft ------------
  {
    const textarea = container.querySelector('.gmg-textarea')
    const [stageAllBox, amendBox] = container.querySelectorAll('.gmg-commit-foot .gmg-check input')
    await act(async () => {
      setValue(textarea, 'wip: A')
    })
    await act(async () => {
      stageAllBox.click()
      amendBox.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const select = container.querySelector('.gmg-select')
    await act(async () => {
      setValue(select, 'C:/other')
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    check('the draft does not follow into the other repository', container.querySelector('.gmg-textarea').value === '', container.querySelector('.gmg-textarea').value)
    const boxesAfter = [...container.querySelectorAll('.gmg-commit-foot .gmg-check input')]
    check('stage-all and amend do not survive the switch either', boxesAfter[0].checked === false && boxesAfter[1].checked === false, boxesAfter.map((box) => box.checked))
    await act(async () => {
      setValue(container.querySelector('.gmg-textarea'), 'wip: B')
    })
    const commitButton = container.querySelector('.gmg-commit .gmg-btn.is-primary')
    await act(async () => {
      click(commitButton)
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    const crossCommit = calls.filter((call) => call.action === 'commit').pop()
    check('repo B commits without repo A’s stage-all (no cross-repo add -A)', crossCommit?.params?.path === 'C:/other' && crossCommit?.params?.message === 'wip: B' && crossCommit?.params?.stageAll === false && crossCommit?.params?.amend === false, crossCommit?.params)
    const selectAgain = container.querySelector('.gmg-select')
    await act(async () => {
      setValue(selectAgain, 'C:/demo')
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
  }

  // ---- the token lives in memory only and rides only on github calls --------
  {
    githubAuthorized = false
    const select = container.querySelector('.gmg-select')
    await act(async () => {
      setValue(select, 'C:/other')
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    const tokenInput = container.querySelector('.gmg-gh input[type="password"]')
    check('an unauthorised card opens the token editor', tokenInput !== null, container.querySelector('.gmg-gh')?.textContent?.slice(0, 200))
    const githubBefore = calls.filter((call) => call.action === 'github').length
    await act(async () => {
      setValue(tokenInput, 'ghp_test_123')
    })
    const saveButton = [...container.querySelectorAll('.gmg-gh button')].find((button) => (button.textContent ?? '').includes('保存'))
    await act(async () => {
      click(saveButton)
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    const savedCalls = calls.filter((call) => call.action === 'github').slice(githubBefore)
    check('saving sends the token to the github action', savedCalls.some((call) => call.token === 'ghp_test_123'), savedCalls.map((call) => call.token))
    check('no other action ever carries it', calls.every((call) => call.action === 'github' || call.token === null), calls.filter((call) => call.token !== null).map((call) => call.action))
    check('the token never reaches localStorage', dom.window.localStorage.getItem('dsh-git-management/github-token') === null, dom.window.localStorage.getItem('dsh-git-management/github-token'))
    githubAuthorized = true
    await act(async () => {
      const backHome = container.querySelector('.gmg-select')
      setValue(backHome, 'C:/demo')
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
  }

  // ---- W2-2 client half: the commit box follows git's own state machine ---
  {
    const textarea = () => container.querySelector('.gmg-textarea')
    const commitButton = () => container.querySelector('.gmg-commit .gmg-btn.is-primary')
    const footHint = () => container.querySelector('.gmg-commit-foot .gmg-hint')
    const refresh = async () => {
      await act(async () => {
        click(container.querySelector('.gmg-icon-btn[aria-label="刷新"]'))
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
    }
    const commitCount = () => calls.filter((call) => call.action === 'commit').length

    // A merge that has no conflicts left is finished *by* the commit, so the
    // button has to stay live and say so.
    statusPayload = { ...STATUS, operation: 'merge' }
    await refresh()
    await act(async () => {
      setValue(textarea(), '完成合并')
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    check('a merge without conflicts keeps commit pressable', commitButton().disabled === false, commitButton().outerHTML.slice(0, 140))
    check('the commit box says this commit finishes the merge', (footHint()?.textContent ?? '').includes('合并进行中'), footHint()?.textContent)
    const beforeMergeCommit = commitCount()
    commitSideEffect = () => {
      // git records the merge commit: the sentinel disappears.
      statusPayload = STATUS
    }
    await act(async () => {
      click(commitButton())
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    commitSideEffect = null
    const mergeCommit = calls.filter((call) => call.action === 'commit').pop()
    check('the merge commit is the plain commit the host expects', commitCount() === beforeMergeCommit + 1 && mergeCommit?.params?.amend === false && mergeCommit?.params?.message === '完成合并', mergeCommit?.params)
    check('once the merge lands the merge hint is gone', (footHint()?.textContent ?? '').includes('合并进行中') === false, footHint()?.textContent)

    // Rebase and cherry-pick belong to the sequencer: git owns the next commit.
    for (const [operation, terminal] of [['rebase', 'git rebase --continue'], ['cherry-pick', 'git cherry-pick --continue']]) {
      statusPayload = { ...STATUS, operation }
      await refresh()
      await act(async () => {
        setValue(textarea(), `wip during ${operation}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      const before = commitCount()
      check(`commit stays disabled during ${operation}`, commitButton().disabled === true, commitButton().outerHTML.slice(0, 140))
      check(`the ${operation} hint names the terminal command`, (footHint()?.textContent ?? '').includes(terminal), footHint()?.textContent)
      dom.window.confirm = () => true
      await act(async () => {
        click(commitButton())
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check(`a disabled commit sends nothing during ${operation}`, commitCount() === before, calls.slice(-3).map((call) => call.action))
    }

    // A pull that stops on conflicts is a 200, not an error: the panel must
    // warn, not celebrate, and must put the conflicts in front of the reader.
    statusPayload = { ...CONFLICTED, operation: 'merge' }
    pullResult = { summary: 'Auto-merging src/clash.ts\nCONFLICT (content): Merge conflict in src/clash.ts', mode: 'merge', conflicts: true }
    await refresh()
    await act(async () => {
      const pullButton = [...container.querySelectorAll('.gmg-branchbar button')].find((button) => (button.textContent ?? '').startsWith('拉取'))
      click(pullButton)
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    const warning = container.querySelector('.gmg-notice.is-warn')
    check('a conflicted pull warns instead of reporting success', warning !== null && (warning.textContent ?? '').includes('合併衝突'), container.querySelector('.gmg-notice')?.textContent)
    check('no success notice is raised for a conflicted pull', container.querySelector('.gmg-notice.is-ok') === null, container.querySelector('.gmg-notice.is-ok')?.textContent)
    check('the raw git summary is not passed off as the outcome', (container.textContent ?? '').includes('Auto-merging src/clash.ts') === false, warning?.textContent)
    const conflictGroup = container.querySelector('.gmg-group.gmg-conflict')
    check('the conflicts group is present and unfolded', conflictGroup !== null && conflictGroup.classList.contains('is-collapsed') === false, conflictGroup?.className)
    pullResult = null
    statusPayload = STATUS
    await refresh()
  }

  // ---- W2-2/W2-3 client half: menus, bare, stash, and readable failures ----
  {
    const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    const wait = async (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    const setValue = (element, value) => {
      const proto =
        element.tagName === 'TEXTAREA'
          ? dom.window.HTMLTextAreaElement.prototype
          : element.tagName === 'SELECT'
            ? dom.window.HTMLSelectElement.prototype
            : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
      if (element.tagName === 'SELECT') element.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      else Simulate.change(element)
    }
    const refresh = async () => {
      await act(async () => {
        click(container.querySelector('.gmg-icon-btn[aria-label="刷新"]'))
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
    }
    const errorNotice = () => container.querySelector('.gmg-notice.is-error')
    const errorButton = (label) => [...(errorNotice()?.querySelectorAll('button') ?? [])].find((button) => (button.textContent ?? '') === label)
    const dismissError = async () => {
      await act(async () => {
        click(errorNotice().querySelector('.gmg-icon-btn'))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
    const openMenu = async (selector) => {
      await act(async () => {
        click(container.querySelector(selector))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      return document.body.querySelector('.gmg-moremenu')
    }

    // ---- S13: a failure keeps its code, its command, and its next step -----
    {
      const cardBefore = container.querySelector('.gmg-commit')
      failures.set('commit', {
        status: 409,
        body: {
          ok: false,
          code: 'non-fast-forward',
          error: 'upstream moved: cannot fast-forward',
          details: { argv: ['git', 'commit', '-m', 'fix the build'], exitCode: 1, stderr: ' ! [rejected] main -> main (fetch first)\nfatal: could not push' },
        },
      })
      await act(async () => {
        setValue(container.querySelector('.gmg-textarea'), 'fix the build')
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      await act(async () => {
        click(container.querySelector('.gmg-commit .gmg-btn.is-primary'))
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      failures.delete('commit')
      check('a failure reaches the panel as a sticky error line', errorNotice() !== null && (errorNotice().textContent ?? '').includes('upstream moved'), errorNotice()?.textContent?.slice(0, 120))
      check('the stable code picks a one-line next step', (errorNotice()?.querySelector('.gmg-err-next')?.textContent ?? '').includes('同步（合併）'), errorNotice()?.querySelector('.gmg-err-next')?.textContent)
      check('the command tail starts folded', errorNotice()?.querySelector('.gmg-err-details') === null)
      // The approved reconciliation fix: a notice must not remount the card.
      check('a notice does not remount the card below it', cardBefore !== null && cardBefore.isConnected === true && cardBefore === container.querySelector('.gmg-commit'), { connected: cardBefore?.isConnected, same: cardBefore === container.querySelector('.gmg-commit') })

      await act(async () => {
        click(errorButton('詳情'))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const details = errorNotice()?.querySelector('.gmg-err-details')
      check('details open the git command', (details?.querySelector('.gmg-err-argv')?.textContent ?? '').includes('git commit -m fix the build'), details?.querySelector('.gmg-err-argv')?.textContent)
      check('details keep the stderr tail', (details?.querySelector('.gmg-err-stderr')?.textContent ?? '').includes('fatal: could not push'), details?.querySelector('.gmg-err-stderr')?.textContent)
      check('the exit code is named', (details?.textContent ?? '').includes('退出碼 1'), details?.textContent)
      check('the toggle reports its state', errorButton('收起')?.getAttribute('aria-expanded') === 'true', errorButton('收起')?.getAttribute('aria-expanded'))

      const copiedTexts = []
      Object.defineProperty(dom.window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value) => { copiedTexts.push(String(value)) } },
      })
      await act(async () => {
        click(errorButton('複製診斷'))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('copy takes the command and the stderr', copiedTexts.some((text) => text.includes('git commit -m fix the build') && text.includes('fatal: could not push') && text.includes('code: non-fast-forward')), copiedTexts)
      check('the copy button answers', (errorButton('已複製')?.textContent ?? '') === '已複製')

      await act(async () => {
        click(errorButton('收起'))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('details fold away again', errorNotice()?.querySelector('.gmg-err-details') === null)

      // An error is sticky: only success notices fade (QA-E2).
      await wait(3800)
      check('an error never fades on its own', errorNotice() !== null && errorNotice().classList.contains('is-fading') === false, errorNotice()?.className)
      await dismissError()
      check('dismissing clears the failure', errorNotice() === null)
    }

    // ---- S13 shape cases: a dirty worktree and a hook --------------------
    {
      failures.set('switch', {
        status: 400,
        body: {
          ok: false,
          code: 'git-error',
          error: 'Your local changes would be overwritten by switch',
          details: { argv: ['git', 'switch', 'dev'], exitCode: 1, stderr: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/App.tsx' },
        },
      })
      await act(async () => {
        click(container.querySelector('.gmg-branch'))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const devItem = [...document.body.querySelectorAll('.gmg-branchitem')].find((item) => item.textContent === 'dev')
      await act(async () => {
        click(devItem)
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      failures.delete('switch')
      check('a refused switch explains the dirty worktree', (errorNotice()?.querySelector('.gmg-err-next')?.textContent ?? '').includes('先提交或貯藏'), errorNotice()?.querySelector('.gmg-err-next')?.textContent)
      await dismissError()

      failures.set('commit', {
        status: 400,
        body: {
          ok: false,
          code: 'git-error',
          error: 'pre-commit hook failed',
          details: { argv: ['git', 'commit', '-m', 'fix the build'], exitCode: 1, stderr: 'husky - pre-commit hook exited with code 1' },
        },
      })
      await act(async () => {
        click(container.querySelector('.gmg-commit .gmg-btn.is-primary'))
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      failures.delete('commit')
      check('a rejected commit points at the hook', (errorNotice()?.querySelector('.gmg-err-next')?.textContent ?? '').includes('git hook'), errorNotice()?.querySelector('.gmg-err-next')?.textContent)
      await dismissError()

      // K16: a page newer than the host process gets a name for that, not a
      // generic "unknown action" that sends the reader to reload the page.
      failures.set('commit', {
        status: 404,
        body: { ok: false, code: 'unknown-action', error: 'unknown action: commit' },
      })
      await act(async () => {
        click(container.querySelector('.gmg-commit .gmg-btn.is-primary'))
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
      failures.delete('commit')
      check('an unknown action blames the un-restarted host', (errorNotice()?.querySelector('.gmg-err-next')?.textContent ?? '').includes('host 尚未重啟'), errorNotice()?.querySelector('.gmg-err-next')?.textContent)
      await dismissError()
    }

    // ---- S8: a bare repository says read-only and offers no write UI ------
    {
      statusPayload = BARE
      await refresh()
      check('the header marks the bare repository', container.querySelector('.gmg-bare')?.textContent === '唯讀（bare）', container.querySelector('.gmg-bare')?.textContent)
      check('no commit box is offered in a bare repository', container.querySelector('.gmg-commit') === null, container.querySelector('.gmg-commit')?.outerHTML?.slice(0, 80))
      check('the bare note says why nothing can be committed', (container.textContent ?? '').includes('沒有工作樹'), container.querySelector('.gmg-bare-note')?.textContent)
      const bareFetch = [...container.querySelectorAll('.gmg-branchbar button')].find((button) => (button.textContent ?? '').startsWith('获取'))
      check('fetch still works in a bare repository', bareFetch?.disabled === false, bareFetch?.outerHTML?.slice(0, 120))
      const barePull = [...container.querySelectorAll('.gmg-branchbar button')].find((button) => (button.textContent ?? '').startsWith('拉取'))
      check('pull is refused up front in a bare repository', barePull?.disabled === true, barePull?.outerHTML?.slice(0, 120))
      check('the stash menu is not offered in a bare repository', container.querySelector('.gmg-stash-menu')?.disabled === true, container.querySelector('.gmg-stash-menu')?.outerHTML?.slice(0, 120))
      statusPayload = STATUS
      await refresh()
    }

    // ---- S10: a diverged branch offers fast-forward and merge -------------
    {
      // STATUS is ahead 2 / behind 1: the state where `--ff-only` is a dead end.
      check('a diverged branch offers a pull-strategy menu', container.querySelector('.gmg-pull-more')?.getAttribute('aria-haspopup') === 'menu')
      const pullsBefore = calls.filter((call) => call.action === 'pull').length
      await act(async () => {
        const pull = [...container.querySelectorAll('.gmg-branchbar button')].find((button) => (button.textContent ?? '').startsWith('拉取'))
        click(pull)
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      check('the plain Pull still asks for fast-forward', calls.filter((call) => call.action === 'pull').pop()?.params?.mode === 'ff', calls.filter((call) => call.action === 'pull').pop()?.params)
      const menu = await openMenu('.gmg-pull-more')
      check('the strategy menu is a menuitem list', menu?.getAttribute('role') === 'menu' && menu.querySelectorAll('.gmg-moreitem').length === 2, menu?.outerHTML?.slice(0, 160))
      check('the menu names both strategies', (menu?.querySelectorAll('.gmg-moreitem-name')[0]?.textContent ?? '') === '快進合併' && (menu?.querySelectorAll('.gmg-moreitem-name')[1]?.textContent ?? '') === '同步（合併）', [...(menu?.querySelectorAll('.gmg-moreitem-name') ?? [])].map((node) => node.textContent))
      await act(async () => {
        click(menu.querySelectorAll('.gmg-moreitem')[1])
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
      check('picking merge sends the merge mode', calls.filter((call) => call.action === 'pull').pop()?.params?.mode === 'merge', calls.filter((call) => call.action === 'pull').pop()?.params)
      check('picking closes the menu', document.body.querySelector('.gmg-moremenu') === null)
      check('both strategies are distinct pull calls', calls.filter((call) => call.action === 'pull').length === pullsBefore + 2)
    }

    // ---- S11: stash lives in one ⋯ menu, counts, and lands conflicts ------
    {
      stashHost.count = 1
      stashHost.popConflicts = false
      check(
        'stash has no resident button, only the ⋯ trigger',
        container.querySelectorAll('.gmg-branchbar .gmg-stash-menu').length === 1 && [...container.querySelectorAll('.gmg-branchbar button')].some((button) => (button.textContent ?? '').includes('貯藏')) === false,
        [...container.querySelectorAll('.gmg-branchbar button')].map((button) => button.textContent),
      )
      let menu = await openMenu('.gmg-stash-menu')
      check('the stash menu holds push and pop', menu?.querySelectorAll('.gmg-moreitem').length === 2, menu?.textContent)
      check('pop shows how many entries exist', (menu?.querySelector('.gmg-stashcount')?.textContent ?? '') === '1', menu?.querySelector('.gmg-stashcount')?.textContent)
      check('the menu items use the shared action classes', menu?.querySelectorAll('.gmg-moreitem[role="menuitem"]').length === 2)

      dom.window.prompt = () => 'wip: 貯藏'
      await act(async () => {
        click(menu.querySelectorAll('.gmg-moreitem')[0])
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      const pushed = calls.filter((call) => call.action === 'stash' && call.params?.op === 'push').pop()
      check('push asks for a message and sends it', pushed?.params?.message === 'wip: 貯藏', pushed?.params)
      check('push refreshes the count from the host', stashHost.count === 2)

      menu = await openMenu('.gmg-stash-menu')
      check('the reopened menu shows the new count', (menu?.querySelector('.gmg-stashcount')?.textContent ?? '') === '2', menu?.querySelector('.gmg-stashcount')?.textContent)
      await act(async () => {
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      check('Escape closes the actions menu', document.body.querySelector('.gmg-moremenu') === null)

      // A pop that stops on conflicts is a state, not a failure.
      stashHost.popConflicts = true
      statusPayload = { ...CONFLICTED, operation: 'merge' }
      menu = await openMenu('.gmg-stash-menu')
      await act(async () => {
        click(menu.querySelectorAll('.gmg-moreitem')[1])
        await new Promise((resolve) => setTimeout(resolve, 120))
      })
      const warning = container.querySelector('.gmg-notice.is-warn')
      check('a conflicted pop warns instead of reporting success', (warning?.textContent ?? '').includes('貯藏'), warning?.textContent)
      check('a conflicted pop raises no success notice', container.querySelector('.gmg-notice.is-ok') === null)
      check('a conflicted pop lands the conflicts group', container.querySelector('.gmg-group.gmg-conflict') !== null)
      check('a conflicted pop takes the count to zero', stashHost.count === 0)

      stashHost.popConflicts = false
      statusPayload = STATUS
      await refresh()
      const notify = container.querySelector('.gmg-notice.is-warn')
      if (notify !== null) {
        await act(async () => {
          click(notify.querySelector('.gmg-icon-btn'))
          await new Promise((resolve) => setTimeout(resolve, 20))
        })
      }
    }

    // ---- S16: a failed diff offers a retry instead of a dead end ----------
    {
      const diffRegistration = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab' && entry.declaration.key === 'dsh-git-diff')
      failures.set('diff', {
        status: 400,
        body: {
          ok: false,
          code: 'git-error',
          error: 'fatal: bad object',
          details: { argv: ['git', 'diff', '--', 'src/App.tsx'], exitCode: 128, stderr: 'fatal: bad object' },
        },
      })
      const retryHost = document.createElement('div')
      document.body.appendChild(retryHost)
      const retryRoot = createRoot(retryHost)
      const params = { path: 'C:/demo', file: 'src/App.tsx', staged: true, status: 'M' }
      await act(async () => {
        retryRoot.render(
          React.createElement(diffRegistration.component, {
            ...diffRegistration.declaration.inject(),
            actions: { close: () => {} },
            useTabInfo: () => ({ tab: { id: 'tab-retry', navigation: { params, revision: 1 } } }),
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      failures.delete('diff')
      check('a failed diff says what broke', (retryHost.textContent ?? '').includes('fatal: bad object'), retryHost.textContent?.slice(0, 120))
      const retry = [...retryHost.querySelectorAll('.gmg-cdiff-failure button')].find((button) => (button.textContent ?? '') === '重試')
      check('the failure offers a retry in the same shape as the commit tab', retry !== undefined && retry.classList.contains('is-ghost'), retryHost.querySelector('.gmg-cdiff-failure')?.innerHTML?.slice(0, 160))
      await act(async () => {
        click(retry)
        await new Promise((resolve) => setTimeout(resolve, 80))
      })
      check('retrying draws the diff', retryHost.querySelector('.gmg-diff-cell.is-add') !== null && retryHost.querySelector('.gmg-cdiff-failure') === null, retryHost.innerHTML.slice(0, 160))
      await act(async () => {
        retryRoot.unmount()
      })
      retryHost.remove()
    }
  }

  // ---- W2-4/S22: the focus rings and contrast fixes design shipped ---------
  {
    const css = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
    check('the repository picker shows a focus ring', /\.gmg-select:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--dsw-alias-brand-primary\)/.test(css), css.match(/\.gmg-select:focus-visible[^}]*/)?.[0])
    check('the github tabs joined the focus-ring whitelist', /\.gmg-gh-tab:focus-visible/.test(css), css.match(/:focus-visible/g)?.length)
    check('the fold arrow ring moved to the brand hue', /\.gmg-collapse:focus-visible\s*\{[^}]*--dsw-alias-brand-primary/.test(css), css.match(/\.gmg-collapse:focus-visible[^}]*/)?.[0])
    check('text inputs glow like the textarea on focus', /\.gmg-input:focus(-visible)?\s*\{[^}]*box-shadow:[^}]*color-mix[^}]*22%/.test(css), css.match(/\.gmg-input:focus[^}]*/)?.[0])
    check('the light theme deepens the tag chip', /prefers-color-scheme:\s*light[\s\S]*--gmg-tag:\s*#92400e/i.test(css), css.match(/--gmg-tag:[^;]*/g))
    check('the detached badge reads the tag token', /\.gmg-ref\.is-detached\s*\{[^}]*var\(--gmg-tag\)/.test(css), css.match(/\.gmg-ref\.is-detached[^}]*/)?.[0])
    check('side-by-side scrolls to the line end instead of cutting', /\.gmg-diffbody\.is-split\s*\{[^}]*min-width:\s*max-content/.test(css), css.match(/\.gmg-diffbody\.is-split[^}]*/)?.[0])
    check('split rows get max-content text tracks', /\.gmg-diffrow\.is-splitrow\s*\{[^}]*grid-template-columns:[^;]*minmax\(\s*max-content,\s*1fr\)/.test(css), css.match(/\.gmg-diffrow\.is-splitrow[^}]*\}/g)?.[0])
    check('the compact breakpoint keeps a 34px gutter track', /is-compact[^@]*?\.gmg-diffrow\.is-splitrow\s*\{[^}]*34px/.test(css) || /is-compact[\s\S]{0,400}?34px/.test(css), css.match(/is-compact[\s\S]{0,300}/g)?.slice(0, 2))

    // The JS half of W2-4 leans on these four rules: the fade the notice
    // removal rides on, the warn tone a conflicted pull uses, the compact
    // quick-links row, and the clipped “updated …” label.
    check('the notice fade transition is present for transitionend', /\.gmg-notice\.is-fading\s*\{[^}]*transition:\s*opacity/.test(css), css.match(/\.gmg-notice\.is-fading[^}]*/)?.[0])
    check('the warning notice reads the warn state token', /\.gmg-notice\.is-warn\s*\{[^}]*var\(--dsw-alias-state-warn-primary\)/.test(css), css.match(/\.gmg-notice\.is-warn[^}]*/)?.[0])
    check('the warning notice stays pinned like the other tones', /\.gmg-notice\.is-error,\s*\.gmg-notice\.is-warn,\s*\.gmg-notice\.is-ok\s*\{[^}]*position:\s*sticky/.test(css), css.match(/\.gmg-notice\.is-error,\s*\.gmg-notice\.is-warn[^}]*/)?.[0])
    check('the quick-link buttons stay 22px so the card does not grow', /\.gmg-quicklinks\s+\.gmg-icon-btn\s*\{[^}]*width:\s*22px[^}]*height:\s*22px/.test(css), css.match(/\.gmg-quicklinks\s+\.gmg-icon-btn[^}]*/)?.[0])
    check('the quick-link row never squeezes the commit subject', /\.gmg-quicklinks\s*\{[^}]*flex:\s*none/.test(css), css.match(/\.gmg-quicklinks\s*\{[^}]*/)?.[0])
    check('the sync label yields before the repo picker', /\.gmg-last-sync\s*\{[^}]*max-width:\s*110px/.test(css), css.match(/\.gmg-last-sync[^}]*/)?.[0])
    check('the menu trigger is a 24px ghost square, 22px compact', /\.gmg-morebtn\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/.test(css) && /is-compact[^{]*\.gmg-morebtn\s*\{[^}]*22px/.test(css), css.match(/\.gmg-morebtn\s*\{[^}]*/)?.[0])
    check('the notice wraps so a details row can take the full width', /\.gmg-notice\s*\{[^}]*flex-wrap:\s*wrap/.test(css), css.match(/\.gmg-notice\s*\{[^}]*/)?.[0])
    check('the details block takes the notice width and scrolls', /\.gmg-err-details\s*\{[^}]*flex-basis:\s*100%[^}]*max-height:\s*160px/.test(css), css.match(/\.gmg-err-details[^}]*/)?.[0])
    check('the bare badge reads the warn state token', /\.gmg-bare\s*\{[^}]*var\(--dsw-alias-state-warn-primary\)/.test(css), css.match(/\.gmg-bare[^}]*/)?.[0])
    check('a disabled menu item reads as unavailable', /\.gmg-moreitem\[aria-disabled="true"\]\s*\{[^}]*opacity/.test(css), css.match(/\.gmg-moreitem\[aria-disabled[^}]*/)?.[0])
  }
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
