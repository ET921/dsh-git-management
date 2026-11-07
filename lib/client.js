window.__ModuleLoader__.load({
  id: "dsh-git-management",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ---- 00-util.js ----
    /**
     * Shared plumbing for the browser half: React access, the host endpoint, and
     * the small pure helpers the panel uses.
     *
     * The shell evaluates `lib/client.js` as a factory with a `require` table, so
     * `react` is the same instance the rest of the GUI renders with — not a copy.
     */
    
    /** React, from the shell's module table. */
    const react = require('react')
    
    /**
     * Portals, when the shell's module table exposes `react-dom`.
     *
     * It is part of this build's frozen table, but the whole bundle dies if one
     * `require` throws, so a host that does not expose it simply renders the hover
     * card in place (fixed positioning needs no portal to be correct).
     */
    const reactDom = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()
    
    /** Terse hyperscript; this file set is JSX-free so the build needs no compiler. */
    const h = react.createElement
    
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = react
    
    /** Module id: the bundle's id and (by the plugin's own choice) its tab id. */
    const PLUGIN_ID = 'dsh-git-management'
    
    /** The host route registered by `src/index.js`. */
    const API_ROUTE = '/dsh-git/api'
    
    /** Where the panel remembers the chosen repository across reloads. */
    const REPO_STORAGE_KEY = 'dsh-git-management/repo-path'
    
    /** Where the optional GitHub token is kept (this browser only). */
    const TOKEN_STORAGE_KEY = 'dsh-git-management/github-token'
    
    /**
     * Resolve an API path against the directory the UI is served from.
     *
     * Root-absolute paths break behind a reverse proxy that mounts dsh under a
     * prefix, so the path is anchored on `document.baseURI` — the same rule the
     * community market plugin uses, which keeps this endpoint reachable on Desktop
     * (served over the app protocol) and on a proxied `dsh web` alike.
     *
     * @param path - path beginning with `/`.
     * @returns the pathname to fetch.
     */
    function apiUrl(path) {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      try {
        return new URL(relative, document.baseURI).pathname
      } catch {
        return `/${relative}`
      }
    }
    
    /**
     * Read the stored GitHub token, if this browser has one.
     * @returns the token or null.
     */
    function readToken() {
      try {
        return window.localStorage.getItem(TOKEN_STORAGE_KEY)
      } catch {
        return null
      }
    }
    
    /**
     * Persist (or clear) the GitHub token.
     * @param token - the token, or null to forget it.
     */
    function writeToken(token) {
      try {
        if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY)
        else window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
      } catch {
        /* private mode: the panel still works, it just does not remember */
      }
    }
    
    /**
     * The stored repository path, if this browser has one.
     * @returns the path or null.
     */
    function readStoredRepo() {
      try {
        return window.localStorage.getItem(REPO_STORAGE_KEY)
      } catch {
        return null
      }
    }
    
    /**
     * Remember the chosen repository path.
     * @param path - the path.
     */
    function writeStoredRepo(path) {
      try {
        window.localStorage.setItem(REPO_STORAGE_KEY, path)
      } catch {
        /* ignore */
      }
    }
    
    /**
     * One request to the host action table.
     *
     * @param action - action name (`status`, `commit`, …).
     * @param params - action arguments; `path` is the repository directory.
     * @returns the action's result.
     * @throws when the host reports a failure, with git's own message.
     */
    async function callHost(action, params = {}) {
      const response = await fetch(apiUrl(API_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, params, token: readToken() ?? undefined }),
        cache: 'no-store',
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body?.ok !== true) {
        const message = body?.error ?? `HTTP ${response.status}`
        const error = new Error(String(message))
        error.details = body?.details
        throw error
      }
      return body.result
    }
    
    /**
     * A comparable form of one filesystem path: forward slashes, no trailing
     * slash, folded case — the same rule the host applies when it matches a
     * worktree row against the panel's current directory.
     * @param path - the raw path.
     * @returns the comparable key.
     */
    function pathKey(path) {
      return String(path ?? '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase()
    }
    
    /**
     * The bridge to the client's workspace services, installed by the plugin.
     *
     * Opening a worktree "as a workspace" needs `ctx.workspaces` + `ctx.uiWorkspace`,
     * which only the plugin's apply sees; components reach it through this slot
     * instead of receiving services as props.
     */
    let gmgWorkspaceBridge = null
    
    /**
     * The right column's tab openers, installed by the plugin. Clicking a file
     * opens a diff tab and clicking a commit opens a commit tab, both in the same
     * column, so the list and the conversation stay exactly where they were.
     */
    let gmgSidebarBridge = { openDiff: null, openCommit: null }
    
    /**
     * Whether this GUI can open a directory as a workspace.
     * @returns true when the bridge is installed.
     */
    function canOpenWorkspace() {
      return gmgWorkspaceBridge !== null
    }
    
    /**
     * Create (idempotently) and open a workspace for one directory.
     * @param path - the directory.
     * @returns the workspace view, or null when unavailable.
     */
    async function openAsWorkspace(path) {
      if (gmgWorkspaceBridge === null) return null
      return gmgWorkspaceBridge(path)
    }
    
    /**
     * Split a repository-relative path into the file name and its directory.
     * @param path - repository-relative path.
     * @returns `{ name, dir }`.
     */
    function splitPath(path) {
      const value = String(path ?? '')
      const index = value.lastIndexOf('/')
      if (index === -1) return { name: value, dir: '' }
      return { name: value.slice(index + 1), dir: value.slice(0, index + 1) }
    }
    
    /**
     * A short relative time, in the panel's own words.
     * @param iso - an ISO-8601 instant.
     * @param locale - `zh` or `en`.
     * @returns e.g. `3 分钟前` / `3m ago`.
     */
    function relativeTime(iso, locale) {
      if (typeof iso !== 'string' || iso === '') return ''
      const then = Date.parse(iso)
      if (Number.isNaN(then)) return ''
      const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
      const zh = locale === 'zh'
      if (seconds < 60) return zh ? '刚刚' : 'just now'
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`
      const hours = Math.round(minutes / 60)
      if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`
      const days = Math.round(hours / 24)
      if (days < 30) return zh ? `${days} 天前` : `${days}d ago`
      const months = Math.round(days / 30)
      if (months < 12) return zh ? `${months} 个月前` : `${months}mo ago`
      const years = Math.round(months / 12)
      return zh ? `${years} 年前` : `${years}y ago`
    }
    
    /**
     * The panel's single colour for one porcelain status letter.
     *
     * These read the panel's own saturated marks rather than the theme's state
     * accents: at 11px on a busy list the calmer tokens were barely distinct.
     *
     * @param status - M, A, D, R, C, U or T.
     * @returns a CSS custom-property name.
     */
    function statusColor(status) {
      switch (status) {
        case 'A':
        case 'U':
          return 'var(--gmg-ok)'
        case 'D':
          return 'var(--gmg-bad)'
        case 'M':
        case 'T':
          return 'var(--gmg-warn)'
        case 'R':
        case 'C':
          return 'var(--gmg-local)'
        default:
          return 'var(--dsw-alias-label-secondary)'
      }
    }
    
    /**
     * The glyph shown for one porcelain status letter.
     * @param status - the letter.
     * @returns a one-character label.
     */
    function statusGlyph(status) {
      switch (status) {
        case 'U':
          return 'U'
        case 'A':
          return 'A'
        case 'D':
          return 'D'
        case 'R':
          return 'R'
        case 'C':
          return 'C'
        case 'T':
          return 'T'
        case 'M':
          return 'M'
        default:
          return '·'
      }
    }

    // ---- 10-store.js ----
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

    // ---- 15-diff.js ----
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
      /** `full` shows the whole file with the changes marked; `hunks` shows git's three context lines. */
      context: 'full',
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
      // `--- ` / `+++ ` are file headers only before the first hunk. Inside a hunk
      // they are ordinary content lines (a deletion of `-- foo` is printed as
      // `--- foo`), and treating them as metadata loses a gutter number and shifts
      // everything after it.
      let seenHunk = false
      for (const line of String(patch ?? '').split('\n')) {
        if (line === '') continue
        if (line.startsWith('@@')) {
          seenHunk = true
          const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
          if (match) {
            oldNo = Number(match[1])
            newNo = Number(match[2])
          }
          rows.push({ kind: DIFF_HUNK, text: line, oldNo: null, newNo: null })
          continue
        }
        if (!seenHunk && (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename '))) {
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
     * @param input - `{ path, file, staged, status, context }`.
     * @returns the parsed rows.
     */
    /** Which `openDiff` call is the latest: an older answer must not overwrite it. */
    let diffRequest = 0
    
    async function openDiff(input) {
      const token = (diffRequest += 1)
      const context = input.context ?? gmgDiffState.context ?? 'full'
      setDiffState({
        target: input,
        context,
        loading: true,
        error: null,
        note: null,
        rows: [],
        pairs: [],
      })
      try {
        const result = await callHost('diff', { path: input.path, file: input.file, staged: input.staged, context })
        if (token !== diffRequest) return
        const patch = String(result?.patch ?? '')
        // Decided from the patch, not from a flag: the marker is a whole line git
        // prints itself, while a source line that merely quotes the words arrives
        // with a `+` in front. Trusting a substring is how src/git.js was once
        // reported as a binary file.
        if (/^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)) {
          setDiffState({ loading: false, note: 'binary' })
          return
        }
        // A conflicted file comes back as a combined diff (`diff --cc` / `diff
        // --combined`), whose two-column prefixes this parser deliberately does not
        // model; say so instead of drawing wrong line numbers.
        if (/^diff --(?:cc|combined) /m.test(patch)) {
          setDiffState({ loading: false, note: 'unmerged' })
          return
        }
        if (patch.trim() === '') {
          setDiffState({ loading: false, note: 'empty' })
          return
        }
        const parsed = parsePatch(patch)
        setDiffState({ loading: false, context, rows: parsed.rows, pairs: parsed.pairs })
      } catch (error) {
        if (token !== diffRequest) return
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
    
    /**
     * Ask git for the other amount of context and re-read the open file.
     *
     * `full` is the default: the panel reads like the file itself, with the changes
     * marked, rather than three lines around a hunk.
     */
    async function toggleDiffContext() {
      const target = gmgDiffState.target
      if (target === null) return
      const context = gmgDiffState.context === 'full' ? 'hunks' : 'full'
      setDiffState({ context })
      await openDiff({ ...target, context })
    }

    // ---- 16-graph.js ----
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
       * A free lane, never the one the caller is using.
       * @param skip - a lane index to leave alone.
       * @returns the index.
       */
      const freeLane = (skip) => {
        for (let index = 0; index < lanes.length; index += 1) {
          if (lanes[index] === null && index !== skip) return index
        }
        lanes.push(null)
        return lanes.length - 1
      }
    
      for (const commit of commits) {
        const parents = Array.isArray(commit.parents) ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '') : []
        let lane = lanes.indexOf(commit.sha)
        const incoming = lane !== -1
        if (incoming === false) lane = freeLane(-1)
        // Mark the lane as this commit's while its parents are placed, so a merge
        // cannot hand its second parent the lane the first one just took.
        lanes[lane] = commit.sha
        const before = lanes.slice()
        const parentLanes = []
        parents.forEach((parent, index) => {
          const existing = lanes.indexOf(parent)
          if (existing !== -1) {
            parentLanes.push(existing)
            if (index === 0) lanes[lane] = null
            return
          }
          if (index === 0) {
            lanes[lane] = parent
            parentLanes.push(lane)
            return
          }
          const fresh = freeLane(lane)
          lanes[fresh] = parent
          parentLanes.push(fresh)
        })
        if (parents.length === 0) lanes[lane] = null
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
        rows.push({ commit, lane, incoming, before, after: lanes.slice(), parentLanes })
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
        // Lanes that are only passing through this row keep their line straight.
        for (let lane = 0; lane < lanesHere; lane += 1) {
          if (lane === row.lane) continue
          const fromAbove = (row.before[lane] ?? null) !== null
          const toBelow = (row.after[lane] ?? null) !== null
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

    // ---- 17-commit-diff.js ----
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

    // ---- 20-icons.js ----
    /**
     * Icons: 16×16 line art drawn with `currentColor`, so every glyph inherits the
     * colour its row or button already chose (including the theme's accent and
     * state tokens).
     *
     * No icon package: the shell exposes React but no icon library to third-party
     * bundles, and a handful of hand-drawn paths weigh less than a dependency.
     */
    
    /**
     * Build one icon component.
     * @param children - the SVG children.
     * @param options - `{ filled }` for solid marks.
     * @returns a React component taking `{ size, strokeWidth }`.
     */
    function makeIcon(children, options = {}) {
      const filled = options.filled === true
      return function Icon(props) {
        const size = props?.size ?? 16
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: filled ? 'currentColor' : 'none',
            stroke: filled ? 'none' : 'currentColor',
            strokeWidth: props?.strokeWidth ?? 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
            style: { flex: 'none', display: 'block' },
          },
          children,
        )
      }
    }
    
    /** The sidebar's mark and the panel's title glyph: a branch with one commit. */
    const IconBranch = makeIcon([
      h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
      h('circle', { key: 'b', cx: 4, cy: 12.8, r: 1.7 }),
      h('circle', { key: 'c', cx: 12, cy: 5, r: 1.7 }),
      h('path', { key: 'd', d: 'M4 4.9v6.2' }),
      h('path', { key: 'e', d: 'M12 6.7c0 2.4-2.2 3.1-4.6 3.4' }),
    ])
    
    /** Refresh the panel from git. */
    const IconRefresh = makeIcon([
      h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.7-3.8' }),
      h('path', { key: 'b', d: 'M13 2.6V5h-2.4' }),
    ])
    
    /** Commit. */
    const IconCheck = makeIcon([h('path', { key: 'a', d: 'M3.2 8.4 6.4 11.6 12.8 4.6' })])
    
    /** A commit node, used by the history rows. */
    const IconCommit = makeIcon([h('circle', { key: 'a', cx: 8, cy: 8, r: 2.6 }), h('path', { key: 'b', d: 'M1.8 8h3M11.2 8h3' })])
    
    /** Add to the index. */
    const IconPlus = makeIcon([h('path', { key: 'a', d: 'M8 3.2v9.6M3.2 8h9.6' })])
    
    /** Remove from the index. */
    const IconMinus = makeIcon([h('path', { key: 'a', d: 'M3.2 8h9.6' })])
    
    /** Discard worktree changes. */
    const IconUndo = makeIcon([
      h('path', { key: 'a', d: 'M3.4 7.6h6.1a3.1 3.1 0 0 1 0 6.2H6.2' }),
      h('path', { key: 'b', d: 'M6 4.4 3.2 7.6 6 10.8' }),
    ])
    
    /** Push. */
    const IconUpload = makeIcon([
      h('path', { key: 'a', d: 'M8 11.4V3.2' }),
      h('path', { key: 'b', d: 'M4.9 6.1 8 3l3.1 3.1' }),
      h('path', { key: 'c', d: 'M3 12.2v1.4h10v-1.4' }),
    ])
    
    /** Pull / fetch. */
    const IconDownload = makeIcon([
      h('path', { key: 'a', d: 'M8 3.2v8.2' }),
      h('path', { key: 'b', d: 'M4.9 8.3 8 11.4l3.1-3.1' }),
      h('path', { key: 'c', d: 'M3 12.2v1.4h10v-1.4' }),
    ])
    
    /** Expand / collapse a diff. */
    const IconChevronRight = makeIcon([h('path', { key: 'a', d: 'M6.2 3.6 10.6 8l-4.4 4.4' })])
    
    /** Expanded state of the same control. */
    const IconChevronDown = makeIcon([h('path', { key: 'a', d: 'M3.6 6.2 8 10.6l4.4-4.4' })])
    
    /** The remote ("this branch tracks origin/main"). */
    const IconCloud = makeIcon([
      h('path', { key: 'a', d: 'M4.6 11.4h6.6a2.6 2.6 0 0 0 .4-5.2 3.8 3.8 0 0 0-7.3-.6 2.9 2.9 0 0 0 .3 5.8Z' }),
    ])
    
    /** A repository. */
    const IconRepo = makeIcon([
      h('rect', { key: 'a', x: 2.6, y: 2.4, width: 10.8, height: 11.2, rx: 1.6 }),
      h('path', { key: 'b', d: 'M5.4 2.4v11.2M7.8 6h3' }),
    ])
    
    /** GitHub. */
    const IconGithub = makeIcon(
      [
        h('path', {
          key: 'a',
          d: 'M8 1.4a6.6 6.6 0 0 0-2.1 12.9c.3.1.4-.1.4-.3v-1.1c-1.8.4-2.2-.9-2.2-.9-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.5.7 1.9.5.1-.4.2-.7.4-.9-1.5-.2-3-.7-3-3.2 0-.7.2-1.3.6-1.7-.1-.2-.3-.9.1-1.8 0 0 .5-.2 1.8.7a6.2 6.2 0 0 1 3.3 0c1.2-.9 1.8-.7 1.8-.7.4.9.1 1.6.1 1.8.4.4.6 1 .6 1.7 0 2.5-1.6 3-3.1 3.2.3.2.5.7.5 1.4v2c0 .2.1.4.4.3A6.6 6.6 0 0 0 8 1.4Z',
        }),
      ],
      { filled: true },
    )
    
    /** Star count. */
    const IconStar = makeIcon([h('path', { key: 'a', d: 'M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.9Z' })])
    
    /** Fork count. */
    const IconFork = makeIcon([
      h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
      h('circle', { key: 'b', cx: 12, cy: 3.2, r: 1.7 }),
      h('circle', { key: 'c', cx: 8, cy: 12.8, r: 1.7 }),
      h('path', { key: 'd', d: 'M4 4.9v1.4c0 2 1.8 3 4 3s4-1 4-3V4.9' }),
      h('path', { key: 'e', d: 'M8 9.3v1.8' }),
    ])
    
    /** An issue. */
    const IconIssue = makeIcon([h('circle', { key: 'a', cx: 8, cy: 8, r: 6.2 }), h('circle', { key: 'b', cx: 8, cy: 8, r: 1.2, fill: 'currentColor', stroke: 'none' })])
    
    /** A pull request. */
    const IconPullRequest = makeIcon([
      h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
      h('circle', { key: 'b', cx: 4, cy: 12.8, r: 1.7 }),
      h('circle', { key: 'c', cx: 12, cy: 12.8, r: 1.7 }),
      h('path', { key: 'd', d: 'M4 4.9v6.2' }),
      h('path', { key: 'e', d: 'M12 11.1V7.2a2 2 0 0 0-2-2H6.4' }),
      h('path', { key: 'f', d: 'M7.9 3.3 6.1 5.2l1.8 1.9' }),
    ])
    
    /** A warning, for the error line. */
    const IconAlert = makeIcon([
      h('path', { key: 'a', d: 'M8 2.4 14 13H2L8 2.4Z' }),
      h('path', { key: 'b', d: 'M8 6.3v3.2' }),
      h('circle', { key: 'c', cx: 8, cy: 11.4, r: 0.7, fill: 'currentColor', stroke: 'none' }),
    ])
    
    /** Dismiss a notice. */
    const IconClose = makeIcon([h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })])
    
    /** Open in a browser. */
    const IconExternal = makeIcon([
      h('path', { key: 'a', d: 'M9.4 2.6h4v4' }),
      h('path', { key: 'b', d: 'M13.4 2.6 7.6 8.4' }),
      h('path', { key: 'c', d: 'M11.6 9.6v3.2H3.2V4.4h3.2' }),
    ])
    
    /** A lock, for the "private repository" line. */
    const IconLock = makeIcon([
      h('rect', { key: 'a', x: 3.4, y: 7, width: 9.2, height: 6.6, rx: 1.4 }),
      h('path', { key: 'b', d: 'M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7' }),
    ])
    
    /** A second checkout hanging off the repository: the worktree section's mark. */
    const IconWorktree = makeIcon([
      h('circle', { key: 'a', cx: 4.2, cy: 3.4, r: 1.6 }),
      h('circle', { key: 'b', cx: 4.2, cy: 12.6, r: 1.6 }),
      h('path', { key: 'c', d: 'M4.2 5v6' }),
      h('rect', { key: 'd', x: 8.6, y: 5.4, width: 5.2, height: 5.2, rx: 1.2 }),
    ])
    
    /** Prune: stale records cut away. */
    const IconScissors = makeIcon([
      h('circle', { key: 'a', cx: 4, cy: 4, r: 1.6 }),
      h('circle', { key: 'b', cx: 4, cy: 12, r: 1.6 }),
      h('path', { key: 'c', d: 'M5.2 5.2 13 12.4' }),
      h('path', { key: 'd', d: 'M5.2 10.8 13 3.6' }),
    ])
    
    /** A release marker: the tag chip's glyph, so the chip is not colour alone. */
    const IconTag = makeIcon([
      h('path', { key: 'a', d: 'M2.6 7.4V3.4a.8.8 0 0 1 .8-.8h4l6 6-4.8 4.8-6-6Z' }),
      h('circle', { key: 'b', cx: 5.2, cy: 5.2, r: 1 }),
    ])

    // ---- 30-style.js ----
    /**
     * Styles for the panel, injected once per page (the shell tears client plugin
     * CSS down with the plugin's own effect, so a reload cannot stack duplicates).
     *
     * Everything reads the alias tokens the theme service publishes, so light and
     * dark follow the GUI without a second palette here.
     */
    
    /** Style element marker: one element per page, replaced on hot reload. */
    const STYLE_MARKER = 'dsh-git-management/panel.css'
    
    /** The stylesheet text. */
    const PANEL_CSS = `
    .gmg-root {
      height: 100%;
      overflow: auto;
      box-sizing: border-box;
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font-size: 13px;
      line-height: 1.45;
      --gmg-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      /* Saturated marks for where things live. The theme's accents are calmer than
         a git graph needs, so the panel carries its own vivid set: blue is this
         machine, violet is the server, amber is a tag. The light-theme block below
         darkens the inks enough to keep the contrast on a white surface. */
      --gmg-local: #4d82ff;
      --gmg-local-soft: rgba(77, 130, 255, .24);
      --gmg-head-ink: #05070d;
      --gmg-remote: #b06bff;
      --gmg-remote-soft: rgba(176, 107, 255, .28);
      --gmg-tag: #f59e0b;
      --gmg-tag-soft: rgba(245, 158, 11, .26);
      --gmg-ok: #22c55e;
      --gmg-warn: #f59e0b;
      --gmg-bad: #f45c5c;
    }
    /* On a white surface the same hue has to be darker to stay readable. */
    @media (prefers-color-scheme: light) {
      .gmg-root {
        --gmg-local: #1d4ed8;
        --gmg-local-soft: rgba(29, 78, 216, .16);
        --gmg-head-ink: #ffffff;
        --gmg-remote: #7c3aed;
        --gmg-remote-soft: rgba(124, 58, 237, .16);
        --gmg-tag: #b45309;
        --gmg-tag-soft: rgba(180, 83, 9, .16);
        --gmg-ok: #15803d;
        --gmg-warn: #b45309;
        --gmg-bad: #b91c1c;
      }
    }
    .gmg-page {
      max-width: 940px;
      margin: 0 auto;
      padding: 18px 24px 72px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .gmg-head {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 4px 2px 2px;
    }
    .gmg-head-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
    .gmg-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; letter-spacing: .01em; }
    .gmg-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-family: var(--gmg-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-head-tools { display: flex; align-items: center; gap: 6px; flex: none; }
    .gmg-select {
      max-width: 240px;
      height: 28px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-layer-1);
      color: var(--dsw-alias-label-primary);
      font-size: 12px;
      outline: none;
    }
    .gmg-select:hover { border-color: var(--dsw-alias-border-l2); }
    .gmg-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--dsw-alias-label-secondary);
      cursor: pointer;
      transition: background .12s ease, color .12s ease, opacity .12s ease;
    }
    .gmg-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
    .gmg-icon-btn:disabled { opacity: .4; cursor: default; }
    .gmg-icon-btn.is-spinning svg { animation: gmg-spin 1s linear infinite; }
    @keyframes gmg-spin { to { transform: rotate(360deg); } }
    .gmg-card {
      background: var(--dsw-alias-bg-layer-2);
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .22), inset 0 1px 0 rgba(255, 255, 255, .04);
    }
    .gmg-branchbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; }
    .gmg-branchpick { position: relative; display: inline-flex; min-width: 0; }
    .gmg-branch {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 9px 3px 7px;
      border-radius: 999px;
      background: var(--gmg-local-soft);
      border: 1px solid color-mix(in srgb, var(--gmg-local) 45%, transparent);
      color: var(--gmg-local);
      font-family: var(--gmg-mono); font-size: 12px; font-weight: 600;
      max-width: 320px; overflow: hidden; cursor: pointer;
      appearance: none;
    }
    .gmg-branch:hover, .gmg-branch.is-open { border-color: var(--dsw-alias-border-l2); }
    .gmg-branch svg:last-child { transition: transform .12s ease; }
    .gmg-branch.is-open svg:last-child { transform: rotate(180deg); }
    .gmg-branch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
    .gmg-branch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The portalled surfaces sit outside .gmg-root, so they carry the mono stack
       the panel defines there: a custom property does not cross that boundary. */
    .gmg-hover, .gmg-branchmenu {
      --gmg-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    }
    .gmg-branchmenu {
      position: fixed; z-index: 4100;
      padding: 4px;
      display: flex; flex-direction: column; gap: 1px;
      max-height: 300px; overflow: auto;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: 10px;
      background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 93%, var(--dsw-alias-label-primary) 7%);
      box-shadow: 0 14px 36px rgba(0, 0, 0, .45);
    }
    .gmg-branchitem {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; border-radius: 7px;
      font-family: var(--gmg-mono); font-size: 12px;
      color: var(--dsw-alias-label-primary);
      cursor: pointer;
    }
    .gmg-branchitem.is-active { background: var(--dsw-alias-bg-layer-2); }
    .gmg-branchitem.is-current { color: var(--dsw-alias-brand-primary); }
    .gmg-branchitem-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-branchcheck { display: inline-flex; flex: none; }
    .gmg-branchmenu-empty { padding: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
    .gmg-branch.is-detached { color: var(--dsw-alias-state-warn-primary); }
    .gmg-track { color: var(--dsw-alias-label-secondary); font-size: 11px; font-family: var(--gmg-mono); display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
    /* Where the local branch stands against its remote, at a glance. */
    .gmg-track.is-synced { color: var(--gmg-ok); }
    .gmg-track.is-ahead { color: var(--gmg-local); }
    .gmg-track.is-behind { color: var(--gmg-warn); }
    .gmg-track.is-diverged { color: var(--gmg-bad); }
    .gmg-ahead { color: var(--gmg-ok); }
    .gmg-behind { color: var(--gmg-warn); }
    .gmg-synced { color: var(--gmg-ok); }
    .gmg-spacer { flex: 1; }
    .gmg-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      height: 26px; padding: 0 10px;
      border-radius: 7px;
      border: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-layer-2);
      color: var(--dsw-alias-label-primary);
      font-size: 12px; font-family: inherit;
      cursor: pointer;
      transition: background .12s ease, border-color .12s ease, opacity .12s ease;
      white-space: nowrap;
    }
    .gmg-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
    .gmg-btn:disabled { opacity: .45; cursor: default; }
    .gmg-btn.is-primary {
      background: var(--dsw-alias-brand-primary);
      border-color: transparent;
      color: #fff;
      font-weight: 600;
    }
    .gmg-btn.is-primary:hover:not(:disabled) { filter: brightness(1.08); }
    .gmg-btn.is-ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
    .gmg-btn.is-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
    .gmg-btn.is-danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
    .gmg-commit { padding: 12px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
    .gmg-textarea {
      width: 100%; box-sizing: border-box;
      min-height: 62px; max-height: 220px; resize: vertical;
      padding: 9px 11px;
      border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-base);
      color: var(--dsw-alias-label-primary);
      font-size: 13px; font-family: inherit; line-height: 1.5;
      outline: none;
      transition: border-color .12s ease, box-shadow .12s ease;
    }
    .gmg-textarea:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
    .gmg-textarea::placeholder { color: var(--dsw-alias-label-secondary); }
    .gmg-commit-foot { display: flex; align-items: center; gap: 12px; }
    .gmg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
    .gmg-check input { accent-color: var(--dsw-alias-brand-primary); margin: 0; cursor: pointer; }
    .gmg-group { border-top: 1px solid var(--dsw-alias-border-l1); }
    .gmg-group-head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      font-size: 12px; font-weight: 700; letter-spacing: .04em;
      color: var(--dsw-alias-label-primary);
      background: color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);
      text-transform: uppercase;
    }
    .gmg-count { font-weight: 500; opacity: .75; }
    /* The fold control for a group: same 22px target as the other inline buttons,
       rotated a quarter turn when the group is open. */
    .gmg-collapse {
      flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; margin-left: -6px;
      padding: 0; border: none; border-radius: 6px;
      background: transparent; color: var(--dsw-alias-label-secondary);
      cursor: pointer;
      transition: transform .12s ease, color .12s ease, background .12s ease;
      transform: rotate(-90deg);
    }
    .gmg-collapse[aria-expanded="true"] { transform: rotate(0deg); color: var(--dsw-alias-label-primary); }
    .gmg-collapse:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
    .gmg-collapse:focus-visible { outline: 2px solid var(--gmg-local); outline-offset: 1px; }
    .gmg-collapse:disabled { opacity: .35; cursor: default; }
    .gmg-group.is-collapsed .gmg-group-head { border-bottom: none; }
    .gmg-group-head .gmg-icon-btn { width: 22px; height: 22px; }
    .gmg-files { display: flex; flex-direction: column; }
    .gmg-file {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 10px 4px 12px;
      min-height: 28px;
      cursor: pointer;
      border-left: 2px solid transparent;
    }
    .gmg-file:hover { background: var(--dsw-alias-bg-layer-2); }
    .gmg-file.is-open { background: var(--dsw-alias-bg-layer-2); border-left-color: var(--dsw-alias-brand-primary); }
    .gmg-file-chevron { color: var(--dsw-alias-label-secondary); opacity: .7; display: inline-flex; }
    .gmg-status { width: 16px; text-align: center; font-family: var(--gmg-mono); font-size: 11px; font-weight: 700; }
    .gmg-path { display: flex; align-items: baseline; gap: 0; min-width: 0; flex: 1; font-size: 12.5px; }
    .gmg-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-dir { color: var(--dsw-alias-label-secondary); opacity: .72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-stats { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); display: inline-flex; gap: 6px; }
    .gmg-add-count { color: var(--gmg-ok); font-weight: 600; }
    .gmg-del-count { color: var(--gmg-bad); font-weight: 600; }
    .gmg-actions { display: inline-flex; gap: 2px; opacity: 0; transition: opacity .12s ease; }
    .gmg-file:hover .gmg-actions, .gmg-file:focus-within .gmg-actions { opacity: 1; }
    .gmg-actions .gmg-icon-btn { width: 22px; height: 22px; }
    .gmg-diff {
      margin: 0 0 6px 22px;
      border: 1px solid var(--dsw-alias-border-l1);
      border-radius: 9px;
      background: var(--dsw-alias-bg-base);
      overflow: hidden;
      max-height: 420px;
      overflow: auto;
    }
    .gmg-diff pre { margin: 0; padding: 8px 0; font-family: var(--gmg-mono); font-size: 11.5px; line-height: 1.5; }
    .gmg-diff-line { display: block; padding: 0 10px; white-space: pre; }
    .gmg-diff-line.is-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); }
    .gmg-diff-line.is-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); }
    .gmg-diff-line.is-hunk { color: var(--dsw-alias-brand-primary); opacity: .95; }
    .gmg-diff-line.is-meta { color: var(--dsw-alias-label-secondary); opacity: .8; }
    .gmg-diff-note { padding: 8px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
    .gmg-history { display: flex; flex-direction: column; position: relative; }
    /* Rows are pinned to the rail's row height: the SVG is one drawing for the
       whole list, and a lane only stays continuous if every row is the same tall. */
    .gmg-commit-row {
      display: flex; align-items: center; gap: 8px;
      height: 26px; padding: 0 12px;
      padding-right: calc(var(--gmg-graph-w, 0px) + 12px);
      box-sizing: border-box;
      cursor: pointer;
    }
    .gmg-commit-row:hover { background: var(--dsw-alias-bg-layer-2); }
    .gmg-commit-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
    .gmg-graph { position: absolute; top: 0; right: 0; pointer-events: none; overflow: visible; }
    .gmg-graph-edge { fill: none; stroke-width: 1.9; stroke-linecap: round; opacity: 1; }
    .gmg-graph-dot { stroke-width: 2; }
    .gmg-ref {
      flex: none; max-width: 108px;
      display: inline-flex; align-items: center; gap: 3px;
      height: 17px; padding: 0 6px; border-radius: 5px;
      font-family: var(--gmg-mono); font-size: 10.5px; line-height: 1; font-weight: 700;
      border: 1px solid transparent;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Where a ref lives is the point of these colours: blue is this machine,
       violet is the server. Each chip is filled, not tinted, so it reads as a mark
       rather than as quiet text; the glyph carries the same fact without colour. */
    .gmg-ref.is-head {
      color: var(--gmg-head-ink);
      background: var(--gmg-local);
      border-color: color-mix(in srgb, var(--gmg-local) 70%, #000);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--gmg-local) 45%, transparent);
    }
    .gmg-ref.is-branch {
      color: var(--gmg-local);
      background: var(--gmg-local-soft);
      border-color: color-mix(in srgb, var(--gmg-local) 45%, transparent);
    }
    .gmg-ref.is-remote {
      color: var(--gmg-remote);
      background: var(--gmg-remote-soft);
      border-color: color-mix(in srgb, var(--gmg-remote) 45%, transparent);
    }
    .gmg-ref.is-tag {
      color: var(--gmg-tag);
      background: var(--gmg-tag-soft);
      border-color: color-mix(in srgb, var(--gmg-tag) 45%, transparent);
    }
    .gmg-ref.is-detached {
      color: var(--gmg-warn);
      background: var(--gmg-tag-soft);
      border-color: color-mix(in srgb, var(--gmg-warn) 45%, transparent);
    }
    .gmg-ref svg { flex: none; opacity: 1; }
    .gmg-ref-dot {
      flex: none; width: 6px; height: 6px; border-radius: 50%;
      background: currentColor; box-shadow: 0 0 0 2px color-mix(in srgb, #fff 35%, transparent);
    }
    .gmg-ref-more { flex: none; font-size: 10px; color: var(--dsw-alias-label-secondary); }
    .gmg-sha {
      font-family: var(--gmg-mono); font-size: 11px;
      padding: 1px 6px; border-radius: 5px;
      background: var(--dsw-alias-bg-layer-2);
      color: var(--dsw-alias-label-secondary);
      flex: none;
    }
    .gmg-subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    .gmg-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
    .gmg-notice {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 9px; font-size: 12px;
      border: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-layer-1);
    }
    .gmg-notice.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); color: var(--dsw-alias-state-error-primary); }
    .gmg-notice.is-ok { color: var(--dsw-alias-state-success-primary); }
    /* Both notice kinds carry a dismiss button: keep them in view while the page
       scrolls, because an error the user has scrolled past reads as no response. */
    .gmg-notice.is-error, .gmg-notice.is-ok { position: sticky; top: 8px; z-index: 5; }
    .gmg-icon-btn:focus-visible,
    .gmg-file:focus-visible,
    .gmg-branchitem:focus-visible,
    .gmg-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
    .gmg-notice span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .gmg-empty { padding: 14px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
    .gmg-gh { display: flex; flex-direction: column; }
    .gmg-gh-head { display: flex; align-items: center; gap: 10px; padding: 11px 12px; flex-wrap: wrap; }
    .gmg-gh-name { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
    .gmg-gh-desc { width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; }
    .gmg-gh-stats { display: inline-flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
    .gmg-gh-stats span { display: inline-flex; align-items: center; gap: 3px; }
    .gmg-gh-body { border-top: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; }
    .gmg-gh-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; }
    .gmg-gh-row:hover { background: var(--dsw-alias-bg-layer-2); }
    .gmg-gh-num { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); flex: none; }
    .gmg-gh-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-gh-label { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
    .gmg-gh-tabs { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
    .gmg-gh-tab { font-size: 12px; padding: 4px 9px; border-radius: 7px; cursor: pointer; color: var(--dsw-alias-label-secondary); border: 1px solid transparent; display: inline-flex; align-items: center; gap: 5px; }
    .gmg-gh-tab.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
    .gmg-gh-tab:hover { color: var(--dsw-alias-label-primary); }
    .gmg-form { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
    .gmg-input {
      height: 28px; padding: 0 9px;
      border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
      font-size: 12px; font-family: inherit; outline: none;
    }
    .gmg-input:focus { border-color: var(--dsw-alias-brand-primary); }
    .gmg-hint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
    .gmg-kbd { font-family: var(--gmg-mono); font-size: 10.5px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
    .gmg-scroll-cap { max-height: 320px; overflow: auto; }
    
    /* ---- worktrees ---- */
    .gmg-wts { display: flex; flex-direction: column; }
    .gmg-wt {
      display: flex; align-items: center; gap: 7px;
      padding: 5px 10px 5px 12px;
      min-height: 28px;
      font-size: 12px;
    }
    .gmg-wt:hover { background: var(--dsw-alias-bg-layer-2); }
    .gmg-wt.is-current { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
    .gmg-wt-branch { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-primary); flex: none; max-width: 44%; }
    .gmg-wt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gmg-mono); font-size: 11.5px; }
    .gmg-wt-tag {
      flex: none; font-size: 10px; line-height: 1.6; padding: 0 5px; border-radius: 999px;
      border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary);
    }
    .gmg-wt-tag.is-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
    .gmg-wt-tag.is-current { color: var(--dsw-alias-brand-primary); border-color: transparent; padding: 0 2px; }
    .gmg-wt-path { flex: 1; min-width: 0; color: var(--dsw-alias-label-secondary); opacity: .8; font-family: var(--gmg-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-wt-dirty { flex: none; font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); }
    .gmg-wt-dirty.is-dirty { color: var(--dsw-alias-state-warn-primary); }
    .gmg-wt .gmg-actions { opacity: 0; }
    .gmg-wt:hover .gmg-actions, .gmg-wt:focus-within .gmg-actions { opacity: 1; }
    
    /* ---- the centre-column diff ---- */
    .gmg-difftabtitle { display: inline-flex; align-items: center; gap: 3px; min-width: 0; }
    .gmg-difftabname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-diffpanel { display: flex; flex-direction: column; height: 100%; background: var(--dsw-alias-bg-base); overflow: hidden; }
    .gmg-diffhead {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 14px;
      border-bottom: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-base);
      flex: none;
    }
    .gmg-diffpath { font-family: var(--gmg-mono); font-size: 12.5px; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-diffscroll { flex: 1; overflow: auto; }
    .gmg-diffbody { font-family: var(--gmg-mono); font-size: 12px; line-height: 1.6; min-width: max-content; padding-bottom: 40px; }
    .gmg-diffrow { display: grid; grid-template-columns: 54px 54px 1fr; align-items: start; }
    .gmg-diffrow.is-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
    .gmg-diffrow.is-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
    .gmg-diffrow.is-hunk { background: var(--dsw-alias-bg-layer-2); }
    .gmg-diff-no {
      color: var(--dsw-alias-label-secondary); opacity: .75;
      text-align: right; padding: 0 8px 0 2px;
      font-size: 11px; user-select: none;
      border-right: 1px solid var(--dsw-alias-border-l1);
      white-space: nowrap;
    }
    .gmg-diff-cell { padding: 0 12px; white-space: pre; color: var(--dsw-alias-label-primary); }
    .gmg-diff-cell.is-add { color: var(--dsw-alias-state-success-primary); }
    .gmg-diff-cell.is-del { color: var(--dsw-alias-state-error-primary); }
    .gmg-diff-cell.is-hunk { grid-column: 1 / -1; color: var(--dsw-alias-brand-primary); padding: 3px 12px; font-size: 11px; }
    .gmg-diff-cell.is-meta { grid-column: 1 / -1; color: var(--dsw-alias-label-secondary); opacity: .7; }
    .gmg-diffbody.is-split { min-width: 0; width: 100%; }
    .gmg-diffbody.is-split .gmg-diffrow.is-splitrow { grid-template-columns: 44px minmax(0, 1fr) 44px minmax(0, 1fr); }
    .gmg-diffbody.is-split .gmg-diff-cell { overflow: hidden; }
    /* Side-by-side tints each half, not the row: one row can carry a removal on
       the left and an addition on the right, and the gutters belong to that half. */
    .gmg-diffbody.is-split .gmg-diff-cell.is-add,
    .gmg-diffbody.is-split .gmg-diff-no.is-add {
      background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
    }
    .gmg-diffbody.is-split .gmg-diff-cell.is-del,
    .gmg-diffbody.is-split .gmg-diff-no.is-del {
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
    }
    .gmg-diffbody.is-split .gmg-diffrow.is-splitrow > .gmg-diff-no:nth-child(3) { border-left: 1px solid var(--dsw-alias-border-l1); }
    .gmg-diffbody.is-split .gmg-diff-cell.is-blank,
    .gmg-diffbody.is-split .gmg-diff-no.is-blank { background: var(--dsw-alias-bg-layer-1); }
    .gmg-diffbody.is-split .gmg-diff-cell.is-hunk { grid-column: 1 / -1; }
    
    /* ---- hover detail: three zones, each with its own surface ---- */
    .gmg-hovertarget { display: contents; }
    
    .gmg-hover {
      position: fixed; z-index: 4000;
      max-width: 400px; min-width: 240px;
      padding: 0;
      border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l2);
      background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 93%, var(--dsw-alias-label-primary) 7%);
      box-shadow: 0 18px 44px rgba(0, 0, 0, .5);
      font-size: 12px;
      overflow: auto;
      overscroll-behavior: contain;
      pointer-events: auto;
    }
    .gmg-hovercard { display: flex; flex-direction: column; }
    .gmg-hoverzone { padding: 8px 11px; }
    .gmg-hoverzone.is-head {
      display: flex; align-items: center; gap: 7px;
      position: sticky; top: 0; z-index: 1;
      background: var(--dsw-alias-bg-layer-2);
      border-bottom: 1px solid var(--dsw-alias-border-l1);
    }
    .gmg-hoverzone.is-head .gmg-sha {
      background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
      color: var(--dsw-alias-brand-primary);
    }
    .gmg-hoverzone.is-subject {
      padding: 9px 11px;
      font-size: 13px; font-weight: 650; line-height: 1.45;
      color: var(--dsw-alias-label-primary);
    }
    .gmg-hoverzone.is-body {
      padding: 9px 11px 10px;
      border-top: 1px solid var(--dsw-alias-border-l1);
      background: color-mix(in srgb, var(--dsw-alias-bg-base) 45%, transparent);
      font-size: 11.5px; line-height: 1.6;
      color: var(--dsw-alias-label-primary);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .gmg-hoverzone.is-foot {
      display: flex; flex-direction: column; gap: 6px;
      border-top: 1px solid var(--dsw-alias-border-l1);
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 65%, transparent);
    }
    .gmg-hoverauthor { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-primary); opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-hoverdot { color: var(--dsw-alias-label-primary); opacity: .45; }
    .gmg-hoversubject { font-weight: 600; font-size: 12.5px; line-height: 1.4; }
    
    .gmg-hovertrack { margin-top: 5px; font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-primary); opacity: .8; }
    .gmg-hoverstats { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11.5px; color: var(--dsw-alias-label-primary); opacity: .9; }
    .gmg-stat-sep { opacity: .45; }
    .gmg-stat-add { color: var(--gmg-ok); font-family: var(--gmg-mono); font-weight: 600; }
    .gmg-stat-del { color: var(--gmg-bad); font-family: var(--gmg-mono); font-weight: 600; }
    .gmg-statbar { display: flex; height: 3px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-bg-base); }
    .gmg-statbar-add { height: 100%; background: var(--gmg-ok); }
    .gmg-statbar-del { height: 100%; background: var(--gmg-bad); }
    
    /* ---- the commit-diff tab: one commit, every file stacked ---- */
    .gmg-cdiff-head {
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 10px 7px;
      border-bottom: 1px solid var(--dsw-alias-border-l1);
      background: var(--dsw-alias-bg-base);
      flex: none;
    }
    .gmg-cdiff-headline { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .gmg-cdiff-headline .gmg-btn { flex: none; padding: 0 6px; }
    .gmg-cdiff-subject { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gmg-cdiff-subline { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
    .gmg-cdiff-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gmg-cdiff-scroll { flex: 1; overflow: auto; overscroll-behavior: contain; padding-bottom: 24px; }
    .gmg-cdiff-files { display: flex; flex-direction: column; }
    .gmg-cdiff-file { border-bottom: 1px solid var(--dsw-alias-border-l1); }
    /* Each file header sticks to the top of the scroll while its own diff passes
       under it, which is how a reader keeps track of which file is on screen. */
    .gmg-cdiff-filehead {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px 5px 6px;
      background: var(--dsw-alias-bg-layer-2);
      border-bottom: 1px solid var(--dsw-alias-border-l1);
      cursor: pointer;
      font-size: 12px;
    }
    .gmg-cdiff-filehead:hover { background: var(--dsw-alias-bg-layer-1); }
    .gmg-cdiff-filehead:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
    .gmg-cdiff-chevron { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); transition: transform .12s ease; }
    .gmg-cdiff-file.is-folded .gmg-cdiff-chevron { transform: rotate(-90deg); }
    .gmg-cdiff-rename { font-size: 10.5px; color: var(--dsw-alias-label-secondary); opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 38%; flex: none; }
    .gmg-cdiff-body .gmg-diffbody { padding-bottom: 0; }
    .gmg-cdiff-note { padding: 8px 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
    .gmg-cdiff-failure { display: flex; flex-direction: column; }
    
    /* ---- the right-sidebar tab: a ~320-420px column, not a page ---- */
    .gmg-root.is-compact .gmg-page { max-width: none; padding: 8px 8px 28px; gap: 8px; }
    .gmg-root.is-compact .gmg-head { gap: 8px; align-items: center; padding: 2px 2px 0; }
    .gmg-root.is-compact .gmg-title { font-size: 12px; font-weight: 600; }
    .gmg-root.is-compact .gmg-sub { display: none; }
    .gmg-root.is-compact .gmg-head-tools { flex: 1; min-width: 0; }
    .gmg-root.is-compact .gmg-select { flex: 1; min-width: 0; max-width: none; }
    .gmg-root.is-compact .gmg-card { border-radius: 10px; }
    .gmg-root.is-compact .gmg-commit { padding: 8px; gap: 8px; }
    .gmg-root.is-compact .gmg-commit-foot { flex-wrap: wrap; gap: 6px 10px; }
    .gmg-root.is-compact .gmg-kbd-hint { display: none; }
    .gmg-root.is-compact .gmg-textarea { min-height: 52px; font-size: 12.5px; }
    .gmg-root.is-compact .gmg-branchbar { padding: 8px; gap: 6px; }
    .gmg-root.is-compact .gmg-btn { padding: 0 8px; height: 25px; }
    .gmg-root.is-compact .gmg-branch { max-width: 190px; }
    .gmg-root.is-compact .gmg-group-head { padding: 7px 9px; }
    .gmg-root.is-compact .gmg-file { padding: 4px 6px 4px 8px; gap: 6px; }
    .gmg-root.is-compact .gmg-diff { margin-left: 4px; max-height: 320px; }
    .gmg-root.is-compact .gmg-diff pre { font-size: 11px; }
    .gmg-root.is-compact .gmg-gh-head { padding: 9px; gap: 8px; }
    .gmg-root.is-compact .gmg-gh-desc { padding: 0 9px 9px !important; }
    .gmg-root.is-compact .gmg-commit-row { padding: 0 9px; padding-right: calc(var(--gmg-graph-w, 0px) + 9px); gap: 6px; }
    .gmg-root.is-compact .gmg-ref { max-width: 84px; font-size: 10px; }
    .gmg-root.is-compact .gmg-wt { padding: 5px 6px 5px 8px; gap: 5px; }
    .gmg-root.is-compact .gmg-wt-path { display: none; }
    .gmg-root.is-compact .gmg-meta { display: none; }
    .gmg-root.is-compact .gmg-diffhead { padding: 8px; gap: 6px; }
    .gmg-root.is-compact .gmg-diffpath { max-width: 100%; flex: 1; }
    .gmg-root.is-compact .gmg-diffbody { font-size: 11.5px; }
    .gmg-root.is-compact .gmg-diffrow { grid-template-columns: 40px 40px 1fr; }
    .gmg-root.is-compact .gmg-diffbody.is-split .gmg-diffrow.is-splitrow { grid-template-columns: 34px minmax(0, 1fr) 34px minmax(0, 1fr); }
    .gmg-root.is-compact .gmg-diff-no { padding: 0 5px 0 1px; }
    .gmg-root.is-compact .gmg-diff-cell { padding: 0 8px; }
    .gmg-root.is-compact .gmg-cdiff-head { padding: 7px 8px 6px; }
    .gmg-root.is-compact .gmg-cdiff-subject { font-size: 12px; }
    .gmg-root.is-compact .gmg-cdiff-filehead { padding: 4px 6px; }
    `
    
    /**
     * Install the stylesheet once.
     * @returns the disposer removing it.
     */
    function installPanelStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${STYLE_MARKER}"]`)
      if (existing !== null) existing.remove()
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = STYLE_MARKER
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    // ---- 40-panel.js ----
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

    // ---- 45-diff-panel.js ----
    /**
     * The centre-column diff view.
     *
     * This is the seat that plays the editor's part in the Cursor comparison: the
     * right column keeps the file list, and clicking a row swaps this panel into
     * the main column at full width, with both gutters, a unified/split switch,
     * and prev/next across the same change set. Closing it returns to the
     * conversation (`selectPanel(null)`).
     */
    
    /**
     * One gutter cell.
     *
     * The kind matters in side-by-side: a row can hold a removal on the left and an
     * addition on the right, so each half has to carry its own colour — the row
     * cannot. The number sits in that half's tint along with the text.
     *
     * @param props - `{ value, kind }`.
     * @returns the cell element.
     */
    function DiffGutter(props) {
      const kind = props.kind ?? null
      return h(
        'span',
        { className: kind === null ? 'gmg-diff-no' : `gmg-diff-no is-${kind}` },
        props.value === null || props.value === undefined ? '' : String(props.value),
      )
    }
    
    /**
     * One body cell.
     * @param props - `{ kind, text }`.
     * @returns the cell element.
     */
    function DiffCell(props) {
      return h(
        'span',
        { className: `gmg-diff-cell is-${props.kind ?? 'blank'}`, title: props.clip === true ? props.text ?? '' : undefined },
        props.text ?? '',
      )
    }
    
    /**
     * The diff panel body in unified form.
     * @param props - `{ rows }`.
     * @returns the element.
     */
    function UnifiedDiff(props) {
      const rows = props.rows
      return h(
        'div',
        { className: 'gmg-diffbody' },
        rows.map((row, index) => {
          if (row.kind === DIFF_HUNK) {
            return h('div', { className: 'gmg-diffrow is-hunk', key: index }, h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-cell is-hunk' }, row.text))
          }
          if (row.kind === DIFF_META) {
            return h('div', { className: 'gmg-diffrow is-meta', key: index }, h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-cell is-meta' }, row.text))
          }
          return h(
            'div',
            { className: `gmg-diffrow is-${row.kind}`, key: index },
            h(DiffGutter, { value: row.oldNo }),
            h(DiffGutter, { value: row.newNo }),
            h(DiffCell, { kind: row.kind, text: row.text }),
          )
        }),
      )
    }
    
    /**
     * The diff panel body in side-by-side form.
     * @param props - `{ pairs }`.
     * @returns the element.
     */
    function SplitDiff(props) {
      return h(
        'div',
        { className: 'gmg-diffbody is-split' },
        props.pairs.map((pair, index) => {
          if (pair.left?.kind === DIFF_HUNK) {
            return h('div', { className: 'gmg-diffrow is-hunk is-splitrow', key: index }, h('span', { className: 'gmg-diff-cell is-hunk' }, pair.left.text))
          }
          const left = pair.left
          const right = pair.right
          return h(
            'div',
            { className: 'gmg-diffrow is-splitrow', key: index },
            h(DiffGutter, { value: left?.oldNo ?? null, kind: left?.kind ?? 'blank' }),
            h(DiffCell, { kind: left?.kind ?? 'blank', text: left?.text ?? '', clip: true }),
            h(DiffGutter, { value: right?.newNo ?? null, kind: right?.kind ?? 'blank' }),
            h(DiffCell, { kind: right?.kind ?? 'blank', text: right?.text ?? '', clip: true }),
          )
        }),
      )
    }
    
    /**
     * The panel itself.
     * @param props - `{ t }` from the slot's locale namespace.
     * @returns the element.
     */
    function DiffPanel(props) {
      const t = typeof props?.t === 'function' ? props.t : tr
      const state = useDiffState()
      const panel = useGitStore()
      const target = state.target
      const compact = props?.compact === true
      const rootClass = `gmg-root gmg-diffpanel${compact ? ' is-compact' : ''}`
    
      // Closing is the tab's own action when the column provides one, so the strip
      // drops the tab instead of leaving an empty seat behind.
      const closeRef = useRef(typeof props?.onClose === 'function' ? props.onClose : closeDiff)
      useEffect(() => {
        closeRef.current = typeof props?.onClose === 'function' ? props.onClose : closeDiff
      }, [props?.onClose])
    
      // Escape leaves the diff, the way it leaves a peek in an editor.
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (getDiffState().target === null) return
          closeRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
    
      if (target === null) {
        return h('div', { className: rootClass }, h('div', { className: 'gmg-empty' }, t('diffNothingOpen')))
      }
    
      // The same change set, so prev/next walks exactly what the sidebar lists.
      const status = panel.status
      const siblings = status === null
        ? []
        : [
            ...status.staged.map((row) => ({ row, staged: true })),
            ...status.changes.map((row) => ({ row, staged: false })),
            ...status.conflicts.map((row) => ({ row, staged: false })),
          ]
      const currentIndex = siblings.findIndex((entry) => entry.row.path === target.file && entry.staged === target.staged)
      const go = (offset) => {
        if (siblings.length === 0) return
        const next = (currentIndex + offset + siblings.length) % siblings.length
        const entry = siblings[next]
        openDiff({ path: target.path, file: entry.row.path, staged: entry.staged, status: entry.row.status })
      }
    
      const additions = state.rows.filter((row) => row.kind === DIFF_ADD).length
      const deletions = state.rows.filter((row) => row.kind === DIFF_DEL).length
      const otherSide = siblings.some((entry) => entry.row.path === target.file && entry.staged !== target.staged)
      const current = siblings.find((entry) => entry.row.path === target.file && entry.staged === target.staged)
      const untracked = current?.row.kind === 'untracked'
      const close = () => (props.onClose ?? closeDiff)()
      const stageHere = () => {
        gitStore.fileAction('stage', [target.file], null).then(() => {
          openDiff({ ...target, staged: true })
        })
      }
      const discardHere = () => {
        const message = untracked ? t('deleteConfirm', { file: target.file }) : t('discardConfirm', { file: target.file })
        if (!window.confirm(message)) return
        const notice = untracked ? t('deleted') : t('discarded')
        gitStore.fileAction(untracked ? 'deleteUntracked' : 'discard', [target.file], notice).then((ok) => {
          if (ok) close()
        })
      }
    
      const header = h(
        'div',
        { className: 'gmg-diffhead' },
        h(
          'button',
          { className: 'gmg-btn is-ghost', type: 'button', onClick: () => (props.onClose ?? closeDiff)(), title: t('diffBackHint') },
          '←',
          t('diffBack'),
        ),
        h('span', { className: `gmg-status`, style: { color: statusColor(target.status ?? 'M') } }, statusGlyph(target.status ?? 'M')),
        h('span', { className: 'gmg-diffpath', title: target.file }, target.file),
        h('span', { className: 'gmg-gh-label' }, target.staged ? t('diffStagedBadge') : t('diffWorktreeBadge')),
        h('span', { className: 'gmg-add-count gmg-stats' }, `+${additions}`),
        h('span', { className: 'gmg-del-count gmg-stats' }, `-${deletions}`),
        target.staged
          ? null
          : h(
              'button',
              {
                className: 'gmg-btn',
                type: 'button',
                disabled: panel.busy !== null,
                onClick: stageHere,
                title: t('stage'),
              },
              h(IconPlus, { size: 12 }),
              t('stage'),
            ),
        h(
          'button',
          {
            className: 'gmg-btn is-danger',
            type: 'button',
            disabled: panel.busy !== null,
            onClick: discardHere,
            title: untracked ? t('delete') : t('discard'),
          },
          h(IconUndo, { size: 12 }),
          untracked ? t('delete') : t('discard'),
        ),
        h('span', { className: 'gmg-spacer' }),
        otherSide
          ? h(
              'button',
              {
                className: 'gmg-btn',
                type: 'button',
                onClick: () => openDiff({ ...target, staged: !target.staged }),
              },
              target.staged ? t('diffShowWorktree') : t('diffShowStaged'),
            )
          : null,
        h(
          'button',
          { className: 'gmg-btn', type: 'button', disabled: siblings.length < 2, onClick: () => go(-1), title: t('diffPrev') },
          '↑',
        ),
        h(
          'button',
          { className: 'gmg-btn', type: 'button', disabled: siblings.length < 2, onClick: () => go(1), title: t('diffNext') },
          '↓',
        ),
        h(
          'button',
          {
            className: 'gmg-btn',
            type: 'button',
            onClick: () => toggleDiffContext(),
            title: t('diffContextHint'),
          },
          state.context === 'full' ? t('diffOnlyChanges') : t('diffFullFile'),
        ),
        h(
          'button',
          {
            className: 'gmg-btn',
            type: 'button',
            onClick: () => toggleDiffMode(),
            title: state.mode === 'unified' ? t('diffSplit') : t('diffUnified'),
          },
          state.mode === 'unified' ? t('diffSplit') : t('diffUnified'),
        ),
        h('button', { className: 'gmg-icon-btn', type: 'button', onClick: () => (props.onClose ?? closeDiff)(), title: t('dismiss') }, h(IconClose, { size: 14 })),
      )
    
      let body
      if (state.loading) body = h('div', { className: 'gmg-empty' }, t('loadingDiff'))
      else if (state.error !== null) body = h('div', { className: 'gmg-empty' }, state.error)
      else if (state.note === 'binary') body = h('div', { className: 'gmg-empty' }, t('binaryDiff'))
      else if (state.note === 'unmerged') body = h('div', { className: 'gmg-empty' }, t('diffUnmerged'))
      else if (state.note === 'empty') body = h('div', { className: 'gmg-empty' }, t('emptyDiff'))
      else if (state.rows.length === 0) body = h('div', { className: 'gmg-empty' }, t('emptyDiff'))
      else body = state.mode === 'unified' ? h(UnifiedDiff, { rows: state.rows }) : h(SplitDiff, { pairs: state.pairs })
    
      return h(
        'div',
        { className: rootClass },
        header,
        h('div', { className: 'gmg-diffscroll' }, body),
      )
    }

    // ---- 46-hover.js ----
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

    // ---- 47-commit-panel.js ----
    /**
     * The commit-diff tab: one historical commit's changes, file by file.
     *
     * Cursor answers a click on a commit in its history with a comparison opened in
     * the sidebar; each touched file becomes its own block down the column. This is
     * that surface: a sticky commit header, then one block per file — path, status
     * and +/− counts, then only the changed hunks, never the whole file — all in
     * one scroll. Opening a second commit opens a second tab, so two commits can be
     * compared side by side without either one replacing the other.
     */

    /** The chip label of a commit tab: the subject (or the short id when it has none). */
    function CommitTabTitle(props) {
      const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
      const info = useInfo()
      const params = info?.tab?.navigation?.params ?? null
      const t = typeof props?.t === 'function' ? props.t : tr
      const subject = typeof params?.subject === 'string' && params.subject !== '' ? params.subject : ''
      const short = typeof params?.short === 'string' ? params.short : String(params?.sha ?? '').slice(0, 7)
      return h(
        'span',
        { className: 'gmg-difftabtitle' },
        h(IconCommit, { size: 11 }),
        h('span', { className: 'gmg-difftabname', title: subject === '' ? short : `${short} · ${subject}` }, subject === '' ? short || t('commitDiffTabTitle') : subject),
      )
    }

    /**
     * One file's block: its header is the fold control, its body the hunks.
     *
     * @param props - `{ file, t, open, onToggle }`.
     * @returns the block element.
     */
    function CommitFileBlock(props) {
      const { file, t, open, onToggle } = props
      const { name, dir } = splitPath(file.path)
      const hasText = file.binary === false && file.rows.length > 0
      const toggle = () => onToggle()
      const header = h(
        'div',
        {
          className: 'gmg-cdiff-filehead',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          title: file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`,
          onClick: toggle,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggle()
            }
          },
        },
        h('span', { className: 'gmg-cdiff-chevron' }, h(IconChevronDown, { size: 11 })),
        h('span', { className: 'gmg-status', style: { color: statusColor(file.status) }, title: t('status') }, statusGlyph(file.status)),
        h(
          'span',
          { className: 'gmg-path' },
          h('span', { className: 'gmg-name' }, name),
          dir === '' ? null : h('span', { className: 'gmg-dir' }, dir),
        ),
        file.oldPath === null ? null : h('span', { className: 'gmg-cdiff-rename', title: file.oldPath }, `← ${file.oldPath}`),
        h('span', { className: 'gmg-spacer' }),
        file.binary ? h('span', { className: 'gmg-gh-label' }, t('commitDiffBinaryBadge')) : null,
        file.additions > 0 ? h('span', { className: 'gmg-add-count gmg-stats' }, `+${file.additions}`) : null,
        file.deletions > 0 ? h('span', { className: 'gmg-del-count gmg-stats' }, `-${file.deletions}`) : null,
      )

      let body = null
      if (hasText === false) {
        body = h('div', { className: 'gmg-cdiff-note' }, file.binary ? t('commitDiffBinary') : t('commitDiffNoText'))
      } else {
        body = h('div', { className: 'gmg-cdiff-body' }, h(UnifiedDiff, { rows: file.rows }))
      }

      return h('section', { className: `gmg-cdiff-file${open ? '' : ' is-folded'}${hasText ? '' : ' is-flat'}` }, header, open ? body : null)
    }

    /**
     * The tab body.
     *
     * @param props - `{ view, params, t, onClose, onRetry }`; `view` is the cached
     *   `{ status, commit, files, additions, deletions, total, truncated }`.
     * @returns the panel element.
     */
    function CommitDiffPanel(props) {
      const view = props.view ?? null
      const params = props.params ?? {}
      const t = typeof props?.t === 'function' ? props.t : tr
      const closeRef = useRef(typeof props?.onClose === 'function' ? props.onClose : () => {})
      useEffect(() => {
        closeRef.current = typeof props?.onClose === 'function' ? props.onClose : () => {}
      }, [props?.onClose])

      // Escape leaves the tab, the way it leaves a peek in an editor.
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          closeRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const [folded, setFolded] = useState(() => new Set())
      const commit = view?.commit ?? null
      const files = view?.files ?? []
      const loading = view === null || view.status === 'loading' || view.status === 'idle'
      const error = view?.status === 'error' ? view.error : null
      const sha = commit?.sha ?? (typeof params.sha === 'string' ? params.sha : '')
      const short = commit?.short ?? (typeof params.short === 'string' ? params.short : String(sha).slice(0, 7))
      const subject = commit?.subject ?? (typeof params.subject === 'string' ? params.subject : '')
      const author = commit?.author ?? ''
      const lang = typeof props?.lang === 'string' ? props.lang : currentLocale()
      const additions = view?.additions ?? 0
      const deletions = view?.deletions ?? 0
      const total = view?.total ?? files.length
      const allFolded = files.length > 0 && files.every((file) => folded.has(file.path))

      const toggleFile = (path) => {
        setFolded((previous) => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }
      const toggleAll = () => setFolded(allFolded ? new Set() : new Set(files.map((file) => file.path)))

      const header = h(
        'div',
        { className: 'gmg-cdiff-head' },
        h(
          'div',
          { className: 'gmg-cdiff-headline' },
          h(
            'button',
            { className: 'gmg-btn is-ghost', type: 'button', onClick: () => closeRef.current(), title: t('diffBackHint') },
            '←',
            t('diffBack'),
          ),
          short === '' ? null : h('span', { className: 'gmg-sha', title: sha }, short),
          h('span', { className: 'gmg-cdiff-subject', title: sha === '' ? subject : `${short} ${subject}` }, subject === '' ? t('commitDiffTabTitle') : subject),
        ),
        h(
          'div',
          { className: 'gmg-cdiff-subline' },
          author === '' ? null : h('span', { className: 'gmg-cdiff-meta' }, author),
          commit?.date ? h('span', { className: 'gmg-cdiff-meta' }, relativeTime(commit.date, lang)) : null,
          commit?.merge === true ? h('span', { className: 'gmg-gh-label' }, t('commitDiffMergeBadge')) : null,
          h('span', { className: 'gmg-spacer' }),
          h('span', { className: 'gmg-cdiff-meta', title: t('hoverStatFiles', { files: total }) }, t('commitDiffFileCount', { files: total })),
          additions > 0 ? h('span', { className: 'gmg-add-count gmg-stats' }, `+${additions}`) : null,
          deletions > 0 ? h('span', { className: 'gmg-del-count gmg-stats' }, `-${deletions}`) : null,
          files.length > 0
            ? h('button', { className: 'gmg-btn is-ghost', type: 'button', onClick: toggleAll }, allFolded ? t('commitDiffExpandAll') : t('commitDiffCollapseAll'))
            : null,
        ),
      )

      let body
      if (loading) {
        body = h('div', { className: 'gmg-empty' }, t('commitDiffLoading'))
      } else if (error !== null) {
        body = h(
          'div',
          { className: 'gmg-cdiff-failure' },
          h('div', { className: 'gmg-empty' }, error),
          h(
            'div',
            { className: 'gmg-form' },
            h(
              'button',
              { className: 'gmg-btn is-primary', type: 'button', onClick: () => (typeof props.onRetry === 'function' ? props.onRetry() : null) },
              t('commitDiffRetry'),
            ),
          ),
        )
      } else if (files.length === 0) {
        body = h('div', { className: 'gmg-empty' }, t('commitDiffEmpty'))
      } else {
        body = h(
          'div',
          { className: 'gmg-cdiff-files' },
          files.map((file) =>
            h(CommitFileBlock, { key: file.path, file, t, open: folded.has(file.path) === false, onToggle: () => toggleFile(file.path) }),
          ),
          view?.truncated === true
            ? h('div', { className: 'gmg-cdiff-note' }, t('commitDiffTruncated', { shown: files.length, total }))
            : null,
        )
      }

      return h(
        'div',
        { className: 'gmg-root gmg-diffpanel gmg-commitpanel is-compact' },
        header,
        h('div', { className: 'gmg-cdiff-scroll' }, body),
      )
    }

    // ---- 50-plugin.js ----
    /**
     * Plugin wiring: dictionaries, styles, and the right-column tab.
     *
     * One seat: `sidebarRightTabs.register` declares the type (and the start-page
     * card), and two slots keyed by that id supply the tab body and its chip. The
     * body itself swaps between the change list and a file's diff, so opening a
     * diff never covers the conversation column.
     */
    
    /** Dictionary namespace for this plugin's copy. */
    const NS = 'dsh-git-management'
    
    /** The right-column tab's id: the `sidebarRightTabs` registration and both slot keys. */
    const TAB_ID = 'dsh-git-management'
    
    /** The tab kind, i.e. what the column records for `openTab(kind)`. */
    const TAB_KIND = 'git'
    
    /** The second tab type: one file's diff, opened beside the change list. */
    const DIFF_TAB_ID = 'dsh-git-diff'
    
    /** The diff tab's kind, as `sidebarRight.openTab` names it. */
    const DIFF_TAB_KIND = 'git-diff'
    
    /**
     * The third tab type: one commit's whole change set.
     *
     * Registered `multiple: true`, which is what makes every history click its own
     * tab — the same independent-instance rule the terminal tabs use. Without it
     * the column would reuse one tab and a second commit would replace the first.
     */
    const COMMIT_TAB_ID = 'dsh-git-commit'
    
    /** The commit tab's kind, as `sidebarRight.openTab` names it. */
    const COMMIT_TAB_KIND = 'git-commit'
    
    /** Chinese copy (the GUI's default language on this machine). */
    const zh = {
      panelTitle: '源代码管理',
      guideDescription: '暂存、提交、分支与同步',
      noRepo: '未选择仓库',
      switchRepo: '切换仓库',
      refresh: '刷新',
      loadRepos: '重新读取工作区',
      notARepoShort: '非仓库',
      dismiss: '关闭提示',
      loading: '正在读取…',
      pickWorkspace: '选择一个工作区开始管理版本。',
      notARepo: '这个目录还不是 Git 仓库。',
      initRepo: '初始化仓库',
      initHint: '会在此目录执行 git init，不会创建提交。',
      staged: '已暂存的更改',
      changes: '更改',
      noChanges: '没有未暂存的更改。',
      conflicts: '冲突',
      history: '历史提交',
      showMore: '显示全部',
      showLess: '收起',
      noCommits: '还没有提交。',
      branch: '当前分支',
      detached: '游离 HEAD',
      switchBranch: '切换分支',
      notPublished: '尚未发布到远端',
      fetch: '获取',
      fetchHint: 'git fetch --prune origin',
      pull: '拉取',
      pullHint: 'git pull --ff-only（只做快进合并）',
      push: '推送',
      pushHint: '首次推送会自动建立上游分支',
      newBranch: '新建分支',
      newBranchPlaceholder: '新分支名，例如 feature/panel',
      create: '创建',
      commitPlaceholder: '提交信息（Ctrl+Enter 提交）',
      stageAll: '全部暂存',
      amend: '修改上次提交',
      markResolved: '标记为已解决',
      conflictBlockHint: '有未解决的冲突——解决后逐档标记。',
      abortMerge: '中止合并',
      mergeAbortConfirm: '中止这次合并？工作区会回到合并前的状态。',
      stagedCount: '项已暂存',
      changesCount: '项未暂存',
      commit: '提交',
      commitHint: '提交已暂存的更改',
      unstageAll: '全部取消暂存',
      stageAllFiles: '全部暂存',
      unstage: '取消暂存',
      stage: '暂存',
      discard: '放弃更改',
      delete: '删除文件',
      discardConfirm: '放弃对 {file} 的更改？此操作不可撤销。',
      deleteConfirm: '删除未跟踪的文件 {file}？此操作不可撤销。',
      discarded: '已放弃更改',
      deleted: '已删除文件',
      status: '状态',
      loadingDiff: '正在读取差异…',
      binaryDiff: '二进制文件，无法显示差异。',
      diffUnmerged: '这个文件有未解决的冲突——先解决，再标记为已解决。',
      emptyDiff: '没有文本差异。',
      githubLoading: '正在检查 GitHub 远端…',
      retryGithub: '重新检查',
      loadReposFailed: '读不到工作区列表——可能是宿主端还没准备好。',
      noGithubRemote: '当前仓库没有 GitHub 远端（origin）。',
      stars: '星标',
      forks: '复刻',
      openIssues: '未关闭议题',
      openOnGithub: '在 GitHub 打开',
      newPull: '新建 PR',
      pullTitleDefault: '更新',
      connectGithub: '连接 GitHub',
      tokenHint: '需要一个 GitHub 个人访问令牌（classic 或 fine-grained）来读取议题与创建 PR。令牌只保存在这个浏览器里。',
      save: '保存',
      createToken: '创建令牌',
      tokenScope: 'classic 令牌需要 repo 权限；fine-grained 令牌需要目标仓库的 Contents 与 Pull requests 读写权限。推送本身走你本机 git 的凭据（SSH 或 credential manager），与这里的令牌无关。',
      pulls: '拉取请求',
      issues: '议题',
      noPulls: '没有打开的拉取请求。',
      noIssues: '没有打开的议题。',
      draft: '草稿',
      pullTitle: '标题',
      pullBody: '说明（可选）',
      baseBranch: '目标分支',
      cancel: '取消',
      createPull: '创建',
      worktrees: '工作樹',
      worktreeMain: '主',
      worktreeClean: 'clean',
      worktreeSwitch: '把面板切到此工作樹',
      worktreeOpen: '在 DSH 開成工作區',
      worktreeRemove: '移除工作樹',
      worktreeNew: '新增工作樹',
      worktreePrune: '清理失效記錄（git worktree prune）',
      worktreeNamePlaceholder: '名稱，例如 fix-ui',
      worktreeLayoutHint: '會建立在 .agents/worktrees/<名稱>，分支 worktree-<名稱>',
      worktreeBranchPreview: '將建立',
      worktreeRemoveConfirm: '移除工作樹 {path}？裡面未提交的內容會一併消失。',
      worktreeNone: '目前只有這一個工作樹。',
      worktreeStale: '宿主端還是舊版（沒有工作樹 API）。關視窗不會結束背景程序——請從選單或托盤「完全結束」DSH Desktop 再開。',
      openDiffHint: '開啟這個檔案的差異',
      diffBack: '返回',
      diffBackHint: '關閉差異檢視（Esc）',
      diffPrev: '上一個檔案',
      diffNext: '下一個檔案',
      diffSplit: '並排',
      diffUnified: '統一',
      diffFullFile: '全文',
      diffOnlyChanges: '僅變更',
      diffContextHint: '切換顯示範圍（全文／僅變更）',
      diffShowStaged: '看已暫存',
      diffShowWorktree: '看工作區',
      diffStagedBadge: '已暫存',
      diffWorktreeBadge: '未暫存',
      diffNothingOpen: '從右側的變更清單點一個檔案。',
      diffTabTitle: '檔案差異',
      commitDiffTabTitle: '提交差異',
      openCommitDiffHint: '開啟這次提交的變更',
      commitDiffLoading: '正在讀取這次提交的變更…',
      commitDiffEmpty: '這次提交沒有檔案變更。',
      commitDiffBinaryBadge: '二進位',
      commitDiffBinary: '二進位檔，不顯示差異。',
      commitDiffNoText: '沒有文字差異。',
      commitDiffFileCount: '{files} 個檔案',
      commitDiffMergeBadge: '合併',
      commitDiffExpandAll: '展開全部',
      commitDiffCollapseAll: '收合全部',
      commitDiffTruncated: '共 {total} 個檔案，這裡只載入前 {shown} 個的差異。',
      commitDiffRetry: '重試',
      hoverLoading: '讀取中…',
      hoverStatFiles: '{files} 個檔案變更',
      hoverStatAdditions: '{additions} 行插入(+)',
      hoverStatDeletions: '{deletions} 行刪除(-)',
      hoverStatSeparator: '，',
      hoverNoBranch: '這個分支還沒有提交。',
      refHead: '目前檢出（本機）',
      refLocal: '本機分支',
      refRemote: '遠端分支',
      refTag: '標籤',
      refDetached: '分離 HEAD',
      collapseGroup: '收合這一組',
      expandGroup: '展開這一組',
    }
    
    /** English copy. */
    const en = {
      panelTitle: 'Source Control',
      guideDescription: 'Stage, commit, branch and sync',
      noRepo: 'No repository selected',
      switchRepo: 'Switch repository',
      refresh: 'Refresh',
      loadRepos: 'Re-read workspaces',
      notARepoShort: 'no repo',
      dismiss: 'Dismiss',
      loading: 'Reading…',
      pickWorkspace: 'Pick a workspace to start tracking its history.',
      notARepo: 'This directory is not a Git repository yet.',
      initRepo: 'Initialise repository',
      initHint: 'Runs git init here. No commit is created.',
      staged: 'Staged changes',
      changes: 'Changes',
      noChanges: 'No unstaged changes.',
      conflicts: 'Conflicts',
      history: 'Recent commits',
      showMore: 'Show all',
      showLess: 'Show fewer',
      noCommits: 'No commits yet.',
      branch: 'Current branch',
      detached: 'detached HEAD',
      switchBranch: 'Switch branch',
      notPublished: 'not published to a remote',
      fetch: 'Fetch',
      fetchHint: 'git fetch --prune origin',
      pull: 'Pull',
      pullHint: 'git pull --ff-only (fast-forward only)',
      push: 'Push',
      pushHint: 'The first push publishes the branch and sets its upstream',
      newBranch: 'New branch',
      newBranchPlaceholder: 'new branch, e.g. feature/panel',
      create: 'Create',
      commitPlaceholder: 'Commit message (Ctrl+Enter to commit)',
      stageAll: 'Stage all',
      amend: 'Amend last commit',
      markResolved: 'Mark resolved',
      conflictBlockHint: 'Unresolved conflicts — resolve, then mark each file.',
      abortMerge: 'Abort merge',
      mergeAbortConfirm: 'Abort this merge? The working tree goes back to how it was before.',
      stagedCount: 'staged',
      changesCount: 'unstaged',
      commit: 'Commit',
      commitHint: 'Commit the staged changes',
      unstageAll: 'Unstage all',
      stageAllFiles: 'Stage all files',
      unstage: 'Unstage',
      stage: 'Stage',
      discard: 'Discard changes',
      delete: 'Delete file',
      discardConfirm: 'Discard changes in {file}? This cannot be undone.',
      deleteConfirm: 'Delete the untracked file {file}? This cannot be undone.',
      discarded: 'Changes discarded',
      deleted: 'File deleted',
      status: 'Status',
      loadingDiff: 'Reading the diff…',
      binaryDiff: 'Binary file; no textual diff.',
      diffUnmerged: 'This file still has unresolved conflicts — resolve them, then mark it resolved.',
      emptyDiff: 'No textual difference.',
      githubLoading: 'Looking for a GitHub remote…',
      retryGithub: 'Check again',
      loadReposFailed: 'Could not read the workspace list — the host may not be ready yet.',
      noGithubRemote: 'This repository has no GitHub remote (origin).',
      stars: 'Stars',
      forks: 'Forks',
      openIssues: 'Open issues',
      openOnGithub: 'Open on GitHub',
      newPull: 'New pull request',
      pullTitleDefault: 'Update',
      connectGithub: 'Connect GitHub',
      tokenHint: 'A GitHub personal access token (classic or fine-grained) is needed to read issues and open pull requests. It is stored in this browser only.',
      save: 'Save',
      createToken: 'Create token',
      tokenScope: 'A classic token needs the repo scope; a fine-grained token needs Contents and Pull requests read/write on the target repository. Pushing itself uses your machine’s own git credentials (SSH or credential manager), not this token.',
      pulls: 'Pull requests',
      issues: 'Issues',
      noPulls: 'No open pull requests.',
      noIssues: 'No open issues.',
      draft: 'draft',
      pullTitle: 'Title',
      pullBody: 'Description (optional)',
      baseBranch: 'base branch',
      cancel: 'Cancel',
      createPull: 'Create',
      worktrees: 'Worktrees',
      worktreeMain: 'main',
      worktreeClean: 'clean',
      worktreeSwitch: 'Point the panel at this worktree',
      worktreeOpen: 'Open as a DSH workspace',
      worktreeRemove: 'Remove worktree',
      worktreeNew: 'New worktree',
      worktreePrune: 'Prune stale records',
      worktreeNamePlaceholder: 'name, e.g. fix-ui',
      worktreeLayoutHint: 'Created at .agents/worktrees/<name> on branch worktree-<name>',
      worktreeBranchPreview: 'Will create',
      worktreeRemoveConfirm: 'Remove worktree {path}? Uncommitted work inside it is lost.',
      worktreeNone: 'This is the only worktree.',
      worktreeStale: 'The host is still the older build (no worktree API). Closing the window keeps the background process alive — fully quit DSH Desktop and relaunch.',
      openDiffHint: 'Open this file’s diff',
      diffBack: 'Back',
      diffBackHint: 'Close the diff view (Esc)',
      diffPrev: 'Previous file',
      diffNext: 'Next file',
      diffSplit: 'Split',
      diffUnified: 'Unified',
      diffFullFile: 'Whole file',
      diffOnlyChanges: 'Changes only',
      diffContextHint: 'Toggle how much context the diff carries',
      diffShowStaged: 'Show staged',
      diffShowWorktree: 'Show working tree',
      diffStagedBadge: 'staged',
      diffWorktreeBadge: 'working tree',
      diffNothingOpen: 'Pick a file in the change list on the right.',
      diffTabTitle: 'File diff',
      commitDiffTabTitle: 'Commit diff',
      openCommitDiffHint: 'Open this commit’s changes',
      commitDiffLoading: 'Reading this commit’s changes…',
      commitDiffEmpty: 'This commit changed no files.',
      commitDiffBinaryBadge: 'binary',
      commitDiffBinary: 'Binary file; no textual diff.',
      commitDiffNoText: 'No textual difference.',
      commitDiffFileCount: '{files} files',
      commitDiffMergeBadge: 'merge',
      commitDiffExpandAll: 'Expand all',
      commitDiffCollapseAll: 'Collapse all',
      commitDiffTruncated: '{total} files in all; the diffs for the first {shown} are shown here.',
      commitDiffRetry: 'Retry',
      hoverLoading: 'Reading…',
      hoverStatFiles: '{files} files changed',
      hoverStatAdditions: '{additions} insertions(+)',
      hoverStatDeletions: '{deletions} deletions(-)',
      hoverStatSeparator: ', ',
      hoverNoBranch: 'This branch has no commits yet.',
      refHead: 'checked out here',
      refLocal: 'local branch',
      refRemote: 'remote branch',
      refTag: 'tag',
      refDetached: 'detached HEAD',
      collapseGroup: 'Collapse this group',
      expandGroup: 'Expand this group',
    }
    
    /**
     * The diff tab's body.
     *
     * The file to show arrives as the tab's navigation parameters — `openTab(kind,
     * { params })` records them, and `useTabNavigation` is this seat's hook onto
     * that record, so re-opening the tab for another file only bumps `revision`.
     *
     * @param props - session-scoped slot props plus `useTabNavigation` and `t`.
     * @returns the boundary element wrapping the diff.
     */
    function DiffTabBody(props) {
      return h(PanelBoundary, { ...props, compact: true, seat: 'diff' })
    }
    
    /**
     * The diff seat inside the boundary: reads the tab's navigation parameters and
     * keeps the diff store pointed at them.
     *
     * Reading `useTabInfo` here rather than in `DiffTabBody` keeps a throw from the
     * column (a tab that is not committed yet) inside the crash boundary, where it
     * costs one error card instead of the whole tab strip.
     *
     * @param props - slot props plus `useTabInfo`, `actions` and `t`.
     * @returns the diff panel.
     */
    function DiffPanelSeat(props) {
      const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
      const info = useInfo()
      const navigation = info?.tab?.navigation ?? null
      const params = navigation?.params ?? null
      const revision = navigation?.revision ?? 0
    
      useEffect(() => {
        if (params !== null && typeof params.file === 'string' && typeof params.path === 'string') openDiff(params)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the
        // signal that the opener asked for this file, even when it is the same one.
      }, [revision])
    
      const close = () => {
        if (typeof props.actions?.close === 'function') props.actions.close()
        else closeDiff()
      }
    
      return h(DiffPanel, { ...props, compact: true, onClose: close })
    }
    
    /**
     * The diff tab's chip: the file name, so a strip of tabs says which is which.
     * @param props - slot props plus `useTabNavigation` and `t`.
     * @returns the title element.
     */
    function DiffTabTitle(props) {
      const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
      const info = useInfo()
      const params = info?.tab?.navigation?.params ?? null
      const t = typeof props?.t === 'function' ? props.t : tr
      const file = typeof params?.file === 'string' ? params.file : t('diffTabTitle')
      const slash = file.lastIndexOf('/')
      return h(
        'span',
        { className: 'gmg-difftabtitle' },
        h(IconChevronRight, { size: 11 }),
        h('span', { className: 'gmg-difftabname', title: file }, slash === -1 ? file : file.slice(slash + 1)),
        params?.staged === true ? h('span', { className: 'gmg-gh-label' }, t('diffStagedBadge')) : null,
      )
    }
    /**
     * The commit tab's body, inside the crash boundary.
     * @param props - slot props.
     * @returns the boundary element.
     */
    function CommitTabBody(props) {
      return h(PanelBoundary, { ...props, compact: true, seat: 'commit' })
    }
    
    /**
     * The commit seat: reads the tab's own parameters and keeps its cached view
     * pointed at them.
     *
     * Each commit tab is an independent occurrence (`multiple: true`), so this hook
     * is what gives every tab its own commit: the params arrive per tab, the cache
     * is keyed by them, and a re-navigation of the same tab only bumps `revision`.
     *
     * @param props - slot props plus `useTabInfo`, `actions` and `t`.
     * @returns the commit panel.
     */
    function CommitPanelSeat(props) {
      const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
      const info = useInfo()
      const navigation = info?.tab?.navigation ?? null
      const params = navigation?.params ?? null
      const revision = navigation?.revision ?? 0
      const path = typeof params?.path === 'string' ? params.path : null
      const sha = typeof params?.sha === 'string' ? params.sha : null
      const key = path === null || sha === null ? null : commitViewKey(path, sha)
      const view = useCommitView(key)
    
      useEffect(() => {
        if (path !== null && sha !== null) loadCommitDiff({ path, sha })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the
        // signal that the opener asked for this commit, even when it is the same one.
      }, [revision, key])
    
      // A cache that dropped this entry (it was the oldest) is re-read rather than
      // leaving an empty tab behind.
      useEffect(() => {
        if (path !== null && sha !== null && view === null) loadCommitDiff({ path, sha })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key, view === null])
    
      const close = () => {
        if (typeof props.actions?.close === 'function') props.actions.close()
      }
      const retry = () => {
        if (path !== null && sha !== null) loadCommitDiff({ path, sha })
      }
    
      return h(CommitDiffPanel, { ...props, params, view, onClose: close, onRetry: retry })
    }
    
    /**
     * The tab body wrapped in the crash boundary, told it lives in a narrow column.
     * @param props - session-scoped slot props.
     * @returns the boundary element.
     */
    function GitTabBody(props) {
      return h(PanelBoundary, { ...props, compact: true, seat: 'list' })
    }
    
    /**
     * Error boundary: a crash inside the panel renders one readable line instead
     * of taking the whole main column down with it.
     */
    class PanelBoundary extends react.Component {
      /** @param props - slot props. */
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
    
      /**
       * Capture a render failure.
       * @param error - the thrown value.
       * @returns the next state.
       */
      static getDerivedStateFromError(error) {
        return { error }
      }
    
      /**
       * Log the failure once, so the console names the plugin.
       * @param error - the thrown value.
       */
      componentDidCatch(error) {
        console.error('[dsh-git-management] panel crashed:', error)
      }
    
      /**
       * Render the panel, or the failure line.
       * @returns the element.
       */
      render() {
        if (this.state.error !== null) {
          return h(
            'div',
            { className: 'gmg-root' },
            h(
              'div',
              { className: 'gmg-page' },
              h(
                'div',
                { className: 'gmg-notice is-error' },
                h('span', null, `Source Control failed to render: ${String(this.state.error?.message ?? this.state.error)}`),
              ),
            ),
          )
        }
        const Comp = this.props.seat === 'diff' ? DiffPanelSeat : this.props.seat === 'commit' ? CommitPanelSeat : GitPanel
        return h(Comp, this.props)
      }
    }
    
    /**
     * Cordis plugin body: dictionaries, styles, a right-column tab type, and the
     * two slots that type needs.
     *
     * The right column is a tabbed pane (`ui-sidebar-right`), not a list of
     * panels: a tab is declared once through `sidebarRightTabs.register`, which
     * also owns the card that appears on the column's start page beside Files and
     * New terminal, and twice through slots (body + chip title), keyed by the same
     * tab id.
     *
     * @param ctx - the client plugin context.
     */
    exports.apply = function apply(ctx) {
      // One inject for the services this plugin cannot work without: a throw here
      // would take the whole web boot down, so the wiring is also contained.
      ctx.inject(['slots', 'locale', 'sidebarRightTabs'], (scoped) => {
        try {
          scoped.effect(() => scoped.locale.register(NS, { zh, en }), 'dsh-git-management: dictionaries')
    
          const t = scoped.locale.bind(NS)
          // Components read copy through this binding; the registrations below also
          // hand `t` in as a prop, and either path resolves to the same dictionary.
          gmgTranslate = t
    
          scoped.effect(() => installPanelStyles(), 'dsh-git-management: panel styles')
    
          // The tab type: `title` is the tab strip's chip text, `guide` is the one
          // card this plugin contributes to the column's start page.
          scoped.effect(
            () =>
              scoped.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: () => t('panelTitle'),
                guide: [
                  {
                    id: 'source-control',
                    order: 30,
                    title: () => t('panelTitle'),
                    description: () => t('guideDescription'),
                    icon: IconBranch,
                  },
                ],
              }),
            'dsh-git-management: source control tab type',
          )
    
          // Both seats wait on `slots.inject`: a slot is only registerable once its
          // declaring entry has run.
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                locale: NS,
                inject: () => ({ t, lang: scoped.locale.getLocale().active }),
              },
              GitTabBody,
            ),
          )
    
          scoped.slots.inject('sidebar.right.pane.tab.title', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: TAB_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              GitTabTitle,
            ),
          )
    
          // The second type: one file's diff as its own tab. No guide entry — this
          // tab is only ever reached from a row in the list, never from the start
          // page. It is not `multiple`, so the column dedupes it: a second click
          // re-navigates the same tab instead of piling up one tab per file.
          scoped.effect(
            () =>
              scoped.sidebarRightTabs.register({
                id: DIFF_TAB_ID,
                kind: DIFF_TAB_KIND,
                priority: 'extension',
                title: () => t('diffTabTitle'),
                guide: [],
              }),
            'dsh-git-management: diff tab type',
          )
    
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: DIFF_TAB_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              DiffTabBody,
            ),
          )
    
          scoped.slots.inject('sidebar.right.pane.tab.title', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: DIFF_TAB_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              DiffTabTitle,
            ),
          )
    
          // The third type: one commit's whole change set. `multiple: true` is the
          // point — every history click is its own tab, so two commits can be read
          // side by side. The column gives each open its own occurrence id, which
          // is also why the body reads the commit from its own navigation params.
          scoped.effect(
            () =>
              scoped.sidebarRightTabs.register({
                id: COMMIT_TAB_ID,
                kind: COMMIT_TAB_KIND,
                priority: 'extension',
                multiple: true,
                title: () => t('commitDiffTabTitle'),
                guide: [],
              }),
            'dsh-git-management: commit diff tab type',
          )
    
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: COMMIT_TAB_ID,
                locale: NS,
                inject: () => ({ t, lang: scoped.locale.getLocale().active }),
              },
              CommitTabBody,
            ),
          )
    
          scoped.slots.inject('sidebar.right.pane.tab.title', () =>
            scoped.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: COMMIT_TAB_ID,
                locale: NS,
                inject: () => ({ t }),
              },
              CommitTabTitle,
            ),
          )
    
          console.log('[dsh-git-management] tabs registered (source control + file diff + commit diff)')
        } catch (error) {
          console.error('[dsh-git-management] mount failed:', error)
        }
      })
    
      // Opening a file's diff is a tab open in the same column: the change list and
      // the conversation both stay exactly where the user left them.
      ctx.inject(['sidebarRight'], (scoped) => {
        gmgSidebarBridge = {
          openDiff: (params) => {
            try {
              scoped.sidebarRight.openTab(DIFF_TAB_KIND, { params })
            } catch (error) {
              console.error('[dsh-git-management] could not open the diff tab:', error)
            }
          },
          openCommit: (params) => {
            try {
              scoped.sidebarRight.openTab(COMMIT_TAB_KIND, { params })
            } catch (error) {
              console.error('[dsh-git-management] could not open the commit tab:', error)
            }
          },
        }
      })
    
      // The worktree rows' "open as a workspace" action: create the workspace
      // (idempotent per canonical path) and hand the user to it. Optional services,
      // so a GUI without them simply renders the action as unavailable.
      ctx.inject(['workspaces', 'uiWorkspace'], (scoped) => {
        gmgWorkspaceBridge = async (path) => {
          const view = await scoped.workspaces.create({ path })
          await scoped.uiWorkspace.openWorkspace(view.id)
          return view
        }
      })
    }

    return module.exports;
  }
});
