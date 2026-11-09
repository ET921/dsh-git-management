/**
 * The commit graph, drawn the way Cursor draws it.
 *
 * Cursor ships the VS Code 1.128 Source Control graph, and this file recreates
 * its swimlane layout and its per-row SVG instead of the older "one rail behind
 * the whole list" drawing. Two things changed together:
 *
 *  - The graph moved to the left of each history row, and every row is now its
 *    own 22px-tall `<svg>`. A lane is a column of cells stacked by the list,
 *    not one tall picture the rows overlay, so a row's width is whatever its
 *    widest lane needs and no two rows have to agree on it.
 *  - Lanes turn the way VS Code turns them: a straight column where a line
 *    passes through, a quarter-arc where two lanes converge on a commit, a
 *    rounded elbow where a lane shifts sideways past a merge, and hollow/solid
 *    nodes that read "this is the checkout" and "this is a merge" without
 *    needing the ref chip to say so.
 *
 * The layout is the VS Code `gitGraph` swimlane walk over `--topo-order` output
 * (children always above parents): each row clones the previous row's output as
 * its input, replaces the lane waiting for the commit with its first parent,
 * drops any further lane waiting for the same commit, and appends a fresh lane
 * for every other parent.
 */

/** Height of one history row, in px. VS Code pins the SCM graph to 22. */
const GRAPH_ROW_HEIGHT = 22

/** Width of one lane, in px. */
const GRAPH_LANE_WIDTH = 11

/** Radius of the rounded elbow a shifting lane turns through, in px. */
const GRAPH_ELBOW_RADIUS = 5

/** Radius of a plain commit node, in px, as VS Code sizes it. */
const GRAPH_NODE_RADIUS = 4

/** Border width around a node, in px. */
const GRAPH_NODE_STROKE = 2

/**
 * Lane colours, in VS Code's `scmGraph.foreground1..5` order. The order is
 * part of the contract — the first lane always opens with the first colour —
 * so a lane keeps its identity and a reader learns "this colour is that line".
 * Five colours serve any number of lanes by cycling.
 */
const LANE_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']

/**
 * Ref colours: the checkout is blue, a published copy purple, a tag orange —
 * VS Code's dark-theme `charts.blue` / `charts.purple` / `base`. Kept apart
 * from the five lane colours so a label never masquerades as a lane.
 */
const REF_COLORS = { head: '#3794FF', remote: '#B180D7', tag: '#EA5C00' }

/**
 * Cursor's badge order for the refs a row carries: the checkout first, then
 * published copies, then local branches and tags together, then anything else.
 * The panel relies on this order to choose the name its badge shows.
 */
const REF_RANK = { head: 0, remote: 1, branch: 2, tag: 2, detached: 3 }

/** The x centre of a lane, in px: lane 0 sits one lane-width in from the left. */
function laneX(lane) {
  return GRAPH_LANE_WIDTH * (lane + 1)
}

/**
 * Advance the lane-colour cursor and hand back the next palette index.
 * @param cursor - the current cursor, -1 before the first lane is opened.
 * @returns the next index into `LANE_COLORS`.
 */
function nextPalette(cursor) {
  return (cursor + 1) % LANE_COLORS.length
}

/**
 * Cursor's ref order, as a sort comparator. Unknown kinds trail the known ones,
 * and equal ranks keep their input order (the sort is stable).
 * @param a - one ref, carrying a `kind`.
 * @param b - another.
 * @returns negative when `a` sorts first.
 */
function compareRefs(a, b) {
  const rank = (ref) => REF_RANK[ref.kind] ?? 4
  return rank(a) - rank(b)
}

/**
 * Assign every commit a lane and record the lanes entering and leaving its row.
 *
 * @param commits - newest first, each `{ sha, parents, references }`.
 *   `references` is `[{ kind, name }]` pre-computed by the panel, `kind` being
 *   `head`, `remote`, `tag`, `branch` or `detached`.
 * @param options - `{ currentSha, refColor }`. `refColor(ref)` overrides the
 *   default kind→`REF_COLORS` lookup.
 * @returns one row per commit: `{ commit, isCurrent, inputSwimlanes,
 *   outputSwimlanes, color, references, width, height }`.
 */
