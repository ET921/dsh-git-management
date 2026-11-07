/**
 * The Source Control panel.
 *
 * Layout follows the shape the user asked for — the VS Code / Cursor Source
 * Control view: a branch bar with sync actions, a commit box, staged and
 * unstaged groups of changed files, an inline unified diff, the recent
 * history, and a GitHub card. Everything is drawn from the store, so a poll, a
 * button, or a git command in a terminal all converge on the same picture.
 */

/** Fallback translator for the first render, before the plugin binds `t`. */
let gmgTranslate = (key) => key

/**
 * Translate one key, falling back to the key itself.
 * @param key - dictionary key.
 * @param vars - `{name}` substitutions.
 * @returns the localized string.
 */
function tr(key, vars) {
  const translated = gmgTranslate(key, vars)
  return typeof translated === 'string' ? translated : key
}

/**
 * The panel root: data loading, polling, and the page shell.
 * @param props - slot-injected props (`t` when the host provides it).
 * @returns the panel element.
 */
function GitPanel(props) {
  const state = useGitStore()
  const t = typeof props?.t === 'function' ? props.t : tr
  const lang = typeof props?.lang === 'string' ? props.lang : currentLocale()
  const compact = props?.compact === true
  const [showAllHistory, setShowAllHistory] = useState(false)

  // First mount: read the workspace list and settle on a repository.
  useEffect(() => {
    if (!gitStore.get().ready) gitStore.loadRepos()
  }, [])

  // Cheap, quiet polling while the panel is on screen: `git status` is the
  // only source of truth, and this is what makes a terminal commit appear here.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const current = gitStore.get()
      if (current.path !== null && current.busy === null) gitStore.refreshStatus()
    }
    const timer = window.setInterval(tick, 8000)
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const snapshot = state.status
  const repos = state.repos
  const gitRepos = repos.filter((repo) => repo.isRepo)
  const isRepo = snapshot?.isRepo === true
  const busy = state.busy

  const header = h(
    'div',
    { className: 'gmg-head' },
    h(
      'div',
      { className: 'gmg-head-main' },
      h('div', { className: 'gmg-title' }, h(IconBranch, { size: 16 }), t('panelTitle')),
      h('div', { className: 'gmg-sub' }, snapshot?.root ?? state.path ?? t('noRepo')),
    ),
    h(
      'div',
      { className: 'gmg-head-tools' },
      repos.length > 0
        ? h(
            'select',
            {
              className: 'gmg-select',
              value: state.path ?? '',
              title: t('switchRepo'),
              onChange: (event) => {
                const next = event.target.value
                if (next !== '' && next !== state.path) gitStore.selectRepo(next)
              },
            },
            repos.map((repo) =>
              h(
                'option',
                { key: repo.path, value: repo.path },
                `${repo.title}${repo.isRepo ? (repo.branch === null ? '' : ` · ${repo.branch}`) : ` · ${t('notARepoShort')}`}`,
              ),
            ),
          )
        : null,
      h(
        'button',
        {
          className: `gmg-icon-btn${busy === 'refresh' ? ' is-spinning' : ''}`,
          type: 'button',
          title: t('refresh'),
          'aria-label': t('refresh'),
          disabled: state.path === null || busy !== null,
          onClick: () => (isRepo ? gitStore.refreshAll() : gitStore.loadRepos()),
        },
        h(IconRefresh, { size: 15 }),
      ),
      h(
        'button',
        {
          className: 'gmg-icon-btn',
          type: 'button',
          title: t('loadRepos'),
          'aria-label': t('loadRepos'),
          disabled: busy !== null,
          onClick: () => gitStore.loadRepos(),
        },
        h(IconRepo, { size: 15 }),
      ),
    ),
  )

  const notices = []
  if (state.error !== null) {
    notices.push(
      h(
        'div',
        { className: 'gmg-notice is-error', key: 'error' },
        h(IconAlert, { size: 14 }),
        h('span', null, state.error),
        h(
          'button',
          { className: 'gmg-icon-btn', type: 'button', onClick: () => gitStore.dismiss(), title: t('dismiss') },
          h(IconClose, { size: 13 }),
        ),
      ),
    )
  }
  if (state.notice !== null) {
    notices.push(
      h(
        'div',
        { className: 'gmg-notice is-ok', key: 'notice' },
        h(IconCheck, { size: 14 }),
        h('span', null, state.notice),
        h(
          'button',
          { className: 'gmg-icon-btn', type: 'button', onClick: () => gitStore.dismiss(), title: t('dismiss') },
          h(IconClose, { size: 13 }),
        ),
      ),
    )
  }

  let body = null
  if (!state.ready) {
    body = h('div', { className: 'gmg-card' }, h('div', { className: 'gmg-empty' }, t('loading')))
  } else if (state.path === null && state.loadFailed === true) {
    // The last workspace read failed. Saying "pick a workspace" here would be a
    // lie — the list is empty because nobody could read it — so the card offers
    // the retry the user needs instead.
    body = h(
      'div',
      { className: 'gmg-card' },
      h('div', { className: 'gmg-empty' }, t('loadReposFailed')),
      h(
        'div',
        { className: 'gmg-form' },
        h(
          'button',
          { className: 'gmg-btn is-primary', type: 'button', disabled: busy !== null, onClick: () => gitStore.loadRepos() },
          h(IconRefresh, { size: 13 }),
          t('loadRepos'),
        ),
      ),
    )
  } else if (state.path === null) {
    body = h(
      'div',
      { className: 'gmg-card' },
      h('div', { className: 'gmg-empty' }, t('pickWorkspace')),
      repos.length > 0
        ? h(
            'div',
            { className: 'gmg-files' },
            repos.map((repo) =>
              h(
                'div',
                {
                  key: repo.path,
                  className: 'gmg-file',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => gitStore.selectRepo(repo.path),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') gitStore.selectRepo(repo.path)
                  },
                },
                h('span', { className: 'gmg-file-chevron' }, h(IconChevronRight, { size: 12 })),
                h('span', { className: 'gmg-path' }, h('span', { className: 'gmg-name' }, repo.title), h('span', { className: 'gmg-dir' }, ` ${repo.path}`)),
              ),
            ),
          )
        : null,
    )
  } else if (!isRepo) {
    body = h(
      'div',
      { className: 'gmg-card' },
      h('div', { className: 'gmg-empty' }, t('notARepo')),
      h(
        'div',
        { className: 'gmg-form' },
        h(
          'button',
          { className: 'gmg-btn is-primary', type: 'button', disabled: busy !== null, onClick: () => gitStore.initRepo() },
          h(IconBranch, { size: 14 }),
          t('initRepo'),
        ),
        h('div', { className: 'gmg-hint' }, t('initHint')),
      ),
    )
  } else {
    body = h(
      'div',
      { className: 'gmg-card' },
      h(BranchBar, { status: snapshot, t, busy, branches: state.branches }),
      h(CommitBox, { status: snapshot, state, t, busy }),
      h(ChangeGroup, { title: t('staged'), rows: snapshot.staged, staged: true, t, empty: null }),
      h(ChangeGroup, { title: t('changes'), rows: snapshot.changes, staged: false, t, empty: t('noChanges') }),
      snapshot.conflicts.length > 0
        ? h(ChangeGroup, { title: t('conflicts'), rows: snapshot.conflicts, staged: false, conflicts: true, t, empty: null })
        : null,
      snapshot.conflicts.length > 0 ? h(ConflictBar, { t, busy }) : null,
    )
  }

  const history = isRepo
    ? h(HistoryCard, { path: state.path, log: state.log, branches: state.branches, t, lang, expanded: showAllHistory, onToggle: () => setShowAllHistory((value) => !value) })
    : null

  const github = isRepo ? h(GithubCard, { status: snapshot, state, t, busy }) : null

  return h(
    'div',
    { className: `gmg-root${compact ? ' is-compact' : ''}` },
    h('div', { className: 'gmg-page' }, header, ...notices, body, h(WorktreeSection, { state, t, busy, isRepo }), history, github),
  )
}

