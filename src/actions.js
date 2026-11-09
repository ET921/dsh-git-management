/**
 * The action table: one JSON request in, one JSON result out.
 *
 * The browser half never composes a git command. It names an action and passes
 * arguments; this module is the only place that turns those names into argv,
 * which keeps every mutation reviewable in one file and keeps raw shell out of
 * the HTTP surface entirely.
 *
 * Transport (routes, auth, JSON framing) lives in `index.js`; the Git/Cordis
 * seam is injected here so this table is testable on its own.
 *
 * @module dsh-git-management/src/actions
 */

import { access, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { normalizePath } from './git.js'

/** Where DSH's own worktree tool puts a checkout, relative to the repository root. */
const WORKTREE_DIR = '.agents/worktrees'

/** How many checkouts get a dirty count on one read (the rest show `—`). */
const MAX_DIRTY_SCAN = 8

/** How many dirty scans may be in flight at once. */
const DIRTY_CONCURRENCY = 4

/** A worktree name is a single path segment, never a traversal. */
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** GitHub.com's own names; without an explicit API base, only these may receive a token. */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * The name the GitHub token is stored under, in the credentials service and in
 * the environment alike. A CredentialRef is an environment-variable name: the
 * service layers a provider-managed store over the same name `git` and every
 * other tool already reads, so one secret answers both without a rename.
 */
const GITHUB_TOKEN_REF = 'GITHUB_TOKEN'

/** Environment-variable names a GitHub token may also live in, most specific first. */
const GITHUB_TOKEN_ENV = ['GITHUB_TOKEN', 'GH_TOKEN']

/**
 * The host, port and transport named by a git remote URL.
 *
 * A remote URL is repository content, not configuration: a token is a bearer
 * credential for GitHub, so the origin must not be allowed to choose where it
 * is sent. Supports the three shapes git itself accepts: `git@host:owner/repo`,
 * `https://host[:port]/owner/repo`, and `ssh://git@host[:port]/owner/repo`.
 *
 * @param url - the raw remote URL.
 * @returns `{ host, port, protocol }`; every field is null when the URL does not name a host.
 */
function remoteHost(url) {
  const raw = String(url ?? '').trim()
  if (raw === '') return { host: null, port: null, protocol: null }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      return {
        host: parsed.hostname.toLowerCase(),
        port: parsed.port === '' ? null : parsed.port,
        protocol: parsed.protocol.toLowerCase(),
      }
    } catch {
      return { host: null, port: null, protocol: null }
    }
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw)
  if (scp) return { host: scp[1].toLowerCase(), port: null, protocol: 'ssh:' }
  return { host: null, port: null, protocol: null }
}

/**
 * The HTTP port a base URL names, falling back to the scheme's default.
 * @param protocol - `https:` or `http:`.
 * @param port - an explicit port, or the empty string.
 * @returns the port as a string.
 */
function httpPort(protocol, port) {
  if (port !== '') return port
  return protocol === 'http:' ? '80' : '443'
}

/**
 * Where GitHub calls for one remote may go, and whether a token may ride along.
 *
 * `GITHUB_API_URL` is operator configuration: a GHES install names its API base
 * there. Without it, only github.com is GitHub. Every other origin is some
 * other service (GitLab, Gitea, a company server, an attacker's domain), and a
 * PAT must never be sent to it — the remote host is repository content, so it
 * never chooses the destination by itself.
 *
 * When `GITHUB_API_URL` is set, its host must agree with the remote's host. A
 * remote reached over HTTP(S) also pins the port its host is served on; SSH
 * remotes are compared by host only, because their port is not the API port.
 *
 * @param remote - the parsed remote from `git.remote()`.
 * @returns `{ base }`, or null when a token must not be sent to this remote.
 */