function layoutHistory(commits, options = {}) {
  const currentSha = options.currentSha ?? null
  const refColor = typeof options.refColor === 'function'
    ? options.refColor
    : ((ref) => REF_COLORS[ref.kind] ?? null)

  // Parent lookup, so a merge can hand its second parent the colour that
  // parent's own refs claim instead of always minting a fresh lane colour.
  const commitBySha = new Map()
  for (const commit of commits) commitBySha.set(commit.sha, commit)

  // The colour a commit's refs claim, if any: the first ref whose kind has a
  // colour. A plain branch or a detached checkout has none, so its line falls
  // through to the lane colour.
  const refColorOf = (commit) => {
    for (const ref of commit?.references ?? []) {
      const color = refColor(ref)
      if (color) return color
    }
    return null
  }

  const rows = []
  let paletteCursor = -1
  let previous = []

  for (const commit of commits) {
    const parents = Array.isArray(commit.parents)
      ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '')
      : []

    // Each row clones the previous row's output rather than sharing it: the
    // lanes mutate as the walk passes down, and a shared object would let one
    // row rewrite a lane the row above still draws.
    const input = previous.map((lane) => ({ id: lane.id, color: lane.color }))
    const output = []

    // The leftmost lane waiting for this commit; a new lane to the right of
    // every existing one when no lane was waiting.
    const l = input.findIndex((lane) => lane.id === commit.sha)
    const laneIndex = l === -1 ? input.length : l

    for (let index = 0; index < input.length; index += 1) {
      const lane = input[index]
      if (lane.id === commit.sha) {
        if (index === l) {
          // The commit sits on this lane. It hands the lane to its first parent
          // (or lets the lane end here when the commit is a root).
          if (parents.length > 0) {
            output.push({ id: parents[0], color: refColorOf(commit) ?? lane.color })
          }
        }
        // A further lane waiting for the same commit is a merge that converges
        // here; it is consumed, not passed on.
      } else {
        output.push(lane)
      }
    }

    // Every other parent forks a new lane. The first parent is already placed
    // above when the commit matched a lane; otherwise it is the first new lane.
    const start = l === -1 ? 0 : 1
    for (let i = start; i < parents.length; i += 1) {
      let color = i === 0 ? refColorOf(commit) : refColorOf(commitBySha.get(parents[i]))
      if (!color) {
        paletteCursor = nextPalette(paletteCursor)
        color = LANE_COLORS[paletteCursor]
      }
      output.push({ id: parents[i], color })
    }

    // The node's colour is the lane it continues into; a root keeps the lane
    // that was waiting for it, and a lane-less root falls back to the checkout
    // blue rather than going colourless.
    const nodeColor = laneIndex < output.length
      ? output[laneIndex].color
      : laneIndex < input.length
        ? input[laneIndex].color
        : REF_COLORS.head

    const references = (commit.references ?? [])
      .map((ref) => ({ ...ref, color: refColor(ref) ?? nodeColor }))
      .sort(compareRefs)

    const lanes = Math.max(input.length, output.length, 1)
    const width = GRAPH_LANE_WIDTH * (lanes + 1)

    rows.push({
      commit,
      isCurrent: commit.sha === currentSha,
      inputSwimlanes: input,
      outputSwimlanes: output,
      color: nodeColor,
      references,
      width,
      height: GRAPH_ROW_HEIGHT,
    })

    previous = output
  }

  return rows
}

/**
 * How wide one laid-out row needs to be, in px.
 * @param row - one row from `layoutHistory`.
 * @returns the row's width, 0 when there is nothing to draw.
 */
function graphRowWidth(row) {
  return row?.width ?? 0
}

/**
 * One history row's graph: its own SVG cell, lanes entering at the top and
 * leaving at the bottom so the list stacks them into continuous columns.
 *
 * @param props - `{ row, height }`, the row from `layoutHistory`.
 * @returns the SVG.
 */