/**
 * How many commits the list shows before "show all".
 * Ten is the point where a rail starts reading as a graph rather than a line,
 * while still fitting in the column without scrolling the panel away.
 */
const HISTORY_PREVIEW = 10

/**
 * Read one commit's `%D` decoration.
 *
 * Git hands back the decoration as it prints it — `HEAD -> dev`, `origin/dev`,
 * `tag: v1.0` — so the shape of the string is the kind, except that a plain
 * name is only a local branch if this checkout actually has one by that name.
 * Everything else is a remote.
 *
 * @param commit - one log row.
 * @param branches - the `branches` action result, or null before it arrives.
 * @returns `[{ name, kind }]`, `kind` being `head`, `branch`, `remote`, `tag` or `detached`.
 */
function historyRefs(commit, branches) {
  const local = new Set((branches?.branches ?? []).map((row) => row.name))
  return (commit.refs ?? []).map((decoration) => {
    if (decoration.startsWith('HEAD -> ')) return { name: decoration.slice(8), kind: 'head' }
    if (decoration === 'HEAD') return { name: 'HEAD', kind: 'detached' }
    if (decoration.startsWith('tag: ')) return { name: decoration.slice(5), kind: 'tag' }
    return { name: decoration, kind: local.has(decoration) ? 'branch' : 'remote' }
  })
}

/**
 * The glyph that goes inside a ref chip.
 *
 * Colour alone would be the only difference between "this branch lives on my
 * disk" and "this branch lives on the server", which a third of readers cannot
 * use. The glyph carries the same fact a second time: a filled dot for the
 * checkout, a branch mark for another local branch, a cloud for a remote, a tag
 * for a release.
 *
 * @param kind - one of `head`, `branch`, `remote`, `tag`, `detached`.
 * @returns the icon element, or null.
 */
function refGlyph(kind) {
  if (kind === 'head') return h('span', { className: 'gmg-ref-dot' })
  if (kind === 'branch') return h(IconBranch, { size: 9 })
  if (kind === 'remote') return h(IconCloud, { size: 10 })
  if (kind === 'tag') return h(IconTag, { size: 9 })
  return null
}

/**
 * Where one ref lives, in words, for the chip's tooltip.
 * @param kind - one of `head`, `branch`, `remote`, `tag`, `detached`.
 * @param t - translator.
 * @returns the label.
 */
function refScope(kind, t) {
  if (kind === 'head') return t('refHead')
  if (kind === 'branch') return t('refLocal')
  if (kind === 'remote') return t('refRemote')
  if (kind === 'tag') return t('refTag')
  return t('refDetached')
}

/**
 * The history card: the commit list on the left, the lane rail down its right.
 *
 * The rail is one SVG for the whole list rather than one per row, because a lane
 * has to join across row borders; the rows themselves only reserve the width the
 * rail occupies, and every row is pinned to `GRAPH_ROW_HEIGHT` so the two line
 * up. Refs ride on the row instead of the id: a reader needs to know "this is
 * main" far more often than "this is 1268d25", and the id is in the hover card.
 *
 * Every row is also the way into that commit: clicking it opens the commit's
 * change set as its own tab in the same column, the way Cursor's history does.
 * Clicking a second commit opens a second tab; the list itself never moves.
 *
 * @param props - `{ path, log, branches, t, lang, expanded, onToggle }`.
 * @returns the card.
 */
