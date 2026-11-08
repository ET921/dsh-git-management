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
    /**
     * Which history the rail draws: `all` follows the checked-out line plus
     * every branch, tag and remote-tracking ref — the collaboration view, so a
     * colleague's pushed branch appears (after a fetch) on its own lane;
     * `head` narrows it to the checked-out line. Kept in the store, not in the
     * component, so switching the main column away and back does not silently
     * drop the reader's choice and refetch the other history.
     */
    logScope: 'all',
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
    /**
     * Which one operation is in flight, as `action|file|file`. Unlike `busy`
     * this names its target, so a stage locks only the row it touches
     * (poweruser G11) instead of greying the whole list.
     */
    busyOp: null,
    /** Epoch of the last successful status read — the header's “更新于 X 前”. */
    lastSyncedAt: null,
    /** How many `git stash` entries the menu offers to pop; null until read. */
    stashCount: null,
    /** Last failure, shown as one dismissible line. */
    error: null,
    /**
     * The envelope's stable `code` for that failure (§3.1). The message is for
     * reading; the code is what picks the one-line next step.
     */
    errorCode: null,
    /** `{ argv, exitCode, stderr }` when the host had a command to show. */
    errorDetails: null,
    /** Whether the reader unfolded the failure's details. */
    errorOpen: false,
    /** Last success, shown as one dismissible line. */
    notice: null,
    /**
     * True when `notice` reports something the reader must act on (a pull that
     * stopped on conflicts) rather than a success; the panel styles it apart.
     */
    noticeWarning: false,
    /**
     * Bumped when a pull left conflicts. The panel uses it to bring the
     * conflicts group into view once; the store never touches the DOM itself.
     */
    conflictFocusAt: null,
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
 * The `busyOp` label for a file operation: the action plus its exact targets,
 * so a row can ask “is *this* operation running on *these* files”.
 * @param action - the host action.
 * @param files - repository-relative paths.
 * @returns the label.
 */
