/**
 * dsh-git-management — Graph geometry/colour parity check (scripts/qa/graph-parity.mjs)
 *
 * Pins the per-row commit graph to the Cursor / VS Code 1.128 numbers mined in
 * `docs/research/cursor-graph-spec.md`: 22px rows on an 11px lane grid, the
 * six path shapes with their `A 11 11` / `A 5 5` arcs, the three node forms
 * (plain r5, merge r6+r3, current r7+inner r2), the five lane colours and the
 * three ref colours. The expectations here are computed by an INDEPENDENT
 * swimlane walker written from the spec (§1, §3.1, §4), not by importing the
 * implementation, so a drift in `16-graph.js` fails this file.
 *
 * Fixture: 13 rows, 5 branches (main, dev, hotfix + release/topic remotes),
 * 3 merges, a four-lane stretch, a lane-closing elbow, a hollow current ring
 * and a tagged root — enough that every path shape in the spec is drawn.
 *
 * Run: `node scripts/qa/graph-parity.mjs`   (needs `node scripts/build.mjs`
 * first — it loads `lib/client.js` like the browser does)
 *
 * @module dsh-git-management/scripts/qa/graph-parity
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

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let checks = 0
let failed = 0
const notes = []

/**
 * Assert one parity fact.
 * @param label - what is being checked (spec id + semantics).
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

// ---- spec constants (docs/research/cursor-graph-spec.md §1) ---------------

/** §1.1 — fxr / q6 / jMt / BQi / UQi */
const SPEC = {
  rowHeight: 22,
  laneWidth: 11,
  elbowRadius: 5,
  nodeBase: 4,
  nodeStroke: 2,
}

/** §1.2 — scmGraph.foreground1..5, order is part of the contract. */
const LANE_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']

/** §1.3 — head/remote/base ref colours (dark theme). */
const REF_COLORS = { head: '#3794FF', remote: '#B180D7', tag: '#EA5C00' }

/** Every colour a node fill or lane stroke may legally carry. */
const ALLOWED_COLORS = new Set([...LANE_COLORS, ...Object.values(REF_COLORS)])

/** §Cursor badge order (bundle `_renderBadges`): the REF_RANK of the graph module. */
const REF_RANK = { head: 0, remote: 1, branch: 2, tag: 2, detached: 3 }

// ---- fixture: 12 rows, 3 merges, 4 lanes, elbows, converges, forks -------

/**
 * Topo order (every parent below its children):
 *
 *   m1    ← HEAD main, published origin/main                  (current row)
 *   m2    ← merge of m3 + f2                                  (fork arc)
 *   m3      main work
 *   m4    ← merge of m5 + r2                                  (fork arc)
 *   m5      main line → b1
 *   f2      topic work → b1                                   (second b1 lane)
 *   b1    ← dev, origin/dev; two b1 lanes converge, the
 *           release lane passes after them                    (elbow A 5 5)
 *   r2      origin/release line → t
 *   hot     hotfix work → t                                   (mints a lane)
 *   b2    ← merge of side + t                                 (fork arc)
 *   side    origin/topic → t
 *   t       tag v1.0.0; four t lanes converge                 (arcs A 11 11)
 *   base    initial import (root)
 */
const COMMITS = [
  { sha: 'm1', parents: ['m2'], refs: ['HEAD -> main', 'origin/main'], subject: 'sync main with release' },
  { sha: 'm2', parents: ['m3', 'f2'], refs: [], subject: 'release merge' },
  { sha: 'm3', parents: ['m4'], refs: [], subject: 'main work' },
  { sha: 'm4', parents: ['m5', 'r2'], refs: [], subject: 'feature merge' },
  { sha: 'm5', parents: ['b1'], refs: [], subject: 'main line' },
  { sha: 'f2', parents: ['b1'], refs: [], subject: 'topic work' },
  { sha: 'b1', parents: ['b2'], refs: ['dev', 'origin/dev'], subject: 'dev integrate' },
  { sha: 'r2', parents: ['t'], refs: ['origin/release'], subject: 'release work' },
  { sha: 'hot', parents: ['t'], refs: ['hotfix'], subject: 'hotfix work' },
  { sha: 'b2', parents: ['side', 't'], refs: [], subject: 'dev merge' },
  { sha: 'side', parents: ['t'], refs: ['origin/topic'], subject: 'topic shared' },
  { sha: 't', parents: ['base'], refs: ['tag: v1.0.0'], subject: 'shared base' },
  { sha: 'base', parents: [], refs: [], subject: 'initial import' },
]