function HistoryCard(props) {
  const { path, log, branches, t, lang, expanded, onToggle } = props
  const visible = useMemo(() => (expanded ? log : log.slice(0, HISTORY_PREVIEW)), [log, expanded])
  const layout = useMemo(() => layoutHistory(visible), [visible])
  const railWidth = useMemo(() => graphRailWidth(layout), [layout])

  const openCommit = (commit) => {
    if (typeof gmgSidebarBridge.openCommit !== 'function') return
    gmgSidebarBridge.openCommit({ path, sha: commit.sha, short: commit.short, subject: commit.subject })
  }

  return h(
    'div',
    { className: 'gmg-card' },
    h(
      'div',
      { className: 'gmg-group-head' },
      h(IconCommit, { size: 13 }),
      t('history'),
      h('span', { className: 'gmg-count' }, ` ${log.length}`),
      h('span', { className: 'gmg-spacer' }),
      h('button', { className: 'gmg-btn is-ghost', type: 'button', onClick: onToggle }, expanded ? t('showLess') : t('showMore')),
    ),
    h(
      'div',
      { className: 'gmg-history', style: { '--gmg-graph-w': `${railWidth}px` } },
      log.length === 0
        ? h('div', { className: 'gmg-empty' }, t('noCommits'))
        : [
            h(HistoryGraph, { key: 'rail', rows: layout }),
            layout.map((row) => {
              const commit = row.commit
              const refs = historyRefs(commit, branches)
              const shown = refs.slice(0, 2)
              const extra = refs.length - shown.length
              const open = () => openCommit(commit)
              return h(
                HoverTarget,
                { key: commit.sha, card: h(CommitHoverCard, { commit, t }) },
                h(
                  'div',
                  {
                    className: 'gmg-commit-row',
                    role: 'button',
                    tabIndex: 0,
                    title: `${commit.short} — ${t('openCommitDiffHint')}`,
                    onClick: open,
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open()
                      }
                    },
                  },
                  shown.map((ref) => h('span', { key: ref.kind + ref.name, className: `gmg-ref is-${ref.kind}`, title: `${refScope(ref.kind, t)}：${ref.name}` }, refGlyph(ref.kind), ref.name)),
                  extra > 0 ? h('span', { className: 'gmg-ref-more', title: refs.map((ref) => ref.name).join(', ') }, `+${extra}`) : null,
                  h('span', { className: 'gmg-subject', title: commit.subject }, commit.subject),
                  h('span', { className: 'gmg-meta' }, `${commit.author} · ${relativeTime(commit.date, lang)}`),
                ),
              )
            }),
          ],
    ),
  )
}

/**
 * Every checkout of this repository — the visual half of DSH's worktree story.
 *
 * The list is the one DSH's own worktree tool produces (and any the user made
 * by hand), so a delegated Agent's checkout shows up beside the main tree with
 * its branch, its dirty count, and three ways out: switch the panel to it, open
 * it as a DSH workspace, or remove it.
 *
 * @param props - `{ state, t, busy, isRepo }`.
 * @returns the section, or null when there is nothing to show.
 */
function WorktreeSection(props) {
  const { state, t, busy, isRepo } = props
  const [creating, setCreating] = useState(false)
  const draft = state.worktreeDraft

  if (!isRepo) return null

  const data = state.worktrees
  const rows = data?.worktrees ?? []
  const rootKey = data?.rootKey ?? ''
  const root = data?.root ?? ''
  const currentKey = pathKey(state.path ?? '')
  const canOpen = canOpenWorkspace()

  const shorten = (row) => {
    if (root !== '' && row.key.startsWith(rootKey) && row.key.length > rootKey.length) {
      return row.path.slice(root.length).replace(/^[\\/]+/, '')
    }
    return row.path
  }

  const head = h(
    'div',
    { className: 'gmg-group-head' },
    h(IconWorktree, { size: 13 }),
    t('worktrees'),
    h('span', { className: 'gmg-count' }, rows.length > 0 ? ` ${rows.length}` : ''),
    h('span', { className: 'gmg-spacer' }),
    h(
      'button',
      {
        className: 'gmg-icon-btn',
        type: 'button',
        title: t('worktreePrune'),
        'aria-label': t('worktreePrune'),
        disabled: busy !== null,
        onClick: () => gitStore.pruneWorktrees(),
      },
      h(IconScissors, { size: 13 }),
    ),
    h(
      'button',
      {
        className: 'gmg-icon-btn',
        type: 'button',
        title: t('worktreeNew'),
        'aria-label': t('worktreeNew'),
        disabled: busy !== null,
        onClick: () => setCreating((value) => !value),
      },
      h(IconPlus, { size: 13 }),
    ),
  )

  const form = creating
    ? h(
        'form',
        {
          className: 'gmg-form',
          onSubmit: (event) => {
            event.preventDefault()
            const name = draft.trim()
            if (name === '') return
            gitStore.createWorktree(name).then((ok) => {
              if (ok) setCreating(false)
            })
          },
        },
        h('input', {
          className: 'gmg-input',
          autoFocus: true,
          placeholder: t('worktreeNamePlaceholder'),
          value: draft,
          onChange: (event) => gitStore.setWorktreeDraft(event.target.value),
        }),
        draft.trim() === ''
          ? h('div', { className: 'gmg-hint' }, t('worktreeLayoutHint'))
          : h(
              'div',
              { className: 'gmg-hint' },
              `${t('worktreeBranchPreview')}: worktree-${draft.trim()} · .agents/worktrees/${draft.trim()}`,
            ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          h('button', { className: 'gmg-btn is-ghost', type: 'button', onClick: () => setCreating(false) }, t('cancel')),
          h('button', { className: 'gmg-btn is-primary', type: 'submit', disabled: busy !== null || draft.trim() === '' }, t('create')),
        ),
      )
    : null

  const body =
    data === null
      ? h('div', { className: 'gmg-empty' }, state.worktreeStale ? t('worktreeStale') : state.worktreeError ?? t('loading'))
      : rows.length === 0
        ? h('div', { className: 'gmg-empty' }, t('worktreeNone'))
        : h(
            'div',
            { className: 'gmg-wts' },
            rows.map((row) => {
              const isCurrent = row.key === currentKey
              const label = row.detached ? `${t('detached')} ${String(row.head ?? '').slice(0, 7)}` : row.branch ?? ''
              return h(
                'div',
                { className: `gmg-wt${isCurrent ? ' is-current' : ''}`, key: row.key, title: row.path },
                h('span', { className: 'gmg-wt-branch' }, h(IconBranch, { size: 12 }), h('span', { className: 'gmg-wt-name' }, label)),
                row.main ? h('span', { className: 'gmg-wt-tag' }, t('worktreeMain')) : null,
                row.locked ? h('span', { className: 'gmg-wt-tag' }, 'locked') : null,
                row.prunable ? h('span', { className: 'gmg-wt-tag is-warn' }, 'prunable') : null,
                isCurrent ? h('span', { className: 'gmg-wt-tag is-current' }, '●') : null,
                h('span', { className: 'gmg-wt-path' }, shorten(row)),
                h(
                  'span',
                  { className: `gmg-wt-dirty${row.dirtyKnown && row.dirty > 0 ? ' is-dirty' : ''}` },
                  row.dirtyKnown ? (row.dirty === 0 ? t('worktreeClean') : String(row.dirty)) : '—',
                ),
                h(
                  'span',
                  { className: 'gmg-actions' },
                  h(
                    'button',
                    {
                      className: 'gmg-icon-btn',
                      type: 'button',
                      title: t('worktreeSwitch'),
                      'aria-label': t('worktreeSwitch'),
                      disabled: isCurrent || busy !== null,
                      onClick: () => gitStore.focusWorktree(row.path),
                    },
                    h(IconChevronRight, { size: 13 }),
                  ),
                  canOpen
                    ? h(
                        'button',
                        {
                          className: 'gmg-icon-btn',
                          type: 'button',
                          title: t('worktreeOpen'),
                          'aria-label': t('worktreeOpen'),
                          disabled: busy !== null || row.prunable,
                          onClick: () => gitStore.openWorktreeInDsh(row.path),
                        },
                        h(IconExternal, { size: 13 }),
                      )
                    : null,
                  row.main || isCurrent
                    ? null
                    : h(
                        'button',
                        {
                          className: 'gmg-icon-btn',
                          type: 'button',
                          title: t('worktreeRemove'),
                          'aria-label': t('worktreeRemove'),
                          disabled: busy !== null || row.prunable,
                          onClick: () => {
                            if (!window.confirm(t('worktreeRemoveConfirm', { path: row.path }))) return
                            gitStore.removeWorktree(row.path)
                          },
                        },
                        h(IconClose, { size: 13 }),
                      ),
                ),
              )
            }),
          )

  return h('div', { className: 'gmg-group' }, head, body, form)
}

