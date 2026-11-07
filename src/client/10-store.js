/**
 * The panel's one state holder.
 *
 * Deliberately a plain module-level store rather than component state: the
 * panel unmounts every time the user switches the main column to another page,
 * and a Git view that forgets its repository, its diff expansion, or a typed
 * commit message on every switch would be unusable. Subscribers re-render; the
 * store survives.
 *
 * Every read goes back to git (`status`, `log`), so the panel never disagrees
 * with a terminal the user has open beside it.
 */

/** Initial state: nothing known, nothing busy. */
function initialState() {
  return {
    /** True once the workspace list has been read at least once. */
    ready: false,
    /** True when the last workspace read failed (the panel offers a retry). */
    loadFailed: false,
    /** Repository directory under inspection. */
    path: null,
    /** Workspace rows from the host: `{ id, title, path, isRepo, branch }`. */
    repos: [],
    /** The last `status` payload (null before the first read). */
    status: null,
    /** Recent commits, newest first. */
    log: [],
    /** `{ current, branches }` from `git for-each-ref`. */
    branches: null,
    /** Every checkout of the repository; see the `worktrees` action. */
    worktrees: null,
    /** Failure of the last worktree read, kept apart from the panel's notice. */
    worktreeError: null,
    /** True when the host half predates this action (the plugin needs a restart). */
    worktreeStale: false,
    /** Draft name in the create-worktree form. */
    worktreeDraft: '',
    /** GitHub view state; see `loadGithub`. */
    github: null,
    /** Busy label, e.g. `commit`, or null. */
    busy: null,
    /** Last failure, shown as one dismissible line. */
    error: null,
    /** Last success, shown as one dismissible line. */
    notice: null,
    /** Draft commit message. */
    message: '',
    /** Commit staging preferences. */
    stageAll: false,
    amend: false,
    /** Whether the create-branch row is open. */
    creatingBranch: false,
    /** Whether the GitHub token editor is open. */
    editingToken: false,
  }
}

/**
 * Create the store and its actions.
 * @returns the store: `{ get, subscribe, ...actions }`.
 */
