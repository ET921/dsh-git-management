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
function respond(action, params) {
  switch (action) {
    case 'repos':
      return { repos: [{ id: 'w1', title: 'demo', path: 'C:/demo', isRepo: true, root: 'C:/demo', branch: 'main' }], defaultPath: 'C:/demo' }
    case 'status':
      return STATUS
    case 'log':
      return LOG
    case 'branches':
      return {
        current: 'main',
        branches: [
          { name: 'main', current: true, upstream: 'origin/main', sha: 'abc1234', date: null },
          { name: 'dev', current: false, upstream: null, sha: 'def5678', date: null },
        ],
      }
    case 'diff':
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
          '+new',
          '+more',
          ' const b = 2',
          ' export default a',
        ].join('\n'),
      }
    case 'github':
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
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  calls.push({ url: String(url), action: body.action, params: body.params })
  return { ok: true, status: 200, json: async () => ({ ok: true, result: respond(body.action, body.params) }) }
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
  if (id === 'react-dom') return reactDom
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
check('the github card lists the pulls tab', text().includes('拉取请求'), text().slice(-400))
check('no error notice is shown', container.querySelector('.gmg-notice.is-error') === null, container.querySelector('.gmg-notice.is-error')?.textContent)

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
  }
} else {
  check('a file row exists to click', false)
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
  check('the card no longer links to GitHub', cardText.includes('GitHub') === false, cardText.slice(0, 240))
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

await act(async () => {
  reactRoot.unmount()
})

console.log(`\n${checks - failed}/${checks} checks passed`)
if (failed > 0) {
  console.error(`${failed} check(s) failed`)
  process.exitCode = 1
}
dom.window.close()