/**
 * The tab's chip label: the branch mark, the panel name, and how many files are
 * waiting — so the count is readable while the tab is collapsed to a chip.
 * @param props - slot-injected props.
 * @returns the title element.
 */
function GitTabTitle(props) {
  const state = useGitStore()
  const t = typeof props?.t === 'function' ? props.t : tr
  const counts = state.status
  const changed = counts === null ? 0 : counts.staged.length + counts.changes.length + counts.conflicts.length
  return h(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
    h(IconBranch, { size: 13 }),
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('panelTitle')),
    changed > 0 ? h('span', { className: 'gmg-gh-label', title: t('changesCount') }, String(changed)) : null,
  )
}

/**
 * The branch pill and its menu.
 *
 * A native `<select>` used to do this job from under the pill, and the list it
 * opened was drawn by the OS: a white sheet with a system-blue selection on
 * top of a dark panel. The menu here is the same floating surface the hover
 * cards use — theme tokens, rounded corners, the panel's own shadow — and it
 * marks the current branch instead of leaving the reader to spot which row is
 * already active.
 *
 * @param props - `{ status, branches, t }`.
 * @returns the pill with its menu.
 */
function BranchPicker(props) {
  const { status, branches, t } = props
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [active, setActive] = useState(0)
  const pill = useRef(null)
  const menu = useRef(null)
  const rows = branches?.branches ?? []
  const current = status.branch ?? null
  const names = rows.map((row) => row.name)

  const close = () => setOpen(false)
  const pick = (name) => {
    close()
    if (name !== current) gitStore.switchBranch(name)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event) => {
      const target = event.target
      if (menu.current?.contains(target) === true) return
      if (pill.current?.contains(target) === true) return
      close()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((index) => Math.min(names.length - 1, index + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((index) => Math.max(0, index - 1))
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const name = names[active]
        if (name !== undefined) pick(name)
      }
    }
    const onResize = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, active, names.length])

  // Keep the arrow-key highlight inside the visible part of a long list.
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector('.gmg-branchitem.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    // The menu is portalled, so the pill's box is captured now: by the time the
    // menu renders the button may already have been scrolled or re-styled.
    setAnchor(pill.current?.getBoundingClientRect() ?? null)
    setActive(Math.max(0, names.indexOf(current)))
    setOpen(true)
  }

  return h(
    'div',
    { className: 'gmg-branchpick' },
    h(
      'button',
      {
        ref: pill,
        type: 'button',
        className: `gmg-branch${current === null ? ' is-detached' : ''}${open ? ' is-open' : ''}`,
        title: t('switchBranch'),
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        onClick: toggle,
      },
      h(IconBranch, { size: 13 }),
      h('span', { className: 'gmg-branch-name' }, current ?? t('detached')),
      h(IconChevronDown, { size: 10 }),
    ),
    open && anchor !== null
      ? h(BranchMenu, { anchor, rows, current, active, onHover: setActive, onPick: pick, menuRef: menu, t })
      : null,
  )
}

/**
 * The branch list, portalled so the panel's scroll box cannot clip it.
 *
 * @param props - `{ anchor, rows, current, active, onHover, onPick, menuRef, t }`.
 * @returns the menu.
 */