function createGitStore() {
  let state = initialState()
  const listeners = new Set()
  /** Bumped on every repository switch so a slow answer cannot land on the new one. */
  let epoch = 0
  /** Bumped on every operation so only the newest one may clear `busy`. */
  let taskSeq = 0

  const get = () => state

  /**
   * Merge a partial state and notify subscribers.
   * @param patch - the fields to replace.
   */
  const set = (patch) => {
    state = { ...state, ...patch }
    for (const listener of [...listeners]) listener()
  }

  /**
   * Subscribe to state changes.
   * @param listener - called after every `set`.
   * @returns the unsubscribe function.
   */
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /**
   * Run one operation with the busy flag, capturing failures into `error`.
   *
   * `busy` is token-guarded rather than a single label: when a poll and a
   * button overlap, only the newest operation may clear it, so the earlier
   * spinner cannot make the panel look idle while git is still working.
   *
   * @param label - shown while the operation runs.
   * @param operation - the work.
   * @param options - `{ keepError, guard }`: leave an existing error in place,
   *   and only record a failure while the guard returns true.
   * @returns the operation's result, or undefined after a failure.
   */
  async function task(label, operation, options = {}) {
    const token = (taskSeq += 1)
    set(options.keepError === true ? { busy: label } : { busy: label, error: null })
    try {
      return await operation()
    } catch (error) {
      if (typeof options.guard !== 'function' || options.guard()) {
        set({ error: String(error?.message ?? error) })
      }
      return undefined
    } finally {
      if (token === taskSeq) set({ busy: null })
    }
  }

  /** Read the workspace list and settle on a repository. */
  async function loadRepos() {
    const listed = await task('repos', () => callHost('repos', {}))
    if (listed === undefined) {
      set({ ready: true, loadFailed: true })
      return
    }
    const repos = Array.isArray(listed?.repos) ? listed.repos : []
    const stored = readStoredRepo()
    const preferred =
      repos.find((repo) => repo.path === stored && repo.isRepo) ??
      repos.find((repo) => repo.isRepo) ??
      repos.find((repo) => repo.path === stored) ??
      null
    set({ ready: true, loadFailed: false, repos })
    if (preferred !== null && state.path === null) await selectRepo(preferred.path)
  }

  /**
   * Point the panel at one directory and read everything fresh.
   * @param path - the repository directory.
   */
  async function selectRepo(path) {
    epoch += 1
    const mine = epoch
    writeStoredRepo(path)
    set({
      path,
      status: null,
      log: [],
      branches: null,
      worktrees: null,
      worktreeError: null,
      worktreeStale: false,
      github: null,
      error: null,
      notice: null,
    })
    setDiffState({ target: null, rows: [], pairs: [] })
    await refresh(mine)
    if (mine === epoch) await loadWorktrees()
  }

  /**
   * Re-read status, history and the branch list.
   *
   * The branch list rides along because the history rail needs it: a bare
   * decoration like `dev` is only a local branch if this checkout has one by
   * that name, and everything else is a remote.
   *
   * @param only - internal epoch guard, used by `selectRepo`.
   */
  async function refresh(only) {
    const path = state.path
    if (path === null) return
    const mine = only ?? epoch
    const snapshot = await task(
      'refresh',
      async () => {
        const [status, log, branches] = await Promise.all([
          callHost('status', { path }),
          callHost('log', { path, limit: 40 }),
          callHost('branches', { path }).catch(() => null),
        ])
        return { status, log: log?.commits ?? [], branches }
      },
      { keepError: true, guard: () => mine === epoch },
    )
    if (snapshot === undefined || mine !== epoch) return
    set({ status: snapshot.status, log: snapshot.log, branches: snapshot.branches })
  }

  /**
   * Re-read only the status, leaving history and the branch list alone.
   *
   * File operations and the 8-second poll use this: `status` is the only thing
   * that can change from a stage/discard, and re-reading `log` plus `branches`
   * on every click is what made the panel feel locked.
   */
  async function refreshStatus() {
    const path = state.path
    if (path === null) return
    const mine = epoch
    const status = await task('refresh', () => callHost('status', { path }), {
      keepError: true,
      guard: () => mine === epoch,
    })
    if (status === undefined || mine !== epoch) return
    set({ status })
  }

  /**
   * Read the repository's worktrees.
   *
   * Kept out of the 8-second poll on purpose: each row costs a `git status`,
   * and the list only changes when the user (or an Agent) makes a checkout.
   */
  async function loadWorktrees() {
    const path = state.path
    if (path === null) return
    try {
      const result = await callHost('worktrees', { path })
      if (path !== state.path) return
      set({ worktrees: result, worktreeError: null, worktreeStale: false })
    } catch (error) {
      if (path !== state.path) return
      const message = String(error?.message ?? error)
      // A host half that predates the action answers 404 "unknown action": the
      // page is newer than the process, which only a restart settles.
      set({ worktrees: null, worktreeError: message, worktreeStale: /unknown action/i.test(message) })
    }
  }

  /** Re-read status, history and the worktree list (the header's refresh). */
  async function refreshAll() {
    await refresh()
    await loadWorktrees()
  }

  /**
   * Create a worktree under `<repo>/.agents/worktrees/<name>` on branch
   * `worktree-<name>`.
   * @param name - the worktree name.
   * @returns true when it was created.
   */
  async function createWorktree(name) {
    if (state.path === null) return false
    const done = await task('worktree', () => callHost('createWorktree', { path: state.path, name }))
    if (done === undefined) return false
    set({ worktreeDraft: '', notice: `${done.branch} → ${done.path}` })
    await loadWorktrees()
    return true
  }

  /**
   * Remove one worktree directory.
   * @param target - the worktree path.
   * @returns true when it was removed.
   */
  async function removeWorktree(target) {
    if (state.path === null) return false
    const done = await task('worktree', () => callHost('removeWorktree', { path: state.path, target }))
    if (done === undefined) return false
    set({ notice: done.summary })
    await loadWorktrees()
    return true
  }

  /** Drop stale worktree records (`git worktree prune`). */
  async function pruneWorktrees() {
    if (state.path === null) return
    const done = await task('worktree', () => callHost('pruneWorktrees', { path: state.path }))
    if (done === undefined) return
    set({ notice: done.summary })
    await loadWorktrees()
  }

  /**
   * Point the panel at another worktree.
   * @param target - that worktree's directory.
   */
  async function focusWorktree(target) {
    if (pathKey(target) === pathKey(state.path ?? '')) return
    await selectRepo(target)
  }

  /**
   * Create (or reuse) a DSH workspace for one worktree and open it.
   * @param target - that worktree's directory.
   * @returns true when a workspace was opened.
   */
  async function openWorktreeInDsh(target) {
    if (!canOpenWorkspace()) {
      set({ error: '這個 GUI 沒有提供工作區服務 / workspace services unavailable' })
      return false
    }
    try {
      const opened = await openAsWorkspace(target)
      set({ notice: opened?.title ? `已開啟工作區：${opened.title}` : null })
      return true
    } catch (error) {
      set({ error: String(error?.message ?? error) })
      return false
    }
  }

  /**
   * One file operation (`stage`, `unstage`, `discard`, `deleteUntracked`).
   * @param action - the host action.
   * @param files - repository-relative paths.
   * @param notice - the line shown on success.
   */
  async function fileAction(action, files, notice) {
    if (state.path === null || files.length === 0) return false
    const done = await task(action, () => callHost(action, { path: state.path, files }))
    if (done === undefined) return false
    set({ notice })
    await refreshStatus()
    return true
  }

  /** Stage every change. */
  async function stageAll() {
    const files = [...(state.status?.changes ?? [])].map((row) => row.path)
    await fileAction('stage', files, null)
  }

  /** Unstage everything currently staged. */
  async function unstageAll() {
    const files = [...(state.status?.staged ?? [])].map((row) => row.path)
    await fileAction('unstage', files, null)
  }

  /**
   * Commit the index (or everything, when "stage all" is on).
   * @returns true when the commit landed.
   */
  async function commit() {
    if (state.path === null) return false
    const message = state.message.trim()
    if (message === '') {
      set({ error: '请先填写提交信息 / write a commit message first' })
      return false
    }
    const done = await task('commit', () =>
      callHost('commit', { path: state.path, message, amend: state.amend, stageAll: state.stageAll }),
    )
    if (done === undefined) return false
    set({ message: '', amend: false, stageAll: false, notice: done.summary || 'committed' })
    await refresh()
    return true
  }

  /**
   * Create a branch from the current HEAD and switch to it.
   * @param name - the new branch name.
   * @returns true on success.
   */
  async function createBranch(name) {
    if (state.path === null || name === '') return false
    const done = await task('branch', () => callHost('switch', { path: state.path, branch: name, create: true }))
    if (done === undefined) return false
    set({ creatingBranch: false, notice: done.summary || name })
    await refresh()
    return true
  }

  /**
   * Switch to an existing branch.
   * @param name - the branch name.
   */
  async function switchBranch(name) {
    if (state.path === null) return
    const done = await task('branch', () => callHost('switch', { path: state.path, branch: name }))
    if (done === undefined) return
    set({ notice: done.summary || name })
    await refresh()
  }

  /**
   * Run one remote operation (`fetch`, `pull`, `push`).
   * @param kind - which one.
   */
  async function remote(kind) {
    if (state.path === null) return
    const done = await task(kind, () => callHost(kind, { path: state.path }))
    if (done === undefined) return
    set({ notice: done.summary || kind })
    await refresh()
  }

  /** Abort an in-progress merge (`git merge --abort`). */
  async function abortMerge() {
    if (state.path === null) return
    const done = await task('abortMerge', () => callHost('abortMerge', { path: state.path }))
    if (done === undefined) return
    set({ notice: done.summary || 'merge aborted' })
    await refresh()
  }

  /** `git init` in the selected directory, then reload it. */
  async function initRepo() {
    if (state.path === null) return
    const done = await task('init', () => callHost('init', { path: state.path }))
    if (done === undefined) return
    set({ notice: 'repository initialised' })
    await refresh()
  }

  /**
   * Read the GitHub surface for the selected repository.
   * @param kind - `repo`, `pulls` or `issues`.
   */
  async function loadGithub(kind) {
    if (state.path === null) return
    const result = await task(`github:${kind}`, () => callHost('github', { path: state.path, action: kind }))
    if (result === undefined) {
      // Keep the failure on the card instead of leaving it stuck on "reading…":
      // `authorized: false` + `reason: 'error'` makes the retry row render.
      set({
        github: {
          ...(state.github ?? {}),
          connected: true,
          authorized: false,
          reason: 'error',
          error: state.error,
        },
      })
      return
    }
    set({
      github: {
        ...(state.github ?? {}),
        connected: result.connected,
        authorized: result.authorized,
        reason: result.reason ?? null,
        remote: result.remote ?? state.github?.remote ?? null,
        ...(kind === 'repo' ? { repo: result.repo } : {}),
        ...(kind === 'pulls' ? { pulls: result.pulls, defaultBranch: result.defaultBranch } : {}),
        ...(kind === 'issues' ? { issues: result.issues } : {}),
      },
    })
  }

  /**
   * Open one pull request from the current branch.
   * @param input - `{ title, body, base, draft }`.
   * @returns the created pull, or null.
   */
  async function createPull(input) {
    if (state.path === null) return null
    const result = await task('pr', () => callHost('github', { path: state.path, action: 'createPull', ...input }))
    if (result === undefined) return null
    set({ notice: `PR #${result.pull?.number} created` })
    await loadGithub('pulls')
    return result.pull ?? null
  }

  /**
   * Store or clear the GitHub token, then re-read the GitHub card.
   * @param token - the token, or null to forget it.
   */
  async function saveToken(token) {
    writeToken(token === null || token.trim() === '' ? null : token.trim())
    set({ editingToken: false, github: null })
    if (state.path !== null) await loadGithub('repo')
  }

  return {
    get,
    subscribe,
    loadRepos,
    selectRepo,
    refresh,
    refreshStatus,
    refreshAll,
    loadWorktrees,
    createWorktree,
    removeWorktree,
    pruneWorktrees,
    focusWorktree,
    openWorktreeInDsh,
    fileAction,
    stageAll,
    unstageAll,
    commit,
    createBranch,
    switchBranch,
    remote,
    abortMerge,
    initRepo,
    loadGithub,
    createPull,
    saveToken,
    setMessage: (message) => set({ message }),
    setWorktreeDraft: (value) => set({ worktreeDraft: value }),
    setFlag: (flag, value) => set({ [flag]: value }),
    dismiss: () => set({ error: null, notice: null }),
  }
}

/** The one store this GUI session shares between panel mounts. */
const gitStore = createGitStore()

/**
 * Subscribe a component to the store.
 * @returns the current state, re-rendering on every change.
 */
function useGitStore() {
  const [snapshot, setSnapshot] = useState(() => gitStore.get())
  useEffect(() => {
    setSnapshot(gitStore.get())
    return gitStore.subscribe(() => setSnapshot(gitStore.get()))
  }, [])
  return snapshot
}