function HistoryGraph(props) {
  const row = props?.row
  if (!row) return null
  const height = props.height ?? GRAPH_ROW_HEIGHT
  const cy = height / 2
  const commit = row.commit ?? {}
  const parents = Array.isArray(commit.parents)
    ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '')
    : []
  const input = row.inputSwimlanes ?? []
  const output = row.outputSwimlanes ?? []

  // The lane the node sits on, resolved the same way the layout did: the lane
  // waiting for the commit, or a fresh lane to the right when none was.
  const l = input.findIndex((lane) => lane.id === commit.sha)
  const laneIndex = l === -1 ? input.length : l

  let key = 0
  const path = (d, color) =>
    h('path', { key: `e${key += 1}`, className: 'gmg-graph-edge', d, stroke: color, fill: 'none', strokeWidth: 1, strokeLinecap: 'round' })
  const circle = (lane, r, strokeWidth, color, modifier = '') => {
    const props = { key: `n${key += 1}`, className: 'gmg-graph-node' + modifier, cx: laneX(lane), cy, r }
    if (color !== undefined) props.fill = color
    if (strokeWidth !== undefined) props.strokeWidth = strokeWidth
    return h('circle', props)
  }

  const paths = []

  // Incoming lanes. `u` is the output lane the next pass-through input lane
  // maps to; the commit's own lane is skipped past `output[l]` (its first
  // parent), and a lane converging on the commit is drawn as a quarter-arc
  // into the node rather than passed through.
  let u = 0
  for (let d = 0; d < input.length; d += 1) {
    const lane = input[d]
    if (lane.id === commit.sha) {
      if (d !== laneIndex) {
        paths.push(path(`M ${laneX(d)} 0 A ${GRAPH_LANE_WIDTH} ${GRAPH_LANE_WIDTH} 0 0 1 ${laneX(d) - GRAPH_LANE_WIDTH} ${cy} H ${laneX(laneIndex)}`, lane.color))
      } else if (parents.length > 0) {
        u += 1
      }
    } else if (u < output.length && lane.id === output[u].id) {
      if (d === u) {
        paths.push(path(`M ${laneX(d)} 0 V ${height}`, lane.color))
      } else {
        paths.push(path(`M ${laneX(d)} 0 V ${cy - GRAPH_ELBOW_RADIUS} A ${GRAPH_ELBOW_RADIUS} ${GRAPH_ELBOW_RADIUS} 0 0 1 ${laneX(d) - GRAPH_ELBOW_RADIUS} ${cy} H ${laneX(u) + GRAPH_ELBOW_RADIUS} A ${GRAPH_ELBOW_RADIUS} ${GRAPH_ELBOW_RADIUS} 0 0 0 ${laneX(u)} ${cy + GRAPH_ELBOW_RADIUS} V ${height}`, lane.color))
      }
      u += 1
    }
  }

  // Extra parents fork new lanes out of the merge node: a horizontal run to
  // one lane short of the new column, then a quarter-arc down into it. The
  // lane is found from the tail so a parent reached by two lines hands its
  // fork to the one this commit just opened.
  for (let i = 1; i < parents.length; i += 1) {
    let p = -1
    for (let idx = output.length - 1; idx >= 0; idx -= 1) {
      if (output[idx].id === parents[i]) { p = idx; break }
    }
    if (p < 0) continue
    paths.push(path(`M ${laneX(p) - GRAPH_LANE_WIDTH} ${cy} A ${GRAPH_LANE_WIDTH} ${GRAPH_LANE_WIDTH} 0 0 1 ${laneX(p)} ${height} M ${laneX(p) - GRAPH_LANE_WIDTH} ${cy} H ${laneX(laneIndex)}`, output[p].color))
  }

  // The node's own stubs: up from the row above to the node, down to the row
  // below. A lane-less commit has no line above; a root has none below.
  if (laneIndex < input.length) {
    paths.push(path(`M ${laneX(laneIndex)} 0 V ${cy}`, input[laneIndex].color))
  }
  if (parents.length > 0) {
    paths.push(path(`M ${laneX(laneIndex)} ${cy} V ${height}`, row.color))
  }

  // Nodes come last so they sit above every edge. The checkout is a hollow
  // ring (its inner fill is left to CSS), a merge a larger solid dot, and a
  // plain commit a smaller one.
  const nodes = []
  if (row.isCurrent === true) {
    nodes.push(circle(laneIndex, GRAPH_NODE_RADIUS + 3, GRAPH_NODE_STROKE, row.color, ' is-current'))
    nodes.push(circle(laneIndex, GRAPH_NODE_RADIUS - 2, GRAPH_NODE_STROKE * 2, undefined, ' is-current-inner'))
  } else if (parents.length > 1) {
    nodes.push(circle(laneIndex, GRAPH_NODE_RADIUS + 2, GRAPH_NODE_STROKE, row.color, ' is-merge'))
    nodes.push(circle(laneIndex, GRAPH_NODE_RADIUS - 1, GRAPH_NODE_STROKE, row.color, ' is-merge-inner'))
  } else {
    nodes.push(circle(laneIndex, GRAPH_NODE_RADIUS + 1, GRAPH_NODE_STROKE, row.color, ' is-node'))
  }

  return h(
    'svg',
    { className: 'gmg-graph', width: row.width, height, viewBox: `0 0 ${row.width} ${height}`, 'aria-hidden': 'true', focusable: 'false' },
    ...paths,
    ...nodes,
  )
}