function BranchMenu(props) {
  const { anchor, rows, current, active, onHover, onPick, menuRef, t } = props
  const [style, setStyle] = useState({ left: -9999, top: 0, visibility: 'hidden' })
  useLayoutEffect(() => {
    const element = menuRef.current
    if (element === null || anchor === null) return
    const rect = element.getBoundingClientRect()
    const width = Math.min(300, Math.max(200, Math.round(anchor.width) || 0))
    const below = anchor.bottom + 6
    const fitsBelow = below + rect.height <= window.innerHeight - 8
    setStyle({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: fitsBelow ? below : Math.max(8, anchor.top - rect.height - 6),
      width,
      visibility: 'visible',
    })
  }, [anchor, rows.length])
  const list = h(
    'div',
    {
      ref: menuRef,
      className: 'gmg-branchmenu',
      role: 'listbox',
      'aria-label': t('switchBranch'),
      style,
    },
    rows.length === 0
      ? h('div', { className: 'gmg-branchmenu-empty' }, t('loading'))
      : rows.map((row, index) =>
          h(
            'div',
            {
              key: row.name,
              role: 'option',
              'aria-selected': row.name === current,
              className: `gmg-branchitem${row.name === current ? ' is-current' : ''}${index === active ? ' is-active' : ''}`,
              title: row.upstream ?? row.name,
              onMouseEnter: () => onHover(index),
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => onPick(row.name),
            },
            h('span', { className: 'gmg-branchitem-name' }, row.name),
            row.name === current ? h('span', { className: 'gmg-branchcheck' }, h(IconCheck, { size: 12 })) : null,
          ),
        ),
  )
  if (typeof reactDom?.createPortal !== 'function') return list
  return reactDom.createPortal(list, document.body)
}

/**
 * The branch pill, the upstream tracking line, and the fetch/pull/push actions.
 * @param props - `{ status, t, busy }`.
 * @returns the branch bar element.
 */
function BranchBar(props) {
  const { status, t, busy, branches } = props
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  const upstream = status.upstream

  return h(
    'div',
    { className: 'gmg-branchbar' },
    h(
      HoverTarget,
      { card: status.branch === null ? null : h(BranchHoverCard, { branch: status.branch, t }) },
      h(BranchPicker, { status, branches, t }),
    ),
    upstream === null
      ? h('span', { className: 'gmg-track', title: t('notPublished') }, h(IconCloud, { size: 12 }), t('notPublished'))
      : h(
          'span',
          {
            // The relationship to the server, in colour: level with it, ahead of
            // it, behind it, or both at once. The arrows carry the same fact.
            className: `gmg-track is-${ahead > 0 && behind > 0 ? 'diverged' : ahead > 0 ? 'ahead' : behind > 0 ? 'behind' : 'synced'}`,
            title: `${upstream} · ${t('refRemote')}`,
          },
          h(IconCloud, { size: 12 }),
          upstream,
          ahead > 0 ? h('span', { className: 'gmg-ahead' }, `↑${ahead}`) : null,
          behind > 0 ? h('span', { className: 'gmg-behind' }, `↓${behind}`) : null,
          ahead === 0 && behind === 0 ? h('span', { className: 'gmg-synced' }, '✓') : null,
        ),
    h('span', { className: 'gmg-spacer' }),
    h(
      'button',
      { className: 'gmg-btn', type: 'button', disabled: busy !== null || upstream === null, onClick: () => gitStore.remote('fetch'), title: t('fetchHint') },
      h(IconDownload, { size: 13 }),
      t('fetch'),
    ),
    h(
      'button',
      { className: 'gmg-btn', type: 'button', disabled: busy !== null || upstream === null, onClick: () => gitStore.remote('pull'), title: t('pullHint') },
      t('pull'),
      behind > 0 ? h('span', { className: 'gmg-behind' }, behind) : null,
    ),
    h(
      'button',
      { className: 'gmg-btn', type: 'button', disabled: busy !== null, onClick: () => gitStore.remote('push'), title: t('pushHint') },
      h(IconUpload, { size: 13 }),
      t('push'),
      ahead > 0 ? h('span', { className: 'gmg-ahead' }, ahead) : null,
    ),
    h(
      'button',
      {
        className: 'gmg-btn is-ghost',
        type: 'button',
        disabled: busy !== null,
        title: t('newBranch'),
        onClick: () => setCreating((value) => !value),
      },
      h(IconPlus, { size: 13 }),
    ),
    creating
      ? h(
          'form',
          {
            className: 'gmg-form',
            style: { flexDirection: 'row', alignItems: 'center', padding: 0, border: 'none', width: '100%' },
            onSubmit: (event) => {
              event.preventDefault()
              const name = draft.trim()
              if (name === '') return
              gitStore.createBranch(name).then((ok) => {
                if (ok) {
                  setDraft('')
                  setCreating(false)
                }
              })
            },
          },
          h('input', {
            className: 'gmg-input',
            style: { flex: 1 },
            autoFocus: true,
            placeholder: t('newBranchPlaceholder'),
            value: draft,
            onChange: (event) => setDraft(event.target.value),
          }),
          h('button', { className: 'gmg-btn is-primary', type: 'submit', disabled: busy !== null }, t('create')),
          h(
            'button',
            { className: 'gmg-btn is-ghost', type: 'button', onClick: () => setCreating(false) },
            h(IconClose, { size: 13 }),
          ),
        )
      : null,
  )
}

/**
 * Commit message plus the staged/everything choice and the amend toggle.
 * @param props - `{ status, state, t, busy }`.
 * @returns the commit box element.
 */
