/**
 * The diff target and the patch model behind the centre-column diff view.
 *
 * Opening a changed file is a navigation, not a peek: the sidebar row records
 * what to show, and the `main` panel renders it at full width — the same
 * division of labour Cursor and VS Code have between the Source Control view
 * and the editor. The patch is parsed here, once, into rows with both gutter
 * numbers so the renderer stays dumb.
 */

/** Row kinds a patch line can have. */
const DIFF_META = 'meta'
const DIFF_HUNK = 'hunk'
const DIFF_ADD = 'add'
const DIFF_DEL = 'del'
const DIFF_CONTEXT = 'context'

/** The panel's current target and parsed patch. */
let gmgDiffState = {
  /** `{ path, file, staged, status }` or null when nothing is open. */
  target: null,
  /** Flattened rows: `{ kind, text, oldNo, newNo }`. */
  rows: [],
  /** Side-by-side pairs derived from the rows. */
  pairs: [],
  /** `unified` or `split`. */
  mode: 'unified',
  loading: false,
  error: null,
  /** Set when the file has no textual diff (binary, or empty). */
  note: null,
  /** `{ slug, webUrl }` when the repository has a GitHub remote. */
  remote: null,
}

const gmgDiffListeners = new Set()

/**
 * Read the current diff state.
 * @returns the state object.
 */
function getDiffState() {
  return gmgDiffState
}

/**
 * Merge a partial state and notify subscribers.
 * @param patch - fields to replace.
 */
function setDiffState(patch) {
  gmgDiffState = { ...gmgDiffState, ...patch }
  for (const listener of [...gmgDiffListeners]) listener()
}

/**
 * Subscribe to diff-state changes.
 * @param listener - called after every change.
 * @returns the unsubscribe function.
 */
function subscribeDiff(listener) {
  gmgDiffListeners.add(listener)
  return () => gmgDiffListeners.delete(listener)
}

/**
 * Hook form of the diff state.
 * @returns the current state, re-rendering on change.
 */
function useDiffState() {
  const [snapshot, setSnapshot] = useState(() => getDiffState())
  useEffect(() => {
    setSnapshot(getDiffState())
    return subscribeDiff(() => setSnapshot(getDiffState()))
  }, [])
  return snapshot
}

/**
 * Split a unified patch into rows carrying both gutter line numbers.
 *
 * `git diff` output is line-oriented: everything before the first `@@` is
 * header noise, and inside a hunk the first character is the sign. A hunk's
 * `@@ -oldStart,oldCount +newStart,newCount @@` header resets the counters.
 *
 * @param patch - the raw unified patch.
 * @returns `{ rows, pairs }`.
 */
function parsePatch(patch) {
  const rows = []
  let oldNo = 0
  let newNo = 0
  for (const line of String(patch ?? '').split('\n')) {
    if (line === '') continue
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match) {
        oldNo = Number(match[1])
        newNo = Number(match[2])
      }
      rows.push({ kind: DIFF_HUNK, text: line, oldNo: null, newNo: null })
      continue
    }
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename ')) {
      rows.push({ kind: DIFF_META, text: line, oldNo: null, newNo: null })
      continue
    }
    if (line.startsWith('\\')) {
      rows.push({ kind: DIFF_META, text: line, oldNo: null, newNo: null })
      continue
    }
    const sign = line[0]
    const text = line.slice(1)
    if (sign === '+') {
      rows.push({ kind: DIFF_ADD, text, oldNo: null, newNo })
      newNo += 1
      continue
    }
    if (sign === '-') {
      rows.push({ kind: DIFF_DEL, text, oldNo, newNo: null })
      oldNo += 1
      continue
    }
    // A context line; an all-space line is how git represents a blank one.
    rows.push({ kind: DIFF_CONTEXT, text, oldNo, newNo })
    oldNo += 1
    newNo += 1
  }
  return { rows, pairs: pairRows(rows) }
}

/**
 * Pair unified rows into side-by-side cells.
 *
 * Within one run, removed lines and added lines pair up by position; a run with
 * more removals than additions (or the reverse) leaves the shorter side empty,
 * which is exactly how a split diff reads.
 *
 * @param rows - the flattened rows.
 * @returns `[{ left, right }]` in display order.
 */
function pairRows(rows) {
  const pairs = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (row.kind === DIFF_HUNK) {
      pairs.push({ left: { kind: DIFF_HUNK, text: row.text }, right: { kind: DIFF_HUNK, text: row.text } })
      index += 1
      continue
    }
    if (row.kind === DIFF_META) {
      index += 1 // header noise belongs to the unified view only
      continue
    }
    if (row.kind !== DIFF_DEL && row.kind !== DIFF_ADD) {
      pairs.push({ left: row, right: row })
      index += 1
      continue
    }
    const dels = []
    const adds = []
    while (index < rows.length && rows[index].kind === DIFF_DEL) {
      dels.push(rows[index])
      index += 1
    }
    while (index < rows.length && rows[index].kind === DIFF_ADD) {
      adds.push(rows[index])
      index += 1
    }
    const height = Math.max(dels.length, adds.length)
    for (let offset = 0; offset < height; offset += 1) {
      pairs.push({ left: dels[offset] ?? null, right: adds[offset] ?? null })
    }
  }
  return pairs
}

/**
 * Open one file's diff: record the target, read the patch, parse it.
 *
 * The diff renders inside the right column (the tab's own body switches to it),
 * so opening one is purely a state change — the conversation column is never
 * touched.
 *
 * @param input - `{ path, file, staged, status }`.
 * @returns the parsed rows.
 */
async function openDiff(input) {
  setDiffState({
    target: input,
    loading: true,
    error: null,
    note: null,
    rows: [],
    pairs: [],
  })
  try {
    const result = await callHost('diff', { path: input.path, file: input.file, staged: input.staged })
    const patch = String(result?.patch ?? '')
    if (result?.isBinary === true) {
      setDiffState({ loading: false, note: 'binary' })
      return
    }
    if (patch.trim() === '') {
      setDiffState({ loading: false, note: 'empty' })
      return
    }
    const parsed = parsePatch(patch)
    setDiffState({ loading: false, rows: parsed.rows, pairs: parsed.pairs })
  } catch (error) {
    setDiffState({ loading: false, error: String(error?.message ?? error) })
  }
}

/**
 * Leave the diff view (the panel's back button and Escape).
 */
function closeDiff() {
  setDiffState({ target: null, rows: [], pairs: [], error: null, note: null, loading: false })
}

/**
 * Flip between the unified and split presentations.
 */
function toggleDiffMode() {
  setDiffState({ mode: gmgDiffState.mode === 'unified' ? 'split' : 'unified' })
}
