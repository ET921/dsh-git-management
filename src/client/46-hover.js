/**
 * Hover cards for the history rows and the branch pill.
 *
 * Cursor answers a hover on a commit with the commit itself — author, time,
 * message, the stat line, and a way to open it on GitHub — and a hover on a
 * branch with where that branch is. Both are read-only enlargements of a row
 * that is already on screen: nothing happens until the pointer rests for a
 * moment, and the card cannot be clicked into a trap, so the row's own click
 * behaviour is untouched.
 *
 * Details are fetched once per sha/branch and cached for the session; the row's
 * own fields render immediately, so the card never appears empty.
 */

/** Details already fetched, keyed `path|sha` and `path|branch`. */
const gmgDetailCache = new Map()

/**
 * Read one cached detail.
 * @param key - the cache key.
 * @returns the cached value or undefined.
 */
function cachedDetail(key) {
  return gmgDetailCache.get(key)
}

/**
 * Fetch and cache one detail.
 * @param key - the cache key.
 * @param action - host action name.
 * @param params - action parameters.
 * @returns the detail.
 */
async function fetchDetail(key, action, params) {
  if (gmgDetailCache.has(key)) return gmgDetailCache.get(key)
  const result = await callHost(action, params)
  gmgDetailCache.set(key, result)
  return result
}

/**
 * Async detail for a commit or branch, shared by the cards.
 * @param key - cache key, or null while the card has no target.
 * @param action - host action.
 * @param params - action parameters.
 * @returns `{ detail, error }`.
 */
function useDetail(key, action, params) {
  const [detail, setDetail] = useState(() => (key === null ? null : cachedDetail(key) ?? null))
  const [error, setError] = useState(null)
  useEffect(() => {
    if (key === null) return
    const cached = cachedDetail(key)
    if (cached !== undefined) {
      setDetail(cached)
      return
    }
    let live = true
    fetchDetail(key, action, params)
      .then((value) => {
        if (live) setDetail(value)
      })
      .catch((failure) => {
        if (live) setError(String(failure?.message ?? failure))
      })
    return () => {
      live = false
    }
  }, [key])
  return { detail, error }
}

/**
 * The floating layer: anchored beside the hovered row, never on top of it.
 *
 * The card stays inside the column and above or below the row it describes,
 * never on top of it. Long messages do not grow the card past the window: it
 * is capped and scrolls, and it stays open while the pointer is inside it, so
 * the scrollbar is reachable. VS Code fixed the same class of bug in its debug
 * hover ("hover expands over cursor", microsoft/vscode@37fe2d0).
 *
 * @param props - `{ anchor, onEnter, onLeave, children }`.
 * @returns the card, portalled when the module table allows it.
 */
function HoverLayer(props) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ left: -9999, top: 0, visibility: 'hidden' })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const anchor = props.anchor
    const width = Math.max(240, Math.min(anchor.width ?? 320, 380))
    const maxHeight = Math.max(160, Math.min(Math.round(window.innerHeight * 0.46), 340))
    // Measure at the cap, not at the natural height: a long commit body must not
    // decide where the card goes.
    const height = Math.min(element.getBoundingClientRect().height, maxHeight)
    const aboveRoom = anchor.top - 8
    const belowRoom = window.innerHeight - anchor.bottom - 8
    const placeAbove = aboveRoom >= height || aboveRoom >= belowRoom
    const preferred = placeAbove ? anchor.top - height - 8 : anchor.bottom + 8
    const top = Math.max(8, Math.min(preferred, window.innerHeight - height - 8))
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 12))
    setStyle({ left, top, width, maxHeight, visibility: 'visible' })
  }, [props.anchor.left, props.anchor.top, props.anchor.right, props.anchor.bottom, props.anchor.width, props.children])
  const card = h(
    'div',
    { ref, className: 'gmg-hover', style, onMouseEnter: props.onEnter, onMouseLeave: props.onLeave },
    props.children,
  )
  if (typeof reactDom?.createPortal !== 'function') return card
  return reactDom.createPortal(card, document.body)
}