function CommitBox(props) {
  const { status, state, t, busy } = props
  const stagedCount = status.staged.length
  const changeCount = status.changes.length
  const blocked = status.conflicts.length > 0
  const canCommit = state.message.trim() !== '' && (stagedCount > 0 || state.stageAll) && busy === null && !blocked

  const submit = () => {
    if (!canCommit) return
    gitStore.commit()
  }

  const toggleAmend = (checked) => {
    gitStore.setFlag('amend', checked)
    // Preview the message an amend would replace, but never overwrite a draft.
    if (checked && gitStore.get().message.trim() === '') {
      const head = gitStore.get().log[0]
      if (typeof head?.subject === 'string' && head.subject !== '') gitStore.setMessage(head.subject)
    }
  }

  return h(
    'div',
    { className: 'gmg-commit' },
    h('textarea', {
      className: 'gmg-textarea',
      placeholder: t('commitPlaceholder'),
      value: state.message,
      spellCheck: false,
      onChange: (event) => gitStore.setMessage(event.target.value),
      onKeyDown: (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          submit()
        }
      },
    }),
    h(
      'div',
      { className: 'gmg-commit-foot' },
      h(
        'label',
        { className: 'gmg-check' },
        h('input', {
          type: 'checkbox',
          checked: state.stageAll,
          onChange: (event) => gitStore.setFlag('stageAll', event.target.checked),
        }),
        t('stageAll'),
      ),
      h(
        'label',
        { className: 'gmg-check' },
        h('input', {
          type: 'checkbox',
          checked: state.amend,
          disabled: !status.oid,
          onChange: (event) => toggleAmend(event.target.checked),
        }),
        t('amend'),
      ),
      blocked ? h('span', { className: 'gmg-hint gmg-conflict-hint' }, t('conflictBlockHint')) : null,
      h('span', { className: 'gmg-spacer' }),
      h(
        'span',
        { className: 'gmg-hint gmg-counts' },
        `${stagedCount} ${t('stagedCount')} · ${changeCount} ${t('changesCount')}`,
      ),
      h('span', { className: 'gmg-hint gmg-kbd-hint' }, h('span', { className: 'gmg-kbd' }, 'Ctrl+Enter')),
      h(
        'button',
        {
          className: 'gmg-btn is-primary',
          type: 'button',
          disabled: !canCommit,
          onClick: submit,
          title: t('commitHint'),
        },
        busy === 'commit' ? h(IconRefresh, { size: 13 }) : h(IconCheck, { size: 13 }),
        t('commit'),
      ),
    ),
  )
}

/**
 * One group of files (staged, changes, or conflicts).
 * @param props - `{ title, rows, staged, t, empty, conflicts }`.
 * @returns the group element.
 */
function ChangeGroup(props) {
  const { title, rows, staged, t, empty, conflicts } = props
  // The list is the tallest thing in the column and the one readers fold away
  // most often: one click on the header collapses it, and the count stays
  // visible so a folded group still says how much is inside.
  const [collapsed, setCollapsed] = useState(false)
  if (rows.length === 0 && empty === null) return null
  const body =
    rows.length === 0
      ? h('div', { className: 'gmg-empty' }, empty)
      : h('div', { className: 'gmg-files' }, rows.map((row) => h(FileRow, { key: `${staged ? 's' : 'w'}:${row.path}`, row, staged, t, conflicts })))
  return h(
    'div',
    { className: collapsed ? 'gmg-group is-collapsed' : 'gmg-group' },
    h(
      'div',
      { className: 'gmg-group-head' },
      h(
        'button',
        {
          className: 'gmg-collapse',
          type: 'button',
          title: collapsed ? t('expandGroup') : t('collapseGroup'),
          'aria-label': collapsed ? t('expandGroup') : t('collapseGroup'),
          'aria-expanded': collapsed === false,
          disabled: rows.length === 0,
          onClick: () => setCollapsed((value) => !value),
        },
        h(IconChevronDown, { size: 12 }),
      ),
      title,
      h('span', { className: 'gmg-count' }, String(rows.length)),
      h('span', { className: 'gmg-spacer' }),
      rows.length > 0 && !conflicts
        ? h(
            'button',
            {
              className: 'gmg-icon-btn',
              type: 'button',
              title: staged ? t('unstageAll') : t('stageAllFiles'),
              'aria-label': staged ? t('unstageAll') : t('stageAllFiles'),
              onClick: () => (staged ? gitStore.unstageAll() : gitStore.stageAll()),
            },
            staged ? h(IconMinus, { size: 13 }) : h(IconPlus, { size: 13 }),
          )
        : null,
    ),
    collapsed ? null : body,
  )
}

/**
 * The conflict summary strip: the blocked-commit explanation and the one way
 * out of a merge that went wrong.
 * @param props - `{ t, busy }`.
 * @returns the strip element.
 */
function ConflictBar(props) {
  const { t, busy } = props
  return h(
    'div',
    { className: 'gmg-group gmg-conflict' },
    h(
      'div',
      { className: 'gmg-group-head' },
      h(IconAlert, { size: 13 }),
      t('conflicts'),
      h('span', { className: 'gmg-spacer' }),
      h(
        'button',
        {
          className: 'gmg-btn is-danger',
          type: 'button',
          disabled: busy !== null,
          onClick: () => {
            if (!window.confirm(t('mergeAbortConfirm'))) return
            gitStore.abortMerge()
          },
        },
        t('abortMerge'),
      ),
    ),
    h('div', { className: 'gmg-hint', style: { padding: '0 12px 10px' } }, t('conflictBlockHint')),
  )
}

/**
 * One changed file. Clicking it opens that file's diff in the centre column.
 * @param props - `{ row, staged, t, conflicts }`.
 * @returns the row element.
 */