const LOCAL_BRANCHES = new Set(['main', 'dev', 'hotfix'])

/**
 * Kind of one decoration, mirroring git's `%D` grammar (and `historyRefs`).
 * @returns one of head/tag/branch/remote.
 */
function refKind(decoration) {
  if (decoration.startsWith('HEAD -> ')) return { name: decoration.slice(8), kind: 'head' }
  if (decoration.startsWith('tag: ')) return { name: decoration.slice(5), kind: 'tag' }
  return { name: decoration, kind: LOCAL_BRANCHES.has(decoration) ? 'branch' : 'remote' }
}

// ---- the independent swimlane walker (spec §1.1 + §3.1) ------------------

/**
 * Recompute every row the way the spec describes, without importing the
 * implementation: lane ids, colours, width, node lane, and the exact d-strings
 * of all six path shapes.
 * @returns one expectation per commit, top to bottom.
 */
function expectRows() {
  const bySha = new Map(COMMITS.map((c) => [c.sha, c]))
  const refColorOf = (commit) => {
    for (const d of commit?.refs ?? []) {
      const ref = refKind(d)
      if (REF_COLORS[ref.kind]) return REF_COLORS[ref.kind]
    }
    return null
  }
  const laneX = (i) => SPEC.laneWidth * (i + 1)

  const rows = []
  let paletteCursor = -1
  let previous = []
  const next = () => {
    paletteCursor = (paletteCursor + 1) % LANE_COLORS.length
    return LANE_COLORS[paletteCursor]
  }

  for (const commit of COMMITS) {
    const input = previous.map((lane) => ({ ...lane }))
    const output = []
    const P = commit.parents
    const l = input.findIndex((lane) => lane.id === commit.sha)
    const nodeLane = l === -1 ? input.length : l

    // output walk (spec §layout): commit lane hands over to the first parent,
    // extra waiting lanes are consumed (they converge here), the rest pass.
    for (let index = 0; index < input.length; index += 1) {
      const lane = input[index]
      if (lane.id === commit.sha) {
        if (index === l && P.length > 0) {
          output.push({ id: P[0], color: refColorOf(commit) ?? lane.color })
        }
      } else {
        output.push(lane)
      }
    }
    const start = l === -1 ? 0 : 1
    for (let i = start; i < P.length; i += 1) {
      const claimed = i === 0 ? refColorOf(commit) : refColorOf(bySha.get(P[i]))
      output.push({ id: P[i], color: claimed ?? next() })
    }

    const nodeColor = nodeLane < output.length
      ? output[nodeLane].color
      : nodeLane < input.length
        ? input[nodeLane].color
        : REF_COLORS.head

    // path walk (spec §3.1 (a)-(f)), building the exact d-strings.
    const paths = []
    let u = 0
    for (let d = 0; d < input.length; d += 1) {
      const lane = input[d]
      if (lane.id === commit.sha) {
        if (d !== nodeLane) {
          paths.push({ d: `M ${laneX(d)} 0 A ${SPEC.laneWidth} ${SPEC.laneWidth} 0 0 1 ${laneX(d) - SPEC.laneWidth} ${SPEC.rowHeight / 2} H ${laneX(nodeLane)}`, stroke: lane.color })
        } else if (P.length > 0) {
          u += 1
        }
      } else if (u < output.length && lane.id === output[u].id) {
        if (d === u) {
          paths.push({ d: `M ${laneX(d)} 0 V ${SPEC.rowHeight}`, stroke: lane.color })
        } else {
          const e = SPEC.elbowRadius
          paths.push({ d: `M ${laneX(d)} 0 V ${SPEC.rowHeight / 2 - e} A ${e} ${e} 0 0 1 ${laneX(d) - e} ${SPEC.rowHeight / 2} H ${laneX(u) + e} A ${e} ${e} 0 0 0 ${laneX(u)} ${SPEC.rowHeight / 2 + e} V ${SPEC.rowHeight}`, stroke: lane.color })
        }
        u += 1
      }
    }
    for (let i = 1; i < P.length; i += 1) {
      let p = -1
      for (let idx = output.length - 1; idx >= 0; idx -= 1) {
        if (output[idx].id === P[i]) { p = idx; break }
      }
      if (p < 0) continue
      paths.push({ d: `M ${laneX(p) - SPEC.laneWidth} ${SPEC.rowHeight / 2} A ${SPEC.laneWidth} ${SPEC.laneWidth} 0 0 1 ${laneX(p)} ${SPEC.rowHeight} M ${laneX(p) - SPEC.laneWidth} ${SPEC.rowHeight / 2} H ${laneX(nodeLane)}`, stroke: output[p].color })
    }
    if (nodeLane < input.length) {
      paths.push({ d: `M ${laneX(nodeLane)} 0 V ${SPEC.rowHeight / 2}`, stroke: input[nodeLane].color })
    }
    if (P.length > 0) {
      paths.push({ d: `M ${laneX(nodeLane)} ${SPEC.rowHeight / 2} V ${SPEC.rowHeight}`, stroke: nodeColor })
    }

    // nodes (spec §4.1): current = ring + inner dot, merge = double ring,
    // plain = single. The current row is the one HEAD decorates.
    const isCurrent = commit.refs.some((dd) => dd.startsWith('HEAD -> '))
    let nodes
    if (isCurrent) {
      nodes = [
        { r: SPEC.nodeBase + 3, strokeWidth: SPEC.nodeStroke, fill: nodeColor },
        { r: SPEC.nodeStroke, strokeWidth: SPEC.nodeBase, fill: null },
      ]
    } else if (P.length > 1) {
      nodes = [
        { r: SPEC.nodeBase + 2, strokeWidth: SPEC.nodeStroke, fill: nodeColor },
        { r: SPEC.nodeBase - 1, strokeWidth: SPEC.nodeStroke, fill: nodeColor },
      ]
    } else {
      nodes = [{ r: SPEC.nodeBase + 1, strokeWidth: SPEC.nodeStroke, fill: nodeColor }]
    }

    const width = SPEC.laneWidth * (Math.max(input.length, output.length, 1) + 1)

    // badges (Cursor `_renderBadges` via REF_RANK): lead named, the rest
    // collapse to icon-only chips grouped by colour family.
    const decorated = commit.refs.map(refKind).sort((a, b) => (REF_RANK[a.kind] ?? 4) - (REF_RANK[b.kind] ?? 4))
    const badges = decorated.length === 0 ? [] : [decorated[0]]
    const families = new Map()
    for (const ref of decorated.slice(1)) {
      const family = ref.kind === 'remote' ? 'remote' : ref.kind === 'tag' || ref.kind === 'detached' ? 'warm' : 'local'
      if (!families.has(family)) families.set(family, [])
      families.get(family).push(ref)
    }

    rows.push({ commit, isCurrent, width, nodeLane, nodeColor, paths, nodes, badges, clusters: families.size })
    previous = output
  }
  return rows
}