/** The row whose box a hover card should sit beside. */
const HOVER_ROW_SELECTOR = '.gmg-commit-row, .gmg-branch'

/**
 * Wrap a row so that resting the pointer on it enlarges it.
 *
 * Leaving the row does not close the card at once: the pointer may be on its
 * way into the card to scroll it. The close is postponed, and entering the card
 * cancels that.
 *
 * @param props - `{ card, delay, children }`; `card` is the element to float.
 * @returns the wrapper element.
 */
function HoverTarget(props) {
  const [anchor, setAnchor] = useState(null)
  const timer = useRef(undefined)
  const hideTimer = useRef(undefined)
  const cancel = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }
  const keepOpen = () => {
    if (hideTimer.current !== undefined) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = undefined
    }
  }
  const scheduleHide = () => {
    cancel()
    keepOpen()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined
      setAnchor(null)
    }, 180)
  }
  const enter = (event) => {
    const target = event.target
    const row = typeof target?.closest === 'function' ? target.closest(HOVER_ROW_SELECTOR) : null
    const box = row?.getBoundingClientRect?.()
    const next =
      box === undefined || box === null
        ? { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY, width: 320 }
        : { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width }
    cancel()
    keepOpen()
    timer.current = window.setTimeout(() => setAnchor(next), props.delay ?? 280)
  }
  const leave = () => {
    scheduleHide()
  }
  const closeNow = () => {
    cancel()
    keepOpen()
    setAnchor(null)
  }
  useEffect(() => {
    return () => {
      cancel()
      keepOpen()
    }
  }, [])
  return h(
    'div',
    { className: 'gmg-hovertarget', onMouseEnter: enter, onMouseLeave: leave, onMouseDown: closeNow },
    props.children,
    anchor === null ? null : h(HoverLayer, { anchor, onEnter: keepOpen, onLeave: scheduleHide }, props.card),
  )
}

/**
 * The stat line, split into three coloured pieces: how many files, how many
 * lines added, how many removed. One interpolated sentence could not colour
 * the numbers differently, and the numbers are the point.
 *
 * @param props - `{ files, additions, deletions, t }`.
 * @returns the zone element.
 */
function CommitStatZone(props) {
  const { files, additions, deletions, t } = props
  const total = additions + deletions
  const addedShare = total === 0 ? 0 : Math.round((additions / total) * 100)
  return h(
    'div',
    { className: 'gmg-hoverzone is-foot' },
    h(
      'div',
      { className: 'gmg-hoverstats' },
      h('span', { className: 'gmg-stat-files' }, t('hoverStatFiles', { files })),
      h('span', { className: 'gmg-stat-sep' }, t('hoverStatSeparator')),
      h('span', { className: 'gmg-stat-add' }, t('hoverStatAdditions', { additions })),
      h('span', { className: 'gmg-stat-sep' }, t('hoverStatSeparator')),
      h('span', { className: 'gmg-stat-del' }, t('hoverStatDeletions', { deletions })),
    ),
    total === 0
      ? null
      : h(
          'div',
          { className: 'gmg-statbar', title: `${additions} / ${deletions}` },
          h('span', { className: 'gmg-statbar-add', style: { width: `${addedShare}%` } }),
          h('span', { className: 'gmg-statbar-del', style: { width: `${100 - addedShare}%` } }),
        ),
  )
}

/**
 * The GitHub account behind one commit, when the panel is authorised.
 *
 * Git records whatever name the author configured; the account name is what a
 * reader recognises. The two can differ (a machine-local user.name versus the
 * GitHub login), so the card prefers the account and falls back to git.
 *
 * @param sha - the commit id.
 * @returns `{ login, name, avatarUrl }` or null.
 */
