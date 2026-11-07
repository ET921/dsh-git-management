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

/** How many commits keep their parsed patches; older entries are dropped. */
const COMMIT_VIEW_LIMIT = 12

/** What a key with no entry yet looks like. */
const COMMIT_VIEW_EMPTY = {
  status: 'idle',
  error: null,
  commit: null,
  files: [],
  additions: 0,
  deletions: 0,
  total: 0,
  truncated: false,
}

/** `pathKey(path)#sha` → view. */
const gmgCommitViews = new Map()

/** Keys by last use, newest first, so the LRU trim can drop the tail. */
let gmgCommitOrder = []

const gmgCommitListeners = new Set()

/** Per-key request token: a slow answer must not overwrite a newer one. */
const gmgCommitTokens = new Map()

/**
 * The cache key for one commit in one repository.
 * @param path - the repository directory.
 * @param sha - the commit id.
 * @returns the key.
 */
function commitViewKey(path, sha) {
  return `${pathKey(path)}#${String(sha ?? '')}`
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
 * Merge a partial view into the cache and notify.
 *
 * The trim is what keeps a long session bounded: each entry holds parsed
 * patches for up to sixty files. An entry that is still loading is never
 * dropped, so trimming cannot strand a request in flight.
 *
 * @param key - the cache key.
 * @param patch - the fields to replace.
 */
function setCommitView(key, patch) {
  const previous = gmgCommitViews.get(key) ?? { ...COMMIT_VIEW_EMPTY }
  gmgCommitViews.set(key, { ...previous, ...patch })
  gmgCommitOrder = [key, ...gmgCommitOrder.filter((entry) => entry !== key)]
  const droppable = gmgCommitOrder.filter((entry) => {
    const view = gmgCommitViews.get(entry)
    return view !== undefined && view.status !== 'loading'
  })
  while (gmgCommitOrder.length > COMMIT_VIEW_LIMIT && droppable.length > 0) {
    const dropped = droppable.pop()
    gmgCommitOrder = gmgCommitOrder.filter((entry) => entry !== dropped)
    gmgCommitViews.delete(dropped)
  }
  notifyCommitViews()
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
  return snapshot
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
  const parsed = parsePatch(String(file?.patch ?? ''))
  return {
    path: String(file?.path ?? ''),
    oldPath: typeof file?.oldPath === 'string' ? file.oldPath : null,
    status: typeof file?.status === 'string' && file.status !== '' ? file.status : 'M',
    additions: Number(file?.additions) > 0 ? Number(file.additions) : 0,
    deletions: Number(file?.deletions) > 0 ? Number(file.deletions) : 0,
    binary: file?.binary === true,
    rows: parsed.rows.filter((row) => row.kind !== DIFF_META || COMMIT_META_LINE.test(row.text) === false),
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