function githubTarget(remote) {
  const origin = remoteHost(remote?.remoteUrl)
  const name = origin.host ?? String(remote?.host ?? '').toLowerCase()
  if (name === '') return null
  const configured = process.env.GITHUB_API_URL
  if (typeof configured === 'string' && configured.trim() !== '') {
    const base = configured.trim().replace(/\/+$/, '')
    let api = null
    try {
      api = new URL(base)
    } catch {
      return null
    }
    if (api.protocol !== 'http:' && api.protocol !== 'https:') return null
    const apiName = api.hostname.toLowerCase()
    const sameGithub = GITHUB_HOSTS.has(name) && (GITHUB_HOSTS.has(apiName) || apiName === 'api.github.com')
    if (sameGithub) return { base }
    if (apiName !== name) return null
    if (origin.protocol === 'http:' || origin.protocol === 'https:') {
      if (httpPort(origin.protocol, origin.port ?? '') !== httpPort(api.protocol, api.port)) return null
    }
    return { base }
  }
  if (GITHUB_HOSTS.has(name)) return { base: 'https://api.github.com' }
  return null
}

/**
 * One GitHub REST call.
 * @param token - bearer token.
 * @param path - API path beginning with `/`.
 * @param init - fetch init overrides.
 * @param target - `{ base }` from `githubTarget`; never a raw remote host.
 * @returns parsed JSON body.
 */
async function github(token, path, init = {}, target) {
  const response = await fetch(`${target.base}${path}`, {
    ...init,
    // A GitHub call that never answers must not leave the panel spinning
    // forever; the route maps the abort to a 504 with code `timeout`.
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-git-management',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  }).catch((error) => {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeout = new Error('GitHub request timed out')
      timeout.status = 504
      timeout.code = 'timeout'
      throw timeout
    }
    const failure = new Error(String(error?.message ?? error))
    failure.status = 502
    failure.code = 'github-error'
    throw failure
  })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { message: text }
  }
  if (!response.ok) {
    const reason = body?.message ?? `GitHub responded ${response.status}`
    const error = new Error(String(reason))
    error.status = response.status
    error.code = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate-limit' : 'github-error'
    error.github = body
    throw error
  }
  return body
}

/** GitHub logins already resolved from an author email, keyed by lower-case address. */
const emailLogins = new Map()

/**
 * The GitHub account behind one author email.
 *
 * The commit endpoint cannot answer for a sha that has not been pushed yet,
 * but the address can: this checkout's own `user.email` maps to the account
 * behind the token, and GitHub's commit search names whoever has pushed with
 * any other address. A commit's email is written at commit time, so the card
 * has an account to show straight away instead of waiting for a push.
 *
 * A lookup that fails is not an error: the card falls back to git's name, and
 * nothing is cached for that address so the next hover retries.
 *
 * @param token - bearer token.
 * @param email - the commit's author email.
 * @param own - whether that address is this checkout's `user.email`.
 * @param target - `{ base }` from `githubTarget`, for the remote's GitHub API.
 * @returns the login, or null when no account matches.
 */
async function loginForEmail(token, email, own, target) {
  const key = String(email ?? '').trim().toLowerCase()
  if (key === '') return null
  if (emailLogins.has(key)) return emailLogins.get(key)
  let login = null
  try {
    if (own) {
      const viewer = await github(token, '/user', {}, target)
      login = viewer?.login ?? null
    } else {
      const found = await github(token, `/search/commits?q=${encodeURIComponent(`author-email:${key}`)}&per_page=1`, {}, target)
      login = found?.items?.[0]?.author?.login ?? null
    }
  } catch {
    login = null
  }
  if (login !== null) emailLogins.set(key, login)
  return login
}

/**
 * Build the action table.
 *
 * @param options - `{ git, workspaces, credentials }`, where `workspaces()`
 *   returns `[{ id, title, path }]`, `git` is `createGit(exec)`, and
 *   `credentials()` lazily returns the host credentials service (or
 *   undefined when the host has none).
 * @returns `{ handle(action, params) }`.
 */
