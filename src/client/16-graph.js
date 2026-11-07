/**
 * The history rail: which lane each commit sits in, and the SVG that draws them.
 *
 * The panel had a flat list of recent commits. A list answers "what happened on
 * my branch"; it cannot answer "is this branch merged", "where did the fix land
 * relative to main", or "which of these is a merge". Those are lane questions,
 * and the rail draws them the way Cursor's graph and gitk do: one column per
 * open line of history, a node per commit, an edge per parent.
 *
 * Layout is the standard swim-lane walk over `--topo-order` output: each lane
 * waits for the commit it will draw next, a commit sits in the lane waiting for
 * it (or takes a free one when none does), its first parent inherits that lane,
 * and a merge's other parents open new ones. Because the host reads the log
 * with `--topo-order`, children are always above parents, so lanes only ever
 * run straight down — no edge has to bend back up.
 */

/** Horizontal distance between two lanes, in px (the widest it will get). */
const GRAPH_LANE_WIDTH = 13

/** Height of one history row, in px. The rail is only continuous when every row matches. */
const GRAPH_ROW_HEIGHT = 26

/** Padding at the left and right ends of the rail, in px. */
const GRAPH_PAD = 7

/** Width the rail may grow to before lanes start sharing space, in px. */
const GRAPH_WIDTH_BUDGET = 104

/**
 * Lane colours: a saturated set, because the theme's accents are calmer than a
 * commit graph can afford — three lanes and a merge have to be told apart at a
 * glance. Fixed hues rather than tokens, so a lane keeps its colour across
 * themes and a reader learns "green is that branch".
 */
const GRAPH_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
]

/**
 * The colour of one lane.
 * @param lane - the lane index.
 * @returns a CSS colour.
 */
function graphColor(lane) {
  return GRAPH_COLORS[((lane % GRAPH_COLORS.length) + GRAPH_COLORS.length) % GRAPH_COLORS.length]
}

/**
 * Assign every commit a lane and record the lanes it draws into.
 *
 * @param commits - newest first, each `{ sha, parents }`.
 * @returns `[{ commit, lane, incoming, before, after, parentLanes }]`, one per commit.
 */
function layoutHistory(commits) {
  /** Lane index → the sha that lane is waiting for, or null when the lane is free. */
  const lanes = []
  const rows = []

  /**
   * The leftmost lane to the right of `lane` that is free, extending the rail
   * when there is none. A new branch never opens to the left of the line it
   * forked from: that would draw the branch as older than the line it starts at.
   * @param lane - the lane the commit is on.
   * @returns the index.
   */
  const freeLaneRight = (lane) => {
    for (let index = lane + 1; index < lanes.length; index += 1) {
      if (lanes[index] === null) return index
    }
    lanes.push(null)
    return lanes.length - 1
  }

  /** The leftmost free lane anywhere, used for a commit no lane was waiting for. */
  const freeLane = () => {
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === null) return index
    }
    lanes.push(null)
    return lanes.length - 1
  }

  for (const commit of commits) {
    const parents = Array.isArray(commit.parents) ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '') : []

    // Every lane waiting for this commit, leftmost first. A merge makes two
    // lanes wait for the same commit; the commit is drawn once, on the leftmost,
    // and the others join it from above (see `joins`).
    const waiting = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === commit.sha) waiting.push(index)
    }
    const incoming = waiting.length > 0
    const lane = incoming ? waiting[0] : freeLane()
    const joins = waiting.slice(1)

    lanes[lane] = commit.sha
    const before = lanes.slice()
    // The duplicates are consumed by this row: their lines meet this commit.
    for (const other of joins) lanes[other] = null

    const parentLanes = []
    parents.forEach((parent, index) => {
      const existing = lanes.indexOf(parent)
      if (index === 0) {
        // The first parent keeps this line only when no line to its LEFT is
        // already headed for it. If one is, the main line is the left one and
        // this lane closes into it — otherwise the two lines would swap places
        // and every merge would look like the history changed column.
        if (existing !== -1 && existing < lane) {
          lanes[lane] = null
          parentLanes.push(existing)
          return
        }
        lanes[lane] = parent
        parentLanes.push(lane)
        // A lane to the right that already heads for the same parent is left
        // alone: the two lines meet when that parent is drawn.
        return
      }
      if (existing !== -1) {
        parentLanes.push(existing)
        return
      }
      const fresh = freeLaneRight(lane)
      lanes[fresh] = parent
      parentLanes.push(fresh)
    })

    if (parents.length === 0) lanes[lane] = null
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({ commit, lane, incoming, joins, before, after: lanes.slice(), parentLanes })
  }
  return rows
}

