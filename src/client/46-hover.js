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

/** The card's width band, in px. */
const HOVER_WIDTH_MIN = 240
const HOVER_WIDTH_MAX = 400

/** How far the card's right edge stays from the column's left edge, in px. */
const HOVER_GAP = 12

/** How far the card stays from every window edge, in px. */
const HOVER_MARGIN = 8

/**
 * The floating layer.
 *
 * One direction, always: the card opens in the gap to the **left** of the
 * column, its right edge `HOVER_GAP` clear of the panel. The conversation
 * behind that gap is the one surface it is allowed to cover — covering it is
 * what keeps the rows it describes readable under the pointer, and a 320-400
 * px column has nowhere else to put a card this size.
 *
 * Its height follows the content with no cap of ours: a long commit body is
 * shown whole. Only the window bounds it — taller than the viewport, the card
 * is pinned to the top edge and scrolls, with the head zone stuck there. When
 * the window is too narrow for the card's width, the card narrows to the room
 * it has instead of sliding sideways onto the rows.
 *
 * @param props - `{ anchor, onEnter, onLeave, children }`.
 * @returns the card, portalled when the module table allows it.
 */
function HoverLayer(props) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ left: -9999, top: 0, visibility: 'hidden' })
  const place = () => {
    const element = ref.current
    if (element === null) return
    const anchor = props.anchor
    const edge = anchor.panelLeft ?? anchor.left
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const room = Math.max(0, edge - HOVER_GAP - HOVER_MARGIN)
    const wanted = Math.min(HOVER_WIDTH_MAX, Math.max(HOVER_WIDTH_MIN, Math.round(anchor.width) || 340))
    // Width first, then measure: a wrapped body is as tall as the width it
    // wraps at, so measuring before the width is applied counts the wrong
    // number of lines and misjudges whether the card fits the window.
    const width = room >= HOVER_WIDTH_MIN ? Math.min(wanted, room) : Math.min(wanted, viewportWidth - HOVER_MARGIN * 2)
    element.style.width = `${width}px`
    const measured = element.getBoundingClientRect().height
    const fits = measured <= viewportHeight - HOVER_MARGIN * 2
    setStyle({
      left: Math.max(HOVER_MARGIN, edge - HOVER_GAP - width),
      top: fits ? Math.max(HOVER_MARGIN, Math.min(anchor.top, viewportHeight - HOVER_MARGIN - measured)) : HOVER_MARGIN,
      width,
      visibility: 'visible',
      ...(fits ? {} : { maxHeight: viewportHeight - HOVER_MARGIN * 2, overflowY: 'auto' }),
    })
  }
  useLayoutEffect(place, [props.anchor.left, props.anchor.top, props.anchor.panelLeft, props.anchor.width, props.children])
  // A window that changes size while a card is open moves the column with it;
  // re-place instead of leaving the card sitting on the rows.
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })
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
 * Wrap a row so that resting the pointer on it opens its card beside the column.
 *
 * The wrapper measures two boxes before it arms the dwell timer: the row it
 * describes, and the column the row sits in. The column's left edge is what
 * the card hangs from, so the card leaves the list alone even when the row is
 * indented, and the list never moves: the card is out of the layout.
 *
 * Leaving the row does not close the card at once: the pointer may be on its
 * way into the card to scroll it. The close is postponed, and entering the
 * card cancels that.
 *
 * @param props - `{ card, delay, children }`.
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
    // The panel's own box is the boundary the card hangs from: a row has
    // padding, and the card must clear the panel, not just the row's text.
    const panel = typeof row?.closest === 'function' ? row.closest('.gmg-root') : null
    const panelBox = panel?.getBoundingClientRect?.()
    const next =
      box === undefined || box === null
        ? { left: event.clientX, top: event.clientY, panelLeft: event.clientX, width: 320 }
        : { left: box.left, top: box.top, panelLeft: panelBox?.left ?? box.left, width: box.width }
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
 * The hover card and the commit tab share one pair of quiet extras (P2-1):
 * copy the full sha, and open that exact commit on GitHub when the panel is
 * authorised. They never restyle the card, never fetch anything new, and the
 * link only exists while the GitHub card already resolved a `webUrl`.
 *
 * @param props - `{ sha }`.
 * @returns the control row.
 */
function CommitLinkZone(props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const webUrl = gitStore.get().github?.remote?.webUrl ?? null
  const copy = async () => {
    if (await copyToClipboard(props.sha)) {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    }
  }
  return h(
    'div',
    { className: 'gmg-quicklinks' },
    h(
      'button',
      {
        className: 'gmg-icon-btn',
        type: 'button',
        title: copied ? tr('copied') : tr('copySha'),
        'aria-label': tr('copySha'),
        onClick: (event) => {
          event.stopPropagation()
          copy()
        },
      },
      // IconCopy is design's (20-icons.js). The fallback is a text glyph, so a
      // page newer than the icon file still renders the control instead of
      // killing the bundle on one missing symbol.
      typeof IconCopy === 'function' ? h(IconCopy, { size: 11 }) : h('span', null, '⧉'),
    ),
    webUrl === null
      ? null
      : h(
          'a',
          {
            className: 'gmg-icon-btn',
            href: `${webUrl}/commit/${props.sha}`,
            target: '_blank',
            rel: 'noreferrer',
            title: tr('openCommitOnGithub'),
            'aria-label': tr('openCommitOnGithub'),
            onClick: (event) => event.stopPropagation(),
          },
          h(IconExternal, { size: 11 }),
        ),
  )
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
    body === '' ? null : h('div', { className: 'gmg-hoverzone is-body' }, body),
    detail !== null
      ? h(CommitStatZone, { files: detail.files, additions: detail.additions, deletions: detail.deletions, t })
      : error === null
        ? h('div', { className: 'gmg-hoverzone is-foot' }, h('div', { className: 'gmg-hoverstats' }, t('hoverLoading')))
        : null,
    detail !== null ? h(CommitLinkZone, { sha: commit.sha }) : null,
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
