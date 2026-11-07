/**
 * The data behind a commit-diff tab.
 *
 * The working-tree diff (`15-diff.js`) has one current target and one tab. A
 * commit diff does not: every click in the history opens its own tab, and two
 * of them can be open at once, so the state is a cache keyed `repository#sha`
 * rather than a single "what is open" record. A commit never changes once it is
 * written, so each entry is read once and kept; the tab body only re-reads when
 * a different commit is asked for.
 *
 * The patches arrive already split per file from the host and are parsed here
 * with the same `parsePatch` the working-tree view uses, so a hunk header, a
 * gutter number and a line that merely looks like a file header are all handled
 * in exactly one place.
 */

/** How many commits keep their parsed patches; entries shown by an open tab are never dropped. */
const COMMIT_VIEW_LIMIT = 12

/** What a key with no entry yet looks like. */
const COMMIT_VIEW_EMPTY = {
  key: null,
  status: 'idle',
  error: null,
  commit: null,
  files: [],
  additions: 0,
  deletions: 0,
  total: 0,
  truncated: false,
}

/** `repo#sha` → view. */
const gmgCommitViews = new Map()

/** Keys by last use, newest first, so the LRU trim can drop the tail. */
let gmgCommitOrder = []

const gmgCommitListeners = new Set()

/** Per-key request token: a slow answer must not overwrite a newer one. */
const gmgCommitTokens = new Map()

/** How many mounted tabs show each key; a pinned entry is never evicted. */
const gmgCommitPinned = new Map()

/**
 * One cache key.
 *
 * The path is normalised but deliberately **not** case-folded: on a
 * case-sensitive filesystem `Repo` and `repo` are different repositories, and
 * folding them would show one repository's commit in the other's tab. On
 * Windows the cost of not folding is at most a second read of the same commit.
 *
 * @param path - the repository directory.
 * @param sha - the commit id.
 * @returns the key.
 */
function commitViewKey(path, sha) {
  const normalized = String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  return `${normalized}#${String(sha ?? '')}`
}

/**
 * Read one cached view.
 * @param key - the cache key, or null when the tab has no target.
 * @returns the view, or null.
 */
function getCommitView(key) {
  return key === null ? null : gmgCommitViews.get(key) ?? null
}

/** Tell every mounted commit tab that the cache changed. */
function notifyCommitViews() {
  for (const listener of [...gmgCommitListeners]) listener()
}

/**
 * Drop the oldest unpinned entries beyond the limit.
 *
 * A key is pinned while a tab is showing it, so the trim can never evict the
 * view a reader is looking at. Without that rule, the recovery read of an
 * evicted tab would evict the next one, and thirteen open commit tabs would
 * keep reloading each other forever.
 */
function trimCommitViews() {
  if (gmgCommitOrder.length <= COMMIT_VIEW_LIMIT) return
  const droppable = gmgCommitOrder.filter((entry) => {
    const view = gmgCommitViews.get(entry)
    return view !== undefined && view.status !== 'loading' && (gmgCommitPinned.get(entry) ?? 0) === 0
  })
  while (gmgCommitOrder.length > COMMIT_VIEW_LIMIT && droppable.length > 0) {
    const dropped = droppable.pop()
    gmgCommitOrder = gmgCommitOrder.filter((entry) => entry !== dropped)
    gmgCommitViews.delete(dropped)
    gmgCommitTokens.delete(dropped)
  }
}

/**
 * Merge a partial view into the cache and notify.
 * @param key - the cache key.
 * @param patch - the fields to replace.
 */
function setCommitView(key, patch) {
  const previous = gmgCommitViews.get(key) ?? { ...COMMIT_VIEW_EMPTY }
  gmgCommitViews.set(key, { ...previous, ...patch, key })
  gmgCommitOrder = [key, ...gmgCommitOrder.filter((entry) => entry !== key)]
  trimCommitViews()
  notifyCommitViews()
}

/**
 * Pin one key while a tab shows it.
 *
 * @param key - the cache key, or null.
 * @returns the release function (safe to call more than once).
 */