/**
 * How wide the rail needs to be for these rows.
 * @param rows - the layout.
 * @returns a width in px, 0 when there is nothing to draw.
 */
function graphRailWidth(rows) {
  if (rows.length === 0) return 0
  let lanes = 0
  for (const row of rows) {
    lanes = Math.max(lanes, row.lane + 1, row.before.length, row.after.length)
  }
  if (lanes === 0) return 0
  return GRAPH_PAD * 2 + lanes * Math.max(6, Math.min(GRAPH_LANE_WIDTH, GRAPH_WIDTH_BUDGET / lanes))
}

/**
 * The rail itself: one SVG behind the rows, so the lanes join across row borders.
 *
 * @param props - `{ rows }`, the output of `layoutHistory`.
 * @returns the SVG.
 */
function HistoryGraph(props) {
  const rows = props.rows ?? []
  if (rows.length === 0) return null
  let lanes = 0
  for (const row of rows) {
    lanes = Math.max(lanes, row.lane + 1, row.before.length, row.after.length)
  }
  const laneWidth = Math.max(6, Math.min(GRAPH_LANE_WIDTH, GRAPH_WIDTH_BUDGET / lanes))
  const width = GRAPH_PAD * 2 + lanes * laneWidth
  const height = rows.length * GRAPH_ROW_HEIGHT
  const x = (lane) => GRAPH_PAD + lane * laneWidth + laneWidth / 2
  const edges = []
  const dots = []

  rows.forEach((row, index) => {
    const top = index * GRAPH_ROW_HEIGHT
    const cy = top + GRAPH_ROW_HEIGHT / 2
    const bottom = top + GRAPH_ROW_HEIGHT
    const lanesHere = Math.max(row.before.length, row.after.length)
    const joins = row.joins ?? []
    // Lanes that are only passing through this row keep their line straight.
    for (let lane = 0; lane < lanesHere; lane += 1) {
      if (lane === row.lane) continue
      const fromAbove = (row.before[lane] ?? null) !== null
      const toBelow = (row.after[lane] ?? null) !== null
      if (joins.includes(lane)) {
        // Another line was waiting for this same commit. It meets the dot from
        // above instead of ending in mid-air, which is what makes a merge read
        // as "these two lines became one" rather than as a lost branch.
        const bend = GRAPH_ROW_HEIGHT * 0.2
        edges.push({
          lane,
          d: `M ${x(lane)} ${top} C ${x(lane)} ${top + bend}, ${x(row.lane)} ${cy - bend}, ${x(row.lane)} ${cy}`,
        })
        continue
      }
      if (fromAbove && toBelow) edges.push({ lane, d: `M ${x(lane)} ${top} L ${x(lane)} ${bottom}` })
      else if (fromAbove) edges.push({ lane, d: `M ${x(lane)} ${top} L ${x(lane)} ${cy}` })
    }
    // The commit's own lane: a line down from the row above, then its edges out.
    if (row.incoming) edges.push({ lane: row.lane, d: `M ${x(row.lane)} ${top} L ${x(row.lane)} ${cy}` })
    for (const parentLane of row.parentLanes) {
      if (parentLane === row.lane) {
        edges.push({ lane: row.lane, d: `M ${x(row.lane)} ${cy} L ${x(row.lane)} ${bottom}` })
        continue
      }
      // A merge: bend across to the lane that parent already occupies, meeting
      // it exactly at the row border so the two lines continue as one.
      const x1 = x(row.lane)
      const x2 = x(parentLane)
      const bend = GRAPH_ROW_HEIGHT * 0.45
      edges.push({ lane: parentLane, d: `M ${x1} ${cy} C ${x1} ${cy + bend}, ${x2} ${bottom - bend}, ${x2} ${bottom}` })
    }
    dots.push({ lane: row.lane, cy, labelled: (row.commit.refs?.length ?? 0) > 0 })
  })

  return h(
    'svg',
    { className: 'gmg-graph', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' },
    edges.map((edge, index) => h('path', { key: `e${index}`, d: edge.d, className: 'gmg-graph-edge', stroke: graphColor(edge.lane) })),
    dots.map((dot, index) =>
      h('circle', {
        key: `n${index}`,
        cx: x(dot.lane),
        cy: dot.cy,
        r: dot.labelled ? 3.7 : 2.9,
        className: dot.labelled ? 'gmg-graph-dot is-ref' : 'gmg-graph-dot',
        fill: dot.labelled ? graphColor(dot.lane) : 'var(--dsw-alias-bg-base)',
        stroke: graphColor(dot.lane),
      }),
    ),
  )
}