function fileOp(action, files) {
  return `${action}|${[...files].join('|')}`
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
   * Show one transient line. `tone` is `ok` for a success and `warn` for a
   * state the reader has to act on (merge conflicts); keeping the tone beside
   * the text stops a later warning from inheriting the green check.
   * @param text - the line, or null to clear it.
   * @param tone - `ok` (default) or `warn`.
   */
  const setNotice = (text, tone = 'ok') => {
    set({ notice: text, noticeWarning: tone === 'warn' })
  }

  /**
   * Record one failure with the parts S13 keeps: the readable message, the
   * stable code, and the command tail a reader can paste into a terminal.
   * A new failure always starts folded: an unfolded block from the last one
   * would push the message off the top of the column.
   *
   * @param message - what to show first.
   * @param code - the envelope code, or null for a client-side refusal.
   * @param details - `{ argv?, exitCode?, stderr? }`.
   */
  const setError = (message, code = null, details = null) => {
    set({
      error: message === null ? null : String(message),
      errorCode: message === null ? null : code,
      errorDetails: message === null ? null : details,
      errorOpen: false,
    })
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
   * @param options - `{ keepError, guard, op }`: leave an existing error in
   *   place, only record a failure while the guard returns true, and name the
   *   in-flight target (`busyOp`) so the UI can lock just that row.
   * @returns the operation's result, or undefined after a failure.
   */
  async function task(label, operation, options = {}) {
    const token = (taskSeq += 1)
    const open =
      options.keepError === true
        ? { busy: label }
        : { busy: label, error: null, errorCode: null, errorDetails: null, errorOpen: false }
    if (typeof options.op === 'string' && options.op !== '') open.busyOp = options.op
    set(open)
    try {
      return await operation()
    } catch (error) {
      if (typeof options.guard !== 'function' || options.guard()) {
        setError(error?.message ?? error, error?.code ?? null, error?.details ?? null)
      }
      return undefined
    } finally {
      if (token === taskSeq) set({ busy: null, busyOp: null })
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
    // A draft, an amend tick, or a staged-everything flag belongs to the
    // repository it was made in: carrying them across would commit repo A's
    // message into repo B with an `add -A` (poweruser G2).
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
      errorCode: null,
      errorDetails: null,
      errorOpen: false,
      stashCount: null,
      notice: null,
      noticeWarning: false,
      conflictFocusAt: null,
      busyOp: null,
      lastSyncedAt: null,
      message: '',
      stageAll: false,
      amend: false,
    })
    setDiffState({ target: null, rows: [], pairs: [] })
    await refresh(mine)
    if (mine === epoch) await loadWorktrees()
    if (mine === epoch) await loadStashCount()
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
          callHost('log', { path, limit: 40, scope: state.logScope }),
          callHost('branches', { path }).catch(() => null),
        ])
        return { status, log: log?.commits ?? [], branches }
      },
      { keepError: true, guard: () => mine === epoch },
    )
    if (snapshot === undefined || mine !== epoch) return
    // A whole-panel read is the strongest proof the data is current.
    set({ status: snapshot.status, log: snapshot.log, branches: snapshot.branches, lastSyncedAt: Date.now() })
  }

  /**
   * Switch the history rail between the checked-out line and every ref.
   *
   * The commits are re-read rather than filtered in the browser: a window of
   * `--all` rows is a different set of commits, not a subset, so re-labelling
   * the rows already on screen would draw a graph of history that is not there.
   *
   * @param scope - `'head'` or `'all'`.
   */
  async function setLogScope(scope) {
    const next = scope === 'all' ? 'all' : 'head'
    if (state.logScope === next) return
    set({ logScope: next })
    await refresh()
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
    set({ status, lastSyncedAt: Date.now() })
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
    set({ worktreeDraft: '' })
    setNotice(`${done.branch} → ${done.path}`)
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
    setNotice(done.summary)
    await loadWorktrees()
    return true
  }

  /** Drop stale worktree records (`git worktree prune`). */
  async function pruneWorktrees() {
    if (state.path === null) return
    const done = await task('worktree', () => callHost('pruneWorktrees', { path: state.path }))
    if (done === undefined) return
    setNotice(done.summary)
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
      setError('這個 GUI 沒有提供工作區服務 / workspace services unavailable')
      return false
    }
    try {
      const opened = await openAsWorkspace(target)
      setNotice(opened?.title ? `已開啟工作區：${opened.title}` : null)
      return true
    } catch (error) {
      setError(error?.message ?? error, error?.code ?? null, error?.details ?? null)
      return false
    }
  }

  /**
   * One file operation (`stage`, `unstage`, `discard`, `deleteUntracked`).
   * @param action - the host action.
   * @param files - repository-relative paths.
   * @param notice - the line shown on success.
   * @param options - `{ op }`: the in-flight label (`busyOp`); callers pass
   *   `fileOp(action, files)` so the UI can lock exactly this row.
   */
  async function fileAction(action, files, notice, options = {}) {
    if (state.path === null || files.length === 0) return false
    const done = await task(action, () => callHost(action, { path: state.path, files }), { op: options.op })
    if (done === undefined) return false
    setNotice(notice)
    await refreshStatus()
    return true
  }

  /** Stage every change. */
  async function stageAll() {
    const files = [...(state.status?.changes ?? [])].map((row) => row.path)
    await fileAction('stage', files, null, { op: fileOp('stage', files) })
  }

  /** Unstage everything currently staged. */
  async function unstageAll() {
    const files = [...(state.status?.staged ?? [])].map((row) => row.path)
    await fileAction('unstage', files, null, { op: fileOp('unstage', files) })
  }

  /**
   * Commit the index (or everything, when "stage all" is on).
   * @param options - `{ op }`: in-flight label for the row-lock machinery.
   * @returns true when the commit landed.
   */
  async function commit(options = {}) {
    if (state.path === null) return false
    const message = state.message.trim()
    if (message === '') {
      setError('请先填写提交信息 / write a commit message first', 'invalid-argument')
      return false
    }
    const done = await task(
      'commit',
      () => callHost('commit', { path: state.path, message, amend: state.amend, stageAll: state.stageAll }),
      { op: options.op },
    )
    if (done === undefined) return false
    set({ message: '', amend: false, stageAll: false })
    setNotice(done.summary || 'committed')
    await refresh()
    return true
  }

  /**
   * Fill the draft with HEAD's complete message for an amend (poweruser G3).
   *
   * A plain amend replaces the whole message, so importing only the subject
   * would silently drop the body. The read is best-effort: it is a quiet
   * `commitDetail`, never a busy/error write (a failed preview must not clear
   * the panel's error). It may replace a *pristine* draft — empty, or exactly
   * the subject the toggle itself just previewed — but never words the reader
   * has typed, and a late answer is dropped when amend is no longer ticked.
   */
  async function loadFullMessage() {
    if (state.path === null || state.amend !== true) return
    const headSubject = String(state.log[0]?.subject ?? '')
    const pristine = () => state.message === '' || state.message === headSubject
    if (!pristine()) return
    try {
      const detail = await callHost('commitDetail', { path: state.path, sha: 'HEAD' })
      if (state.amend !== true || !pristine()) return
      const subject = String(detail?.subject ?? '')
      const body = typeof detail?.body === 'string' ? detail.body : ''
      if (subject === '') return
      set({ message: body === '' ? subject : `${subject}\n\n${body}` })
    } catch {
      /* the draft keeps the subject-only fallback; nothing else to undo */
    }
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
    set({ creatingBranch: false })
    setNotice(done.summary || name)
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
    setNotice(done.summary || name)
    await refresh()
  }

  /**
   * Run one remote operation (`fetch`, `pull`, `push`).
   *
   * A pull is the one call that can stop halfway without failing: git leaves
   * the conflicts in the index and returns normally. Painting that as a
   * success would be a lie, so the warning lands as a warning and the terms it
   * produced are the next thing the panel shows.
   *
   * @param kind - which one.
   */
  async function remote(kind, params = {}) {
    if (state.path === null) return
    const done = await task(kind, () => callHost(kind, { path: state.path, ...params }))
    if (done === undefined) return
    if (kind === 'pull' && done.conflicts === true) {
      await refresh()
      setNotice('合併衝突：解決後標記為已解決，再提交 / Merge conflicts — resolve, mark, then commit', 'warn')
      set({ conflictFocusAt: Date.now() })
      return
    }
    setNotice(done.summary || kind)
    await refresh()
  }

  /**
   * Read how many stash entries exist, for the ⋯ menu's count.
   *
   * Best-effort and quiet: a host that predates the action (404) must not put
   * an error line on the panel just because the reader has no stash yet.
   */
  async function loadStashCount() {
    if (state.path === null) return
    try {
      const done = await callHost('stash', { path: state.path, op: 'count' })
      if (typeof done?.count === 'number') set({ stashCount: done.count })
    } catch {
      set({ stashCount: 0 })
    }
  }

  /**
   * The narrow stash surface (plan-v2 §3.4): `push`, `pop`, and the count the
   * menu already reads. A pop that lands conflicts is reported as a state —
   * the conflicts group is the next thing the reader needs, not an error line.
   *
   * @param op - `push` or `pop`.
   * @param message - optional message for `push` (≤200 chars, host-checked).
   * @returns true when the operation was accepted by the host.
   */
  async function stash(op, message) {
    if (state.path === null) return false
    const params = { path: state.path, op }
    if (op === 'push' && typeof message === 'string' && message.trim() !== '') params.message = message.trim().slice(0, 200)
    const done = await task('stash', () => callHost('stash', params))
    if (done === undefined) return false
    if (typeof done.count === 'number') set({ stashCount: done.count })
    if (op === 'pop' && done.conflicts === true) {
      await refresh()
      setNotice('貯藏套用時發生衝突：解決後標記為已解決 / Stash conflicts — resolve, mark, then commit', 'warn')
      set({ conflictFocusAt: Date.now() })
      await loadStashCount()
      return true
    }
    setNotice(op === 'push' ? done.summary || 'stashed' : done.summary || 'stash popped')
    await refresh()
    await loadStashCount()
    return true
  }

  /** Abort an in-progress merge (`git merge --abort`). */
  async function abortMerge() {
    if (state.path === null) return
    const done = await task('abortMerge', () => callHost('abortMerge', { path: state.path }))
    if (done === undefined) return
    setNotice(done.summary || 'merge aborted')
    await refresh()
  }

  /** `git init` in the selected directory, then reload it. */
  async function initRepo() {
    if (state.path === null) return
    const done = await task('init', () => callHost('init', { path: state.path }))
    if (done === undefined) return
    setNotice('repository initialised')
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
    setNotice(`PR #${result.pull?.number} created`)
    await loadGithub('pulls')
    return result.pull ?? null
  }

  /**
   * Remember or clear the GitHub token for this page load (never persisted),
   * then re-read the GitHub card.
   * @param token - the token, or null to forget it.
   */
  async function saveToken(token) {
    rememberToken(token === null || token.trim() === '' ? null : token.trim())
    set({ editingToken: false, github: null })
    if (state.path !== null) await loadGithub('repo')
  }

  return {
    get,
    subscribe,
    loadRepos,
    selectRepo,
    refresh,
    setLogScope,
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
    loadFullMessage,
    stash,
    loadStashCount,
    createPull,
    saveToken,
    setMessage: (message) => set({ message }),
    setWorktreeDraft: (value) => set({ worktreeDraft: value }),
    setFlag: (flag, value) => set({ [flag]: value }),
    dismiss: () => set({ error: null, errorCode: null, errorDetails: null, errorOpen: false, notice: null, noticeWarning: false }),
    /** Fold or unfold the failure's command tail (S13). */
    toggleErrorOpen: () => set({ errorOpen: state.errorOpen !== true }),
    /** The auto-fade only ever drops the notice; an error waits for its reader. */
    dismissNotice: () => set({ notice: null, noticeWarning: false }),
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