export function createActions({ git, workspaces, credentials = () => undefined }) {
  /**
   * The panel's repo picker: every workspace, annotated with whether it is a
   * repository and which branch it is on.
   * @returns `{ repos, defaultPath }`.
   */
  async function repos() {
    let listed = []
    try {
      listed = (await workspaces()) ?? []
    } catch {
      listed = []
    }
    const rows = await Promise.all(
      listed.map(async (workspace) => {
        const probed = await git.probe(workspace.path).catch(() => ({ isRepo: false }))
        let branch = null
        if (probed.isRepo) {
          const snapshot = await git.status(workspace.path).catch(() => null)
          branch = snapshot?.branch ?? null
        }
        return {
          id: String(workspace.id ?? workspace.path),
          title: workspace.title ?? workspace.path,
          path: workspace.path,
          isRepo: Boolean(probed.isRepo),
          root: probed.root ?? null,
          bare: Boolean(probed.bare),
          branch,
        }
      }),
    )
    const preferred = rows.find((row) => row.isRepo) ?? rows[0] ?? null
    return { repos: rows, defaultPath: preferred?.path ?? null }
  }

  /**
   * Every checkout of the repository, with a bounded dirty count per row.
   *
   * The dirty scan is a separate `git status` per worktree, so it is capped:
   * eight rows, four at a time. Rows past the cap still render, with `dirty:
   * null`, which the panel shows as "—" rather than a wrong zero.
   *
   * @param path - any directory inside the repository.
   * @returns `{ isRepo, root, rootKey, worktrees, truncated }`.
   */
  async function worktrees(path) {
    const listing = await git.worktrees(path)
    if (!listing.isRepo) return { isRepo: false, root: null, rootKey: null, worktrees: [], truncated: false }
    const rows = listing.worktrees.map((row) => ({ ...row, dirty: null, dirtyKnown: false }))
    const scanned = rows.slice(0, MAX_DIRTY_SCAN)
    for (let index = 0; index < scanned.length; index += DIRTY_CONCURRENCY) {
      const batch = scanned.slice(index, index + DIRTY_CONCURRENCY)
      const counts = await Promise.all(batch.map((row) => git.dirtyCount(row.path).catch(() => null)))
      batch.forEach((row, offset) => {
        row.dirty = counts[offset]
        row.dirtyKnown = counts[offset] !== null
      })
    }
    return {
      isRepo: true,
      root: listing.root,
      rootKey: listing.rootKey,
      worktrees: rows,
      truncated: rows.length > scanned.length,
    }
  }

  /**
   * Create a worktree on a new branch, under the same layout DSH's own tool uses.
   * @param path - any directory inside the repository.
   * @param name - the worktree's name, one path segment.
   * @returns `{ path, branch, worktrees }`.
   */
  async function createWorktree(path, name) {
    const requested = String(name ?? '').trim()
    if (!WORKTREE_NAME.test(requested)) {
      throw new Error('名稱只能含英數、點、底線、連字號（1–64 字元） / name must be 1–64 of A-Z a-z 0-9 . _ -')
    }
    const listing = await git.worktrees(path)
    if (!listing.isRepo) throw new Error('not a git repository')
    const root = String(listing.root).replace(/\\/g, '/')
    const parent = `${root}/${WORKTREE_DIR}`
    const destination = `${parent}/${requested}`
    const branch = `worktree-${requested}`
    await mkdir(parent, { recursive: true })
    // A self-ignoring directory, exactly like DSH's own worktree tool, so the
    // checkouts never surface as untracked files in the main working tree.
    await writeFile(join(parent, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => {})
    const created = await git.addWorktree(listing.root, { path: destination, branch })
    const refreshed = await worktrees(path)
    return { ...created, worktrees: refreshed.worktrees }
  }

  /**
   * Remove one worktree directory, refusing the main one and the one in use.
   * @param path - any directory inside the repository.
   * @param target - the worktree to remove.
   * @returns `{ summary, worktrees }`.
   */
  async function removeWorktree(path, target) {
    const listing = await git.worktrees(path)
    if (!listing.isRepo) throw new Error('not a git repository')
    const key = normalizePath(target)
    const row = listing.worktrees.find((entry) => entry.key === key)
    if (row === undefined) throw new Error('該路徑不是這個 repo 的工作樹 / not a worktree of this repository')
    if (row.main === true) throw new Error('不能移除主工作樹 / the main working tree cannot be removed')
    if (row.key === normalizePath(path)) throw new Error('面板目前就在這個工作樹裡，先切換再移除 / the panel is using this worktree')
    const removed = await git.removeWorktree(listing.root, row.path)
    const refreshed = await worktrees(path)
    return { ...removed, worktrees: refreshed.worktrees }
  }

  /**
   * Drop records whose directory is gone.
   * @param path - any directory inside the repository.
   * @returns `{ summary, worktrees }`.
   */
  async function pruneWorktrees(path) {
    const listing = await git.worktrees(path)
    if (!listing.isRepo) throw new Error('not a git repository')
    const pruned = await git.pruneWorktrees(listing.root)
    const refreshed = await worktrees(path)
    return { ...pruned, worktrees: refreshed.worktrees }
  }

  /** Actions that write the index or worktree; all are refused in a bare repo. */
  const WRITE_ACTIONS = new Set(['stage', 'unstage', 'discard', 'deleteUntracked', 'commit', 'switch', 'pull', 'push', 'stash', 'abortMerge', 'init'])

  /**
   * One malformed argument.
   * @param message - the reason.
   * @returns the error the route turns into a 400.
   */
  function argumentError(message) {
    const error = new Error(message)
    error.status = 400
    error.code = 'invalid-argument'
    return error
  }

  /**
   * One state precondition failure (409).
   * @param message - the reason.
   * @param code - the stable code.
   * @returns the error.
   */
  function stateError(message, code) {
    const error = new Error(message)
    error.status = 409
    error.code = code
    return error
  }

  /**
   * Which git operation is in progress, from the sentinel files in the git dir.
   *
   * `rebase-merge` and `rebase-apply` are the two rebase backends and both mean
   * "rebase"; the client only needs to know it cannot offer `merge --abort`.
   *
   * @param gitDir - absolute git directory from `git.status`.
   * @returns `'merge' | 'rebase' | 'cherry-pick' | null`.
   */
  async function operationKind(gitDir) {
    if (typeof gitDir !== 'string' || gitDir === '') return null
    const has = (name) => access(join(gitDir, name)).then(() => true, () => false)
    if (await has('MERGE_HEAD')) return 'merge'
    if ((await has('rebase-merge')) || (await has('rebase-apply'))) return 'rebase'
    if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick'
    return null
  }

  /**
   * Refuse a write action in a bare repository.
   * @param path - repository directory.
   */
  async function requireWritableWorktree(path) {
    const probed = await git.probe(path).catch(() => ({ isRepo: false, bare: false }))
    if (probed.isRepo && probed.bare) {
      throw stateError('bare repository: read-only / bare 倉庫沒有工作樹，無法寫入', 'bare-readonly')
    }
  }

  /**
   * Refuse a commit while conflicts or another operation are in progress.
   * @param path - repository directory.
   * @returns the status snapshot when the commit may proceed.
   */
  async function requireCommitState(path) {
    const snapshot = await git.status(path)
    if (snapshot.bare) throw stateError('bare repository: read-only / bare 倉庫沒有工作樹，無法提交', 'bare-readonly')
    const operation = await operationKind(snapshot.gitDir)
    // A rebase is finished with `git rebase --continue`, not `git commit`, so
    // it is reported even while conflicts exist. A merge is different: once
    // the conflicts are staged, `git commit` is exactly how the merge is
    // completed, so MERGE_HEAD alone must not block it.
    if (operation === 'rebase' || operation === 'cherry-pick') {
      throw stateError(`${operation} in progress: finish or abort it before committing / ${operation} 進行中，請先完成或中止`, 'operation-in-progress')
    }
    if (snapshot.conflicts.length > 0) {
      throw stateError('還有未解決的衝突 / there are unresolved conflicts', 'unresolved-conflicts')
    }
    if (operation === 'merge') return snapshot
    if (operation !== null) {
      throw stateError(`${operation} in progress: finish or abort it before committing / ${operation} 進行中，請先完成或中止`, 'operation-in-progress')
    }
    return snapshot
  }

  /**
   * The narrow stash surface: push the working tree, pop the latest entry, or
   * count what is held. Selecting files and listing named entries are out of
   * scope; a pop conflict is a state, not a failure.
   * @param path - repository directory.
   * @param params - `{ op, message? }`.
   * @returns the stash result.
   */
  async function stashAction(path, params) {
    const op = String(params.op ?? '')
    if (['push', 'pop', 'count'].includes(op) === false) throw argumentError(`unknown stash operation: ${op}`)
    const snapshot = await git.status(path)
    if (snapshot.isRepo !== true) {
      const error = new Error('not a git repository')
      error.status = 400
      error.code = 'not-repo'
      throw error
    }
    if (snapshot.bare) throw stateError('bare repository: read-only / bare 倉庫沒有工作樹，無法 stash', 'bare-readonly')
    if (op !== 'count') {
      const operation = await operationKind(snapshot.gitDir)
      if (operation !== null) throw stateError(`${operation} in progress: finish or abort it before stashing / ${operation} 進行中，請先完成或中止`, 'operation-in-progress')
    }
    if (op === 'count') return { op: 'count', count: await git.stashCount(path) }
    if (op === 'push') {
      const pushed = await git.stashPush(path, params.message)
      return { op: 'push', stashed: pushed.stashed, summary: pushed.summary, count: await git.stashCount(path) }
    }
    const popped = await git.stashPop(path)
    return { op: 'pop', summary: popped.summary, count: await git.stashCount(path), conflicts: popped.conflicts }
  }

  /**
   * Dispatch one named action.
   * @param action - the action name.
   * @param params - action arguments.
   * @returns the JSON result.
   */
  async function handle(action, params = {}) {
    const path = typeof params.path === 'string' ? params.path : ''
    if (WRITE_ACTIONS.has(action)) await requireWritableWorktree(path)
    switch (action) {
      case 'repos':
        return repos()
      case 'worktrees':
        return worktrees(path)
      case 'createWorktree':
        return createWorktree(path, params.name)
      case 'removeWorktree':
        return removeWorktree(path, String(params.target ?? ''))
      case 'pruneWorktrees':
        return pruneWorktrees(path)
      case 'status': {
        const snapshot = await git.status(path)
        return { ...snapshot, operation: await operationKind(snapshot.gitDir) }
      }
      case 'diff':
        return git.diff(path, await requireFileInsideRepo(path, params.file), Boolean(params.staged), params.context === 'full' ? 'full' : 'hunks')
      case 'stagedPatch':
        return { patch: await git.stagedPatch(path) }
      case 'stage':
        return git.stage(path, requireFiles(params))
      case 'unstage':
        return git.unstage(path, requireFiles(params))
      case 'discard':
        return git.discard(path, requireFiles(params))
      case 'deleteUntracked':
        return git.removeUntracked(path, requireFiles(params))
      case 'commit':
        await requireCommitState(path)
        return git.commit(path, {
          message: String(params.message ?? ''),
          amend: Boolean(params.amend),
          stageAll: Boolean(params.stageAll),
        })
      case 'log': {
        const requested = Number(params.limit ?? 30)
        const limit = Number.isFinite(requested) ? requested : 30
        return { commits: await git.log(path, limit, params.scope === 'all' ? 'all' : 'head') }
      }
      case 'commitDetail':
        return git.commitDetail(path, String(params.sha ?? 'HEAD'))
      case 'commitDiff':
        return git.commitDiff(path, String(params.sha ?? ''))
      case 'branchDetail':
        return git.branchDetail(path, String(params.branch ?? ''))
      case 'branches':
        return git.branches(path)
      case 'switch':
        return git.switchBranch(path, String(params.branch ?? ''), Boolean(params.create))
      case 'fetch':
        return git.fetch(path, String(params.remote ?? 'origin'))
      case 'pull': {
        const mode = params.mode === undefined ? 'ff' : String(params.mode)
        if (mode !== 'ff' && mode !== 'merge') throw argumentError(`invalid pull mode: ${mode}`)
        const snapshot = await git.status(path)
        const operation = await operationKind(snapshot.gitDir)
        if (operation !== null) throw stateError(`${operation} in progress: finish or abort it before pulling / ${operation} 進行中，請先完成或中止`, 'operation-in-progress')
        return git.pull(path, mode)
      }
      case 'stash':
        return stashAction(path, params)
      case 'push': {
        const snapshot = await git.status(path)
        return git.push(path, snapshot.branch, snapshot.upstream)
      }
      case 'abortMerge':
        return git.abortMerge(path)
      case 'init':
        return git.init(path)
      case 'github':
        return githubAction(path, params)
      case 'saveToken': {
        const token = typeof params.token === 'string' ? params.token.trim() : ''
        if (token === '') throw argumentError('token is required')
        if (token.length > 1000) throw argumentError('token is too long')
        const store = credentials()
        if (store === undefined || store === null || typeof store.set !== 'function') {
          const error = new Error('credential storage is unavailable on this host')
          error.status = 501
          error.code = 'credential-unavailable'
          throw error
        }
        await store.set(GITHUB_TOKEN_REF, token)
        return { saved: true }
      }
      case 'clearToken': {
        const store = credentials()
        if (store !== undefined && store !== null && typeof store.unset === 'function') {
          await store.unset(GITHUB_TOKEN_REF)
          return { cleared: true }
        }
        return { cleared: false }
      }
      default: {
        const error = new Error(`unknown action: ${action}`)
        error.status = 404
        error.code = 'unknown-action'
        throw error
      }
    }
  }

  /**
   * Whether a value names one path inside the repository.
   *
   * `:(literal)` stops git from treating `[`, `?` and `*` as globs, but it does
   * not stop an absolute path or a `..` segment from naming something outside
   * the checkout. The `diff` action also has a filesystem fallback for
   * untracked files, so this check is what keeps `.git/config` (which can hold
   * a remote URL with credentials) out of the response.
   *
   * @param file - the candidate path.
   * @returns true when it is a relative, non-traversing, non-.git path.
   */
  function isRepoRelativeFile(file) {
    if (typeof file !== 'string' || file.trim() === '' || file.includes('\0')) return false
    const normalized = file.replace(/\\/g, '/')
    if (normalized.startsWith('/')) return false
    if (/^[A-Za-z]:\//.test(normalized)) return false
    const parts = normalized.split('/')
    if (parts.some((part) => part === '..')) return false
    if (parts.some((part) => part.toLowerCase() === '.git')) return false
    return true
  }

  /**
   * Refuse a path that would leave the repository.
   * @param file - the candidate path.
   * @returns the path, unchanged.
   */
  function requireFile(file) {
    if (isRepoRelativeFile(file) === false) {
      const error = new Error(`file must stay inside the repository: ${String(file ?? '')}`)
      error.status = 400
      error.code = 'unsafe-path'
      throw error
    }
    return file
  }

  /**
   * Reject a path whose symlink-resolved location escapes the repository.
   *
   * `isRepoRelativeFile` is a lexical check: `etc/hosts` looks local even when
   * `etc` is a symlink to `/etc`, and `gitdir/config` looks local when
   * `gitdir` points at `.git`. The `diff` action has a filesystem fallback for
   * untracked files, so the real path (and the git dir) are checked before git
   * is allowed to read it.
   *
   * @param path - the repository directory from the request.
   * @param file - the candidate path.
   * @returns the path, unchanged.
   */
  async function requireFileInsideRepo(path, file) {
    const safe = requireFile(file)
    const root = await realpath(path).catch(() => null)
    if (root === null) return safe
    const resolved = await realpath(join(path, safe)).catch(() => null)
    if (resolved === null) return safe
    const rootKey = root.replace(/\\/g, '/')
    const key = resolved.replace(/\\/g, '/')
    const inside = key === rootKey || key.startsWith(`${rootKey}/`)
    const probed = await git.probe(path).catch(() => null)
    const gitDir = typeof probed?.gitDir === 'string' ? await realpath(probed.gitDir).catch(() => null) : null
    const gitKey = gitDir === null ? '' : gitDir.replace(/\\/g, '/')
    const inGitDir = gitKey !== '' && (key === gitKey || key.startsWith(`${gitKey}/`))
    if (inside === false || inGitDir) {
      const error = new Error(`file must stay inside the repository: ${String(file ?? '')}`)
      error.status = 400
      error.code = 'unsafe-path'
      throw error
    }
    return safe
  }

  /**
   * Reject a file operation that named no files, or a path that escapes.
   * @param params - the request parameters.
   * @returns the file list.
   */
  function requireFiles(params) {
    const files = Array.isArray(params.files) ? params.files.filter((file) => typeof file === 'string' && file !== '') : []
    if (files.length === 0) {
      const error = new Error('files is empty')
      error.status = 400
      error.code = 'invalid-argument'
      throw error
    }
    return files.map(requireFile)
  }

  /**
   * Pick the GitHub token: the request's own, else the credentials service,
   * else the host environment's.
   *
   * A CredentialRef is an environment-variable name, so the service layers its
   * provider-managed store over the same name `git` already reads; storing
   * under `GITHUB_TOKEN` answers both without a rename. The service is asked
   * per operation and never cached: that per-operation read is what lets a
   * changed credential reach the very next request without a restart.
   *
   * @param supplied - token from the client (per-request).
   * @returns the token, or null when this host has none.
   */
  async function resolveToken(supplied) {
    if (typeof supplied === 'string' && supplied.trim() !== '') return supplied.trim()
    const store = credentials()
    if (store !== undefined && store !== null && typeof store.resolve === 'function') {
      for (const ref of GITHUB_TOKEN_ENV) {
        try {
          const resolved = await store.resolve(ref)
          const value = resolved?.value
          if (typeof value === 'string' && value.trim() !== '') return value.trim()
        } catch {
          // A failing provider must not hide the environment fallback below.
        }
      }
    }
    for (const ref of GITHUB_TOKEN_ENV) {
      const ambient = process.env[ref]
      if (typeof ambient === 'string' && ambient.trim() !== '') return ambient.trim()
    }
    return null
  }

  /**
   * The GitHub surface: repo facts, open pulls, open issues, and PR creation.
   * @param path - repository directory.
   * @param params - `{ action, token, title, body, base, head, draft }`.
   * @returns the GitHub-shaped result.
   */
  async function githubAction(path, params) {
    const request = String(params.action ?? 'repo')
    const remote = await git.remote(path)
    if (remote === null || remote.slug === null) {
      return { connected: false, reason: 'no-github-remote', remote: null }
    }
    if (request === 'remote') return { connected: true, remote }

    // Decide the token's destination before anything is fetched. A remote on
    // another host is not GitHub, and must never see a GitHub credential.
    const target = githubTarget(remote)
    if (target === null) {
      return { connected: true, remote, authorized: false, reason: 'unsupported-host' }
    }
    const token = await resolveToken(params.token)
    if (token === null) return { connected: true, remote, authorized: false, reason: 'no-token' }

    if (request === 'repo') {
      const info = await github(token, `/repos/${remote.slug}`, {}, target)
      return {
        connected: true,
        authorized: true,
        remote,
        repo: {
          fullName: info.full_name,
          description: info.description,
          private: info.private,
          stars: info.stargazers_count,
          forks: info.forks_count,
          openIssues: info.open_issues_count,
          defaultBranch: info.default_branch,
          htmlUrl: info.html_url,
          pushedAt: info.pushed_at,
          ownerAvatar: info.owner?.avatar_url ?? null,
        },
      }
    }
    if (request === 'commit') {
      const sha = String(params.sha ?? '').trim()
      if (sha === '') throw new Error('sha is required')
      let info = null
      try {
        info = await github(token, `/repos/${remote.slug}/commits/${sha}`, {}, target)
      } catch (error) {
        // 404 is the normal case for a commit that is still local: it also
        // needs a name, and its email is enough to find one.
        if (error?.status !== 404) throw error
      }
      let login = info?.author?.login ?? null
      if (login === null) {
        // Not on GitHub yet, or the address is not linked to the account that
        // committed: resolve the account from the commit's own email instead
        // of waiting for a push.
        const author = await git.commitAuthor(path, sha)
        const email = author?.email ?? ''
        const own = email !== '' && email.toLowerCase() === String((await git.userEmail(path)) ?? '').toLowerCase()
        login = await loginForEmail(token, email, own, target)
      }
      if (info === null) {
        return {
          connected: true,
          authorized: true,
          remote,
          local: true,
          commit: login === null ? null : { sha, login, name: login, avatarUrl: null },
        }
      }
      return {
        connected: true,
        authorized: true,
        remote,
        commit: {
          sha: info.sha,
          // `author` is GitHub's account link; null when the commit email is not
          // on any account, which is why the panel keeps git's name as fallback.
          login,
          name: login ?? info.commit?.author?.name ?? null,
          avatarUrl: info.author?.avatar_url ?? null,
        },
      }
    }
    if (request === 'pulls') {
      const [info, pulls] = await Promise.all([
        github(token, `/repos/${remote.slug}`, {}, target),
        github(token, `/repos/${remote.slug}/pulls?state=open&per_page=20&sort=updated`, {}, target),
      ])
      return {
        connected: true,
        authorized: true,
        remote,
        defaultBranch: info.default_branch,
        pulls: pulls.map((pull) => ({
          number: pull.number,
          title: pull.title,
          url: pull.html_url,
          draft: pull.draft,
          user: pull.user?.login ?? null,
          head: pull.head?.ref ?? null,
          base: pull.base?.ref ?? null,
          updatedAt: pull.updated_at,
          comments: pull.comments,
        })),
      }
    }
    if (request === 'issues') {
      const issues = await github(token, `/repos/${remote.slug}/issues?state=open&per_page=20&sort=updated`, {}, target)
      return {
        connected: true,
        authorized: true,
        remote,
        issues: issues
          .filter((issue) => issue.pull_request === undefined)
          .map((issue) => ({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            user: issue.user?.login ?? null,
            labels: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
            comments: issue.comments,
            updatedAt: issue.updated_at,
          })),
      }
    }
    if (request === 'createPull') {
      const snapshot = await git.status(path)
      const base = String(params.base ?? '').trim() || 'main'
      const head = String(params.head ?? '').trim() || snapshot.branch
      if (head === null) throw new Error('cannot create a pull request from a detached HEAD')
      const created = await github(token, `/repos/${remote.slug}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title: String(params.title ?? '').trim() || `Update from ${head}`,
          head,
          base,
          body: String(params.body ?? ''),
          draft: Boolean(params.draft),
        }),
      }, target)
      return { connected: true, authorized: true, remote, pull: { number: created.number, url: created.html_url } }
    }
    if (request === 'merge') {
      const number = Number(params.number)
      const merged = await github(token, `/repos/${remote.slug}/pulls/${number}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: String(params.method ?? 'merge') }),
      }, target)
      return { connected: true, authorized: true, remote, merged: Boolean(merged.merged), message: merged.message }
    }
    throw new Error(`unknown github action: ${request}`)
  }

  return { handle, repos }
}
