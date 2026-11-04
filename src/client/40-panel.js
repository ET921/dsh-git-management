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
      if (current.path !== null && current.busy === null) gitStore.refresh()
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
      h(BranchBar, { status: snapshot, t, busy }),
      h(CommitBox, { status: snapshot, state, t, busy }),
      h(ChangeGroup, { title: t('staged'), rows: snapshot.staged, staged: true, t, empty: null }),
      h(ChangeGroup, { title: t('changes'), rows: snapshot.changes, staged: false, t, empty: t('noChanges') }),
      snapshot.conflicts.length > 0
        ? h(ChangeGroup, { title: t('conflicts'), rows: snapshot.conflicts, staged: false, conflicts: true, t, empty: null })
        : null,
    )
  }

  const history = isRepo
    ? h(
        'div',
        { className: 'gmg-card' },
        h(
          'div',
          { className: 'gmg-group-head' },
          h(IconCommit, { size: 13 }),
          t('history'),
          h('span', { className: 'gmg-count' }, ` ${state.log.length}`),
          h('span', { className: 'gmg-spacer' }),
          h(
            'button',
            { className: 'gmg-btn is-ghost', type: 'button', onClick: () => setShowAllHistory((value) => !value) },
            showAllHistory ? t('showLess') : t('showMore'),
          ),
        ),
        h(
          'div',
          { className: 'gmg-history' },
          state.log.length === 0
            ? h('div', { className: 'gmg-empty' }, t('noCommits'))
            : state.log.slice(0, showAllHistory ? state.log.length : 6).map((commit) =>
                h(
                  HoverTarget,
                  { key: commit.sha, card: h(CommitHoverCard, { commit, t }) },
                  h(
                    'div',
                    { className: 'gmg-commit-row' },
                    h('span', { className: 'gmg-sha' }, commit.short),
                    h('span', { className: 'gmg-subject' }, commit.subject),
                    h('span', { className: 'gmg-meta' }, `${commit.author} · ${relativeTime(commit.date, lang)}`),
                  ),
                ),
              ),
        ),
      )
    : null

  const github = isRepo ? h(GithubCard, { status: snapshot, state, t, busy }) : null

  return h(
    'div',
    { className: `gmg-root${compact ? ' is-compact' : ''}` },
    h('div', { className: 'gmg-page' }, header, ...notices, body, h(WorktreeSection, { state, t, busy, isRepo }), history, github),
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
 * The branch pill, the upstream tracking line, and the fetch/pull/push actions.
 * @param props - `{ status, t, busy }`.
 * @returns the branch bar element.
 */
function BranchBar(props) {
  const { status, t, busy } = props
  const branches = useBranches(status, t)
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
      h(
        'span',
        { className: `gmg-branch${status.branch === null ? ' is-detached' : ''}` },
        h(IconBranch, { size: 13 }),
        status.branch ?? t('detached'),
        h(IconChevronDown, { size: 10 }),
        h(
          'select',
          {
            className: 'gmg-branch-select',
            value: status.branch ?? '',
            title: t('switchBranch'),
            onChange: (event) => {
              const next = event.target.value
              if (next !== '' && next !== status.branch) gitStore.switchBranch(next)
            },
            style: {
              position: 'absolute',
              opacity: 0,
              width: '100%',
              height: '100%',
              inset: 0,
              cursor: 'pointer',
              border: 'none',
            },
          },
          status.branch === null ? h('option', { value: '' }, t('detached')) : null,
          (branches?.branches ?? []).map((branch) => h('option', { key: branch.name, value: branch.name }, branch.name)),
        ),
      ),
    ),
    upstream === null
      ? h('span', { className: 'gmg-track' }, t('notPublished'))
      : h(
          'span',
          { className: 'gmg-track', title: upstream },
          h(IconCloud, { size: 12 }),
          upstream,
          ahead > 0 ? h('span', { className: 'gmg-ahead' }, `↑${ahead}`) : null,
          behind > 0 ? h('span', { className: 'gmg-behind' }, `↓${behind}`) : null,
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
 * Read the branch list lazily and keep it fresh when HEAD moves.
 * @param status - the current status snapshot.
 * @param t - translator (unused, kept for symmetry).
 * @returns `{ branches }` or null before the first read.
 */
function useBranches(status, t) {
  const [list, setList] = useState(null)
  const head = `${status.branch ?? ''}:${status.oid ?? ''}`
  useEffect(() => {
    let live = true
    callHost('branches', { path: status.path })
      .then((value) => {
        if (live) setList(value)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [status.path, head])
  return list
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
  const canCommit = state.message.trim() !== '' && (stagedCount > 0 || state.stageAll) && busy === null

  const submit = () => {
    if (!canCommit) return
    gitStore.commit()
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
          onChange: (event) => gitStore.setFlag('amend', event.target.checked),
        }),
        t('amend'),
      ),
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
  if (rows.length === 0 && empty === null) return null
  return h(
    'div',
    { className: 'gmg-group' },
    h(
      'div',
      { className: 'gmg-group-head' },
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
    rows.length === 0
      ? h('div', { className: 'gmg-empty' }, empty)
      : h('div', { className: 'gmg-files' }, rows.map((row) => h(FileRow, { key: `${staged ? 's' : 'w'}:${row.path}`, row, staged, t, conflicts }))),
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
  } else if (!conflicts) {
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