function pinCommitView(key) {
  if (key === null) return () => {}
  gmgCommitPinned.set(key, (gmgCommitPinned.get(key) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (gmgCommitPinned.get(key) ?? 1) - 1
    if (left <= 0) gmgCommitPinned.delete(key)
    else gmgCommitPinned.set(key, left)
    trimCommitViews()
  }
}

/**
 * Hook form of one commit's cached view.
 * @param key - the cache key, or null.
 * @returns the view, or null.
 */
function useCommitView(key) {
  const [snapshot, setSnapshot] = useState(() => getCommitView(key))
  useEffect(() => {
    setSnapshot(getCommitView(key))
    const listener = () => setSnapshot(getCommitView(key))
    gmgCommitListeners.add(listener)
    return () => gmgCommitListeners.delete(listener)
  }, [key])
  // A snapshot taken for another key must never be shown for this one: the
  // effect that re-reads runs after the first render, and one frame of the
  // previous commit under the new header is a wrong diff, not a slow one.
  if (snapshot !== null && snapshot.key === key) return snapshot
  return getCommitView(key)
}

/**
 * The patch header lines the tab draws itself.
 *
 * A file block already says the path, the status and the line counts, so the
 * `diff --git` / `index` / `---` / `+++` preamble would only repeat it. `\ No
 * newline at end of file` is deliberately not in this list: it carries a fact
 * about the last line, and it appears inside the hunk where it is read.
 */
const COMMIT_META_LINE = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/

/**
 * Turn one host file row into what the renderer reads.
 *
 * @param file - `{ path, oldPath, status, additions, deletions, binary, patch }`.
 * @returns the row with parsed `rows`.
 */
function parseCommitFile(file) {
  const patch = String(file?.patch ?? '')
  const parsed = parsePatch(patch)
  const rows = parsed.rows.filter((row) => row.kind !== DIFF_META || COMMIT_META_LINE.test(row.text) === false)
  // A chmod-only change has no hunk at all: say what changed instead of
  // "no textual difference", which reads like an empty patch.
  const modeOnly = rows.length === 0 && /^(old|new) mode /m.test(patch)
  return {
    path: String(file?.path ?? ''),
    oldPath: typeof file?.oldPath === 'string' ? file.oldPath : null,
    status: typeof file?.status === 'string' && file.status !== '' ? file.status : 'M',
    additions: Number(file?.additions) > 0 ? Number(file.additions) : 0,
    deletions: Number(file?.deletions) > 0 ? Number(file.deletions) : 0,
    binary: file?.binary === true,
    modeOnly,
    rows,
  }
}

/**
 * Read one commit's change set, once.
 *
 * @param input - `{ path, sha }`.
 * @returns the view, or null when the call had no target.
 */
async function loadCommitDiff(input) {
  const path = typeof input?.path === 'string' ? input.path : null
  const sha = typeof input?.sha === 'string' ? input.sha : null
  if (path === null || sha === null) return null
  const key = commitViewKey(path, sha)
  const existing = gmgCommitViews.get(key)
  if (existing !== undefined && (existing.status === 'loading' || existing.status === 'ready')) return existing

  const token = (gmgCommitTokens.get(key) ?? 0) + 1
  gmgCommitTokens.set(key, token)
  setCommitView(key, { status: 'loading', error: null, commit: null, files: [], additions: 0, deletions: 0, total: 0, truncated: false })
  try {
    const result = await callHost('commitDiff', { path, sha })
    if (gmgCommitTokens.get(key) !== token) return null
    const files = (Array.isArray(result?.files) ? result.files : []).map(parseCommitFile)
    const total = Number(result?.total)
    setCommitView(key, {
      status: 'ready',
      commit: {
        sha: String(result?.sha ?? sha),
        short: String(result?.short ?? sha.slice(0, 7)),
        author: String(result?.author ?? ''),
        date: typeof result?.date === 'string' ? result.date : null,
        subject: String(result?.subject ?? ''),
        body: typeof result?.body === 'string' ? result.body : '',
        merge: result?.merge === true,
      },
      files,
      additions: Number(result?.additions) > 0 ? Number(result.additions) : files.reduce((sum, file) => sum + file.additions, 0),
      deletions: Number(result?.deletions) > 0 ? Number(result.deletions) : files.reduce((sum, file) => sum + file.deletions, 0),
      total: Number.isFinite(total) && total > 0 ? total : files.length,
      truncated: result?.truncated === true || (Number.isFinite(total) && total > files.length),
    })
    return gmgCommitViews.get(key) ?? null
  } catch (error) {
    if (gmgCommitTokens.get(key) !== token) return null
    setCommitView(key, { status: 'error', error: String(error?.message ?? error) })
    return null
  }
}