// ---- jsdom fake host (mirrors scripts/render-test.mjs, history only) -----

const STATUS = {
  isRepo: true,
  path: 'C:/demo',
  root: 'C:/demo',
  branch: 'main',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  oid: 'm1',
  staged: [],
  changes: [],
  conflicts: [],
  operation: null,
}

function respond(action) {
  switch (action) {
    case 'repos':
      return { repos: [{ id: 'w1', title: 'demo', path: 'C:/demo', isRepo: true, root: 'C:/demo', branch: 'main' }], defaultPath: 'C:/demo' }
    case 'status':
      return STATUS
    case 'log':
      return { commits: COMMITS.map((c) => ({ ...c, short: c.sha.padEnd(7, '0').slice(0, 7), author: 'Ada', email: 'ada@example.com', date: new Date(Date.now() - 3600_000).toISOString() })) }
    case 'branches':
      return {
        current: 'main',
        defaultRemote: 'origin',
        remotes: ['origin'],
        branches: [
          { name: 'main', current: true, upstream: 'origin/main', sha: 'm1', date: null },
          { name: 'dev', current: false, upstream: 'origin/dev', sha: 'b1', date: null },
          { name: 'hotfix', current: false, upstream: null, sha: 'hot', date: null },
        ],
      }
    default:
      return {}
  }
}