function FileRow(props) {
  const { row, staged, t, conflicts } = props
  const state = useGitStore()
  const { name, dir } = splitPath(row.path)
  const untracked = row.kind === 'untracked'
  const openThis = () => {
    if (typeof gmgSidebarBridge.openDiff === 'function') {
      gmgSidebarBridge.openDiff({ path: state.path, file: row.path, staged, status: row.status })
    }
  }

  const discard = () => {
    const message = untracked ? t('deleteConfirm', { file: row.path }) : t('discardConfirm', { file: row.path })
    if (!window.confirm(message)) return
    gitStore.fileAction(untracked ? 'deleteUntracked' : 'discard', [row.path], untracked ? t('deleted') : t('discarded'))
  }

  const actions = []
  if (staged) {
    actions.push(
      h(
        'button',
        {
          key: 'unstage',
          className: 'gmg-icon-btn',
          type: 'button',
          title: t('unstage'),
          'aria-label': t('unstage'),
          onClick: (event) => {
            event.stopPropagation()
            gitStore.fileAction('unstage', [row.path], null)
          },
        },
        h(IconMinus, { size: 13 }),
      ),
    )
  } else if (conflicts) {
    actions.push(
      h(
        'button',
        {
          key: 'resolve',
          className: 'gmg-icon-btn',
          type: 'button',
          title: t('markResolved'),
          'aria-label': t('markResolved'),
          onClick: (event) => {
            event.stopPropagation()
            gitStore.fileAction('stage', [row.path], null)
          },
        },
        h(IconCheck, { size: 13 }),
      ),
    )
  } else {
    actions.push(
      h(
        'button',
        {
          key: 'stage',
          className: 'gmg-icon-btn',
          type: 'button',
          title: t('stage'),
          'aria-label': t('stage'),
          onClick: (event) => {
            event.stopPropagation()
            gitStore.fileAction('stage', [row.path], null)
          },
        },
        h(IconPlus, { size: 13 }),
      ),
      h(
        'button',
        {
          key: 'discard',
          className: 'gmg-icon-btn',
          type: 'button',
          title: untracked ? t('delete') : t('discard'),
          'aria-label': untracked ? t('delete') : t('discard'),
          onClick: (event) => {
            event.stopPropagation()
            discard()
          },
        },
        h(IconUndo, { size: 13 }),
      ),
    )
  }

  return h(
    'div',
    null,
    h(
      'div',
      {
        className: 'gmg-file',
        role: 'button',
        tabIndex: 0,
        title: `${row.path} — ${t('openDiffHint')}`,
        onClick: openThis,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openThis()
          }
        },
      },
      h('span', { className: 'gmg-file-chevron' }, h(IconChevronRight, { size: 11 })),
      h('span', { className: 'gmg-status', style: { color: statusColor(row.status) }, title: t('status') }, statusGlyph(row.status)),
      h(
        'span',
        { className: 'gmg-path' },
        h('span', { className: 'gmg-name' }, name),
        dir === '' ? null : h('span', { className: 'gmg-dir' }, dir),
      ),
      row.additions > 0 ? h('span', { className: 'gmg-add-count gmg-stats' }, `+${row.additions}`) : null,
      row.deletions > 0 ? h('span', { className: 'gmg-del-count gmg-stats' }, `-${row.deletions}`) : null,
      h('span', { className: 'gmg-actions' }, ...actions),
    ),
  )
}

/**
 * The GitHub card: the remote, the repository facts, pulls, issues, and the
 * create-pull form. Everything here is optional — a repository without a
 * GitHub remote simply shows the hint instead.
 * @param props - `{ status, state, t, busy }`.
 * @returns the card element.
 */