function useGithubAuthor(sha) {
  const path = gitStore.get().path
  const authorized = gitStore.get().github?.authorized === true
  const [author, setAuthor] = useState(null)
  useEffect(() => {
    if (!authorized || path === null) return
    let live = true
    fetchDetail(`gh|${path}|${sha}`, 'github', { path, action: 'commit', sha })
      .then((value) => {
        if (live) setAuthor(value?.commit ?? null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [sha, path, authorized])
  return author
}

/**
 * The commit card: a tinted head (sha, author, age), the message zone with the
 * subject and its body, and a foot zone carrying the stat line the Source
 * Control view has always used ("N files changed, X insertions(+), Y deletions(-)").
 *
 * @param props - `{ commit, t }`.
 * @returns the card contents.
 */
function CommitHoverCard(props) {
  const { commit, t } = props
  const path = gitStore.get().path
  const { detail, error } = useDetail(path === null ? null : `${path}|${commit.sha}`, 'commitDetail', { path, sha: commit.sha })
  const account = useGithubAuthor(commit.sha)
  const body = typeof detail?.body === 'string' ? detail.body.trim() : ''
  return h(
    'div',
    { className: 'gmg-hovercard' },
    h(
      'div',
      { className: 'gmg-hoverzone is-head' },
      h('span', { className: 'gmg-sha' }, commit.short),
      h('span', { className: 'gmg-hoverauthor' }, account?.login ?? commit.author),
      h('span', { className: 'gmg-hoverdot' }, '·'),
      h('span', { className: 'gmg-hoverauthor' }, relativeTime(commit.date, currentLocale())),
    ),
    h('div', { className: 'gmg-hoverzone is-subject' }, commit.subject),
    body === '' ? null : h('div', { className: 'gmg-hoverzone is-body' }, body.slice(0, 600)),
    detail !== null
      ? h(CommitStatZone, { files: detail.files, additions: detail.additions, deletions: detail.deletions, t })
      : error === null
        ? h('div', { className: 'gmg-hoverzone is-foot' }, h('div', { className: 'gmg-hoverstats' }, t('hoverLoading')))
        : null,
  )
}

/**
 * The branch card: the same three zones, with the upstream and the last commit.
 * @param props - `{ branch, t }`.
 * @returns the card contents.
 */
function BranchHoverCard(props) {
  const { branch, t } = props
  const path = gitStore.get().path
  const { detail } = useDetail(path === null ? null : `${path}|branch:${branch}`, 'branchDetail', { path, branch })
  if (detail === null) {
    // Either still reading, or a host that predates the action: the branch name
    // is already known, so the card is useful either way.
    return h(
      'div',
      { className: 'gmg-hovercard' },
      h('div', { className: 'gmg-hoverzone is-head' }, h(IconBranch, { size: 12 }), h('span', { className: 'gmg-hoversubject' }, branch)),
    )
  }
  if (detail.exists === false) {
    return h(
      'div',
      { className: 'gmg-hovercard' },
      h('div', { className: 'gmg-hoverzone is-head' }, h(IconBranch, { size: 12 }), h('span', { className: 'gmg-hoversubject' }, branch)),
      h('div', { className: 'gmg-hoverzone is-foot' }, h('div', { className: 'gmg-hoverstats' }, t('hoverNoBranch'))),
    )
  }
  return h(
    'div',
    { className: 'gmg-hovercard' },
    h(
      'div',
      { className: 'gmg-hoverzone is-head' },
      h(IconBranch, { size: 12 }),
      h('span', { className: 'gmg-hoversubject' }, branch),
      h('span', { className: 'gmg-sha' }, detail.short),
    ),
    h(
      'div',
      { className: 'gmg-hoverzone is-subject' },
      branch,
    ),
    h(
      'div',
      { className: 'gmg-hoverzone is-body' },
      h('div', { className: 'gmg-hoversubject' }, detail.subject),
      h(
        'div',
        { className: 'gmg-hovertrack' },
        detail.upstream === null ? t('notPublished') : `${detail.upstream}${detail.track ? ` ${detail.track}` : ''}`,
      ),
    ),
    h(
      'div',
      { className: 'gmg-hoverzone is-foot' },
      h('div', { className: 'gmg-hoverstats' }, `${detail.author} · ${relativeTime(detail.date, currentLocale())}`),
    ),
  )
}