const dom = new JSDOM('<!doctype html><html lang="zh"><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:43129/',
  pretendToBeVisual: true,
})

global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.MutationObserver = dom.window.MutationObserver
global.IS_REACT_ACT_ENVIRONMENT = true
global.localStorage = dom.window.localStorage

global.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  return { ok: true, status: 200, json: async () => ({ ok: true, result: respond(body.action) }) }
}

let loaded = null
dom.window.__ModuleLoader__ = { load: (definition) => { loaded = definition } }
dom.window.eval(readFileSync(join(root, 'lib', 'client.js'), 'utf8'))

const moduleExports = loaded.factory((id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return reactDom
  throw new Error(`unexpected require: ${id}`)
})

const dictionaries = {}
const interpolate = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_, key) => (vars?.[key] ?? `{${key}}`))
const locale = {
  register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
  bind: (ns) => (key, vars) => interpolate(dictionaries[ns]?.zh?.[key] ?? key, vars),
  getLocale: () => ({ active: 'zh', locales: [], revision: 1 }),
  subscribe: () => () => {},
}
const registrations = []
const slots = {
  register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
  inject: (key, callback) => callback(),
}
const tabTypes = []
const sidebarRightTabs = { register: (definition) => { tabTypes.push(definition); return () => {} } }
const tabOpens = []
const sidebarRight = { openTab: (kind, options) => { tabOpens.push({ kind, params: options?.params ?? null }) } }
const effect = (fn) => { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer() } }
const panelSelections = []
const layout = {
  panelInfo: { getSnapshot: () => ({ activePanelId: panelSelections.length === 0 ? null : panelSelections[panelSelections.length - 1] }) },
  selectPanel: (id) => { panelSelections.push(id) },
}
const ctx = { effect, inject: (deps, callback) => callback({ slots, locale, effect, sidebarRightTabs, layout, sidebarRight }), slots, locale, sidebarRightTabs, layout }

await act(async () => { moduleExports.apply(ctx) })

const panel = registrations.find((entry) => entry.declaration.name === 'sidebar.right.pane.tab')
const container = document.getElementById('root')
const reactRoot = createRoot(container)

await act(async () => {
  reactRoot.render(React.createElement(panel.component, {
    ...(typeof panel.declaration.inject === 'function' ? panel.declaration.inject() : {}),
  }))
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 30))
})