function GithubCard(props) {
  const { state, t, busy } = props
  const [tab, setTab] = useState('pulls')
  const [tokenDraft, setTokenDraft] = useState('')
  const [pullTitle, setPullTitle] = useState('')
  const [pullBody, setPullBody] = useState('')
  const [pullBase, setPullBase] = useState('')
  const [showPullForm, setShowPullForm] = useState(false)

  const github = state.github
  const branch = state.status?.branch ?? null

  // Resolve the remote, then the repository facts, then the first pull list —
  // each step needs the previous one's answer, and stopping at the repo facts
  // left the Pull requests tab saying "reading…" until it was clicked.
  useEffect(() => {
    if (state.path === null) return
    if (github === null) {
      gitStore.loadGithub('repo')
      return
    }
    if (github.connected !== true || github.authorized !== true) return
    if (github.repo === undefined) {
      gitStore.loadGithub('repo')
      return
    }
    if (github.pulls === undefined) gitStore.loadGithub('pulls')
  }, [state.path, github?.connected, github?.authorized, github?.repo, github?.pulls])

  if (github === null) {
    return h('div', { className: 'gmg-card' }, h('div', { className: 'gmg-empty' }, t('githubLoading')))
  }
  if (github.connected === false) {
    return h(
      'div',
      { className: 'gmg-card' },
      h('div', { className: 'gmg-group-head' }, h(IconGithub, { size: 13 }), 'GitHub'),
      h('div', { className: 'gmg-empty' }, t('noGithubRemote')),
    )
  }

  const remote = github.remote
  const repo = github.repo
  const webUrl = remote?.webUrl ?? null

  const head = h(
    'div',
    { className: 'gmg-gh-head' },
    h(
      'span',
      { className: 'gmg-gh-name' },
      h(IconGithub, { size: 14 }),
      webUrl === null ? (remote?.slug ?? '') : h('a', { href: webUrl, target: '_blank', rel: 'noreferrer', style: { color: 'inherit' }, onClick: (event) => event.stopPropagation() }, remote.slug),
      repo?.private === true ? h(IconLock, { size: 12 }) : null,
    ),
    h(
      'span',
      { className: 'gmg-gh-stats' },
      repo === undefined
        ? null
        : h('span', { title: t('stars') }, h(IconStar, { size: 12 }), String(repo.stars ?? 0)),
      repo === undefined ? null : h('span', { title: t('forks') }, h(IconFork, { size: 12 }), String(repo.forks ?? 0)),
      repo === undefined ? null : h('span', { title: t('openIssues') }, h(IconIssue, { size: 12 }), String(repo.openIssues ?? 0)),
    ),
    h('span', { className: 'gmg-spacer' }),
    webUrl === null
      ? null
      : h('a', { className: 'gmg-btn is-ghost', href: webUrl, target: '_blank', rel: 'noreferrer' }, h(IconExternal, { size: 12 }), t('openOnGithub')),
    github.authorized === true
      ? h(
          'button',
          {
            className: 'gmg-btn',
            type: 'button',
            disabled: busy !== null || branch === null,
            onClick: () => {
              const base = repo?.defaultBranch ?? ''
              setPullBase((current) => (current === '' ? base : current))
              setPullTitle((current) => (current === '' ? `${t('pullTitleDefault')} ${branch ?? ''}`.trim() : current))
              setShowPullForm((value) => !value)
            },
          },
          h(IconPullRequest, { size: 13 }),
          t('newPull'),
        )
      : null,
  )

  let content = null
  if (github.authorized === false) {
    content = h(
      'div',
      { className: 'gmg-form' },
      h('div', { className: 'gmg-hint' }, t('tokenHint')),
      state.editingToken || (github.reason === 'no-token' && true)
        ? h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('input', {
              className: 'gmg-input',
              style: { flex: 1 },
              type: 'password',
              placeholder: 'ghp_… / github_pat_…',
              value: tokenDraft,
              onChange: (event) => setTokenDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') gitStore.saveToken(tokenDraft)
              },
            }),
            h('button', { className: 'gmg-btn is-primary', type: 'button', onClick: () => gitStore.saveToken(tokenDraft) }, t('save')),
            h('a', { className: 'gmg-btn is-ghost', href: 'https://github.com/settings/tokens', target: '_blank', rel: 'noreferrer' }, h(IconExternal, { size: 12 }), t('createToken')),
          )
        : null,
      github.reason === 'error'
        ? h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('span', { className: 'gmg-hint', style: { flex: 1 } }, github.error ?? ''),
            h(
              'button',
              { className: 'gmg-btn', type: 'button', disabled: busy !== null, onClick: () => gitStore.loadGithub('repo') },
              t('retryGithub'),
            ),
          )
        : null,
      h('div', { className: 'gmg-hint' }, t('tokenScope')),
    )
  } else if (github.authorized === true) {
    const rows =
      tab === 'pulls'
        ? (github.pulls ?? []).map((pull) =>
            h(
              'a',
              { className: 'gmg-gh-row', key: pull.number, href: pull.url, target: '_blank', rel: 'noreferrer' },
              h(IconPullRequest, { size: 12 }),
              h('span', { className: 'gmg-gh-num' }, `#${pull.number}`),
              h('span', { className: 'gmg-gh-title' }, pull.title),
              pull.draft ? h('span', { className: 'gmg-gh-label' }, t('draft')) : null,
              h('span', { className: 'gmg-meta' }, `${pull.head} → ${pull.base}`),
            ),
          )
        : (github.issues ?? []).map((issue) =>
            h(
              'a',
              { className: 'gmg-gh-row', key: issue.number, href: issue.url, target: '_blank', rel: 'noreferrer' },
              h(IconIssue, { size: 12 }),
              h('span', { className: 'gmg-gh-num' }, `#${issue.number}`),
              h('span', { className: 'gmg-gh-title' }, issue.title),
              ...(issue.labels ?? []).slice(0, 2).map((label) => h('span', { className: 'gmg-gh-label', key: label }, label)),
            ),
          )

    content = h(
      'div',
      { className: 'gmg-gh-body' },
      h(
        'div',
        { className: 'gmg-gh-tabs' },
        h(
          'button',
          {
            className: `gmg-gh-tab${tab === 'pulls' ? ' is-active' : ''}`,
            type: 'button',
            onClick: () => {
              setTab('pulls')
              gitStore.loadGithub('pulls')
            },
          },
          h(IconPullRequest, { size: 12 }),
          `${t('pulls')}${github.pulls === undefined ? '' : ` ${github.pulls.length}`}`,
        ),
        h(
          'button',
          {
            className: `gmg-gh-tab${tab === 'issues' ? ' is-active' : ''}`,
            type: 'button',
            onClick: () => {
              setTab('issues')
              gitStore.loadGithub('issues')
            },
          },
          h(IconIssue, { size: 12 }),
          `${t('issues')}${github.issues === undefined ? '' : ` ${github.issues.length}`}`,
        ),
        h('span', { className: 'gmg-spacer' }),
        h('button', { className: 'gmg-gh-tab', type: 'button', onClick: () => gitStore.loadGithub(tab === 'pulls' ? 'pulls' : 'issues') }, h(IconRefresh, { size: 12 })),
      ),
      h(
        'div',
        { className: 'gmg-scroll-cap' },
        rows.length === 0
          ? h('div', { className: 'gmg-empty' }, githubReasonText(t, tab, github))
          : rows,
      ),
      showPullForm
        ? h(
            'div',
            { className: 'gmg-form' },
            h('input', {
              className: 'gmg-input',
              placeholder: t('pullTitle'),
              value: pullTitle,
              onChange: (event) => setPullTitle(event.target.value),
            }),
            h('textarea', {
              className: 'gmg-textarea',
              style: { minHeight: 54 },
              placeholder: t('pullBody'),
              value: pullBody,
              onChange: (event) => setPullBody(event.target.value),
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { className: 'gmg-hint' }, `${branch ?? '?'} →`),
              h('input', {
                className: 'gmg-input',
                style: { width: 140 },
                placeholder: t('baseBranch'),
                value: pullBase,
                onChange: (event) => setPullBase(event.target.value),
              }),
              h('span', { className: 'gmg-spacer' }),
              h('button', { className: 'gmg-btn is-ghost', type: 'button', onClick: () => setShowPullForm(false) }, t('cancel')),
              h(
                'button',
                {
                  className: 'gmg-btn is-primary',
                  type: 'button',
                  disabled: busy !== null,
                  onClick: () =>
                    gitStore.createPull({ title: pullTitle, body: pullBody, base: pullBase }).then((pull) => {
                      if (pull !== null) setShowPullForm(false)
                    }),
                },
                t('createPull'),
              ),
            ),
          )
        : null,
    )
  }

  return h(
    'div',
    { className: 'gmg-card gmg-gh' },
    h('div', { className: 'gmg-group-head' }, h(IconGithub, { size: 13 }), 'GitHub', h('span', { className: 'gmg-spacer' }), repo === undefined ? null : h('span', { className: 'gmg-meta' }, repo.defaultBranch ?? '')),
    head,
    repo?.description ? h('div', { className: 'gmg-gh-desc', style: { padding: '0 12px 10px' } }, repo.description) : null,
    content,
  )
}

/**
 * The empty-state line for a GitHub list.
 * @param t - translator.
 * @param tab - `pulls` or `issues`.
 * @param github - the current GitHub state.
 * @returns the sentence to show.
 */
function githubReasonText(t, tab, github) {
  if (tab === 'pulls' && github.pulls !== undefined) return t('noPulls')
  if (tab === 'issues' && github.issues !== undefined) return t('noIssues')
  return t('loading')
}

/**
 * The GUI's current locale id, as far as relative times need it.
 * @returns `zh` when the interface is Chinese, else `en`.
 */
function currentLocale() {
  try {
    const htmlLang = document.documentElement?.lang ?? ''
    return /^zh/i.test(htmlLang) ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}