// The preview caps at 10 rows; open the full list so all 12 fixture rows draw.
{
  const showAll = [...container.querySelectorAll('.gmg-group-head button')].find((button) => button.textContent === '显示全部')
  check('the history preview offers a way to all rows', showAll !== undefined, [...container.querySelectorAll('.gmg-group-head button')].map((b) => b.textContent))
  if (showAll !== undefined) {
    await act(async () => {
      showAll.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
}

// ---- assertions -----------------------------------------------------------

const expectations = expectRows()
const rows = [...container.querySelectorAll('.gmg-commit-row')]

console.log('\n— rows and cells —')
check('all thirteen fixture rows render', rows.length === expectations.length, [rows.length, expectations.length])
check('the checkout row is exactly one and is the first', rows.filter((r) => r.classList.contains('is-current')).length === 1 && rows[0]?.classList.contains('is-current') === true, rows.map((r) => r.className))

let widthsOk = true
let viewBoxOk = true
let heightOk = true
let firstChildOk = true
expectations.forEach((expected, index) => {
  const row = rows[index]
  const svg = row?.firstElementChild
  if (svg === null || svg === undefined || svg.tagName.toLowerCase() !== 'svg' || !svg.classList.contains('gmg-graph')) {
    firstChildOk = false
    return
  }
  if (svg.getAttribute('height') !== String(SPEC.rowHeight)) heightOk = false
  if (svg.getAttribute('width') !== String(expected.width)) { widthsOk = false; notes.push(`row ${expected.commit.sha}: width ${svg.getAttribute('width')} ≠ expected ${expected.width}`) }
  if (svg.getAttribute('viewBox') !== `0 0 ${expected.width} ${SPEC.rowHeight}`) viewBoxOk = false
})
check('every graph is the first child of its row (svg.gmg-graph)', firstChildOk, rows[0]?.firstElementChild?.outerHTML?.slice(0, 80))
check('every graph cell is 22px tall (spec fxr)', heightOk)
check('every graph is 11*(max(in,out,1)+1) wide (spec §1.1)', widthsOk, notes.slice(0, 4))
check('every viewBox is "0 0 width 22"', viewBoxOk)

console.log('\n— paths (spec §3.1 a–f) —')
let pathsExact = true
const arc11 = []
const arc5 = []
expectations.forEach((expected, index) => {
  const svg = rows[index]?.firstElementChild
  if (!svg) return
  const actual = [...svg.querySelectorAll('.gmg-graph-edge')].map((p) => p.getAttribute('d') ?? '')
  const want = expected.paths.map((p) => p.d)
  if (actual.length !== want.length || actual.some((d) => !want.includes(d)) || want.some((d) => !actual.includes(d))) {
    pathsExact = false
    notes.push(`row ${expected.commit.sha}: paths ${JSON.stringify(actual)} ≠ expected ${JSON.stringify(want)}`)
  }
  for (const d of actual) {
    if (d.includes('A 11 11 0 0 1')) arc11.push(d)
    if (d.includes('A 5 5 0 0 1')) arc5.push(d)
  }
})
check('every edge d-string matches the spec walk exactly', pathsExact, notes.slice(0, 3))
check('every path starts from "M " and never a cubic', rows.every((row) => [...row.querySelectorAll('.gmg-graph-edge')].every((p) => /^M /.test(p.getAttribute('d') ?? '') && !/C/.test(p.getAttribute('d') ?? ''))))
const arcsWellFormed = rows.every((row) => [...row.querySelectorAll('.gmg-graph-edge')].every((p) => {
  const d = p.getAttribute('d') ?? ''
  const tokens = d.match(/A [^A]+/g) ?? []
  return tokens.every((token) => /^(A 11 11 0 0 1|A 5 5 0 0 1|A 5 5 0 0 0)/.test(token.trim()))
}))
check('every arc is A 11 11 (lane cross) or A 5 5 (lane close)', arcsWellFormed)
check('merge lanes cross on A 11 11 arcs', arc11.length >= 4, arc11.length)
check('a closing lane turns through A 5 5 elbows', arc5.length >= 1, arc5.length)

console.log('\n— edge paint —')
const edgeAttrs = rows.every((row) => [...row.querySelectorAll('.gmg-graph-edge')].every((p) => p.getAttribute('fill') === 'none' && p.getAttribute('stroke-width') === '1' && p.getAttribute('stroke-linecap') === 'round'))
check('edges: fill none, 1px stroke, round caps', edgeAttrs)
const edgeColorsOk = rows.every((row) => [...row.querySelectorAll('.gmg-graph-edge')].every((p) => ALLOWED_COLORS.has(p.getAttribute('stroke') ?? '')))
check('edge strokes come from the palette / ref colours', edgeColorsOk)

console.log('\n— nodes (spec §4.1) —')
let nodesExact = true
const observedRadii = new Set()
expectations.forEach((expected, index) => {
  const svg = rows[index]?.firstElementChild
  if (!svg) return
  const actual = [...svg.querySelectorAll('.gmg-graph-node')].map((c) => ({
    cx: c.getAttribute('cx'),
    cy: c.getAttribute('cy'),
    r: Number(c.getAttribute('r')),
    strokeWidth: c.getAttribute('stroke-width'),
    fill: c.getAttribute('fill'),
  }))
  const want = expected.nodes.map((n) => ({ cx: String(SPEC.laneWidth * (expected.nodeLane + 1)), cy: String(SPEC.rowHeight / 2), r: n.r, strokeWidth: String(n.strokeWidth), fill: n.fill }))
  for (const a of actual) observedRadii.add(a.r)
  if (actual.length !== want.length || want.some((w, i) => {
    const a = actual[i]
    return a === undefined || a.cx !== w.cx || a.cy !== w.cy || a.r !== w.r || a.strokeWidth !== w.strokeWidth || a.fill !== w.fill
  })) {
    nodesExact = false
    notes.push(`row ${expected.commit.sha}: nodes ${JSON.stringify(actual)} ≠ expected ${JSON.stringify(want)}`)
  }
})
check('nodes: cx=11*(lane+1), cy=11, r/strokeWidth/fill per the three forms', nodesExact, notes.filter((n) => n.startsWith('row')).slice(0, 3))
const radiusSet = [...observedRadii].sort((a, b) => a - b).join(',')
check('observed radii are exactly the spec set {2,3,5,6,7}', radiusSet === '2,3,5,6,7', radiusSet)
check('current row: two nodes, the inner one carries no fill attribute', rows[0] && rows[0].querySelectorAll('.gmg-graph-node').length === 2 && rows[0].querySelectorAll('.gmg-graph-node')[1].getAttribute('fill') === null, rows[0]?.innerHTML.slice(0, 200))
const mergeRows = expectations.map((e, i) => ({ e, i })).filter(({ e }) => !e.isCurrent && e.commit.parents.length > 1)
check('merge rows: two same-coloured nodes r6 + r3', mergeRows.length === 3 && mergeRows.every(({ i }) => {
  const nodes = [...rows[i].querySelectorAll('.gmg-graph-node')]
  return nodes.length === 2 && nodes[0].getAttribute('r') === '6' && nodes[1].getAttribute('r') === '3' && nodes[0].getAttribute('fill') === nodes[1].getAttribute('fill')
}), mergeRows.map(({ i }) => [...rows[i].querySelectorAll('.gmg-graph-node')].map((c) => c.getAttribute('r'))))
const plainRows = expectations.map((e, i) => ({ e, i })).filter(({ e }) => !e.isCurrent && e.commit.parents.length <= 1)
check('plain rows: exactly one r5 node', plainRows.every(({ i }) => {
  const nodes = [...rows[i].querySelectorAll('.gmg-graph-node')]
  return nodes.length === 1 && nodes[0].getAttribute('r') === '5'
}))

console.log('\n— colours —')
const nodeFillsOk = expectations.every((expected, index) => {
  const svg = rows[index]?.firstElementChild
  return [...(svg?.querySelectorAll('.gmg-graph-node') ?? [])].every((c) => {
    const fill = c.getAttribute('fill')
    return fill === null || ALLOWED_COLORS.has(fill)
  })
})
check('node fills stay inside palette ∪ {head, remote, tag}', nodeFillsOk)
const paintSet = new Set()
for (const row of rows) {
  for (const p of row.querySelectorAll('.gmg-graph-edge')) paintSet.add(p.getAttribute('stroke'))
  for (const c of row.querySelectorAll('.gmg-graph-node')) paintSet.add(c.getAttribute('fill'))
}
check('both palette colours and all three ref colours get drawn', LANE_COLORS[0] && LANE_COLORS[1] && paintSet.has('#FFB000') && paintSet.has('#DC267F') && paintSet.has('#3794FF') && paintSet.has('#B180D7') && paintSet.has('#EA5C00'), [...paintSet])
check('head #3794FF paints the checkout lane', (() => {
  const stub = [...rows[0].querySelectorAll('.gmg-graph-edge')].find((p) => (p.getAttribute('d') ?? '').startsWith('M 11 11 V 22'))
  return stub?.getAttribute('stroke') === '#3794FF'
})(), rows[0]?.innerHTML.slice(0, 260))
check('remote #B180D7 paints the published copy lane', rows.some((row) => [...row.querySelectorAll('.gmg-graph-edge')].some((p) => p.getAttribute('stroke') === '#B180D7')))
check('tag #EA5C00 paints the tagged base row', (() => {
  const tRow = rows[11] // the tag commit
  return [...(tRow?.querySelectorAll('.gmg-graph-node') ?? [])].some((c) => c.getAttribute('fill') === '#EA5C00')
})(), rows[11]?.innerHTML.slice(0, 200))

console.log('\n— the old rail is gone —')
{
  const css = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('no --gmg-graph-w in the stylesheet', css.includes('--gmg-graph-w') === false)
  check('no inline --gmg-graph-w on the list', (container.querySelector('.gmg-history')?.getAttribute('style') ?? '').includes('--gmg-graph-w') === false, container.querySelector('.gmg-history')?.getAttribute('style'))
  check('no single-rail .gmg-graph-dot remains', container.querySelector('.gmg-graph-dot') === null)
}

console.log('\n— row metrics and badges —')
{
  const css = [...document.querySelectorAll('style')].map((element) => element.textContent ?? '').join('\n')
  check('row height 22px in the sheet', /\.gmg-commit-row\s*\{[^}]*height:\s*22px/.test(css), css.match(/\.gmg-commit-row\s*\{[^}]*\}/)?.[0]?.slice(0, 160))
  check('row type 13px in the sheet', /\.gmg-commit-row\s*\{[^}]*font-size:\s*13px/.test(css))
  check('current subject bold 600 by rule', /\.gmg-commit-row\.is-current \.gmg-subject\s*\{[^}]*font-weight:\s*600/.test(css))
  check('badge pills: 18px tall, 10px radius', /\.gmg-ref\s*\{[^}]*height:\s*18px[^}]*border-radius:\s*10px/.test(css), css.match(/\.gmg-ref\s*\{[^}]*\}/)?.[0]?.slice(0, 200))

  let badgesOk = true
  expectations.forEach((expected, index) => {
    const chips = [...(rows[index]?.querySelectorAll('.gmg-ref') ?? [])]
    const named = chips.filter((chip) => chip.querySelector('.gmg-ref-name')?.textContent)
    const clusters = chips.filter((chip) => chip.classList.contains('is-cluster'))
    if (chips.length !== expected.badges.length + expected.clusters) { badgesOk = false; notes.push(`row ${expected.commit.sha}: ${chips.length} chips ≠ ${expected.badges.length + expected.clusters} expected`) }
    if (chips.length > 0) {
      // Cursor names exactly one chip — the lead, never a cluster — and the
      // trailing families are icon-only.
      if (named.length !== 1 || named[0] !== chips[0] || clusters.length !== expected.clusters) badgesOk = false
      if (clusters.some((c) => c.querySelector('.gmg-ref-name') !== null)) badgesOk = false
    }
  })
  check('badges: one named lead per ref row, the rest icon-only clusters', badgesOk, notes.slice(-3))
  check('the checkout badge names main first', rows[0]?.querySelector('.gmg-ref .gmg-ref-name')?.textContent === 'main', rows[0]?.querySelector('.gmg-ref')?.outerHTML?.slice(0, 200))
  check('the dev row leads with the published copy', rows[6]?.querySelector('.gmg-ref .gmg-ref-name')?.textContent === 'origin/dev', rows[6]?.querySelector('.gmg-ref')?.textContent)
  check('the tag row names its version', rows[11]?.querySelector('.gmg-ref .gmg-ref-name')?.textContent === 'v1.0.0', rows[11]?.querySelector('.gmg-ref')?.textContent)
}

// ---- summary -------------------------------------------------------------

console.log('\n— summary —')
console.log(`  fixture: ${COMMITS.length} rows, ${expectations.filter((e) => !e.isCurrent && e.commit.parents.length > 1).length} merges, lanes up to ${Math.max(...expectations.map((e) => e.width)) / SPEC.laneWidth - 1}, ${arc11.length} lane-cross arcs, ${arc5.length} elbows`)
console.log(`  radii seen: ${radiusSet}`)
for (const note of notes.slice(0, 12)) console.log(`  note: ${note}`)
console.log(`${checks - failed}/${checks} parity checks passed${failed > 0 ? ` — ${failed} FAILED` : ''}`)

process.exit(failed > 0 ? 1 : 0)
