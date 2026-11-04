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

import { mkdir, writeFile } from 'node:fs/promises'
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

/** GitHub's REST API root; `GITHUB_API_URL` (GHES) overrides it. */
function apiBase() {
  const configured = process.env.GITHUB_API_URL
  return typeof configured === 'string' && configured !== '' ? configured.replace(/\/+$/, '') : 'https://api.github.com'
}

/**
 * One GitHub REST call.
 * @param token - bearer token.
 * @param path - API path beginning with `/`.
 * @param init - fetch init overrides.
 * @returns parsed JSON body.
 */
async function github(token, path, init = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-git-management',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
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
    error.github = body
    throw error
  }
  return body
}

/**
 * Pick the GitHub token: the request's own, else the host environment's.
 * @param supplied - token from the client (per-request).
 * @returns the token, or null when this host has none.
 */
function resolveToken(supplied) {
  if (typeof supplied === 'string' && supplied.trim() !== '') return supplied.trim()
  const ambient = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  return typeof ambient === 'string' && ambient.trim() !== '' ? ambient.trim() : null
}

/**
 * Build the action table.
 *
 * @param options - `{ git, workspaces }`, where `workspaces()` returns
 *   `[{ id, title, path }]` and `git` is `createGit(exec)`.
 * @returns `{ handle(action, params) }`.
 */
export function createActions({ git, workspaces }) {
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

  /**
   * Dispatch one named action.
   * @param action - the action name.
   * @param params - action arguments.
   * @returns the JSON result.
   */
  async function handle(action, params = {}) {
    const path = typeof params.path === 'string' ? params.path : ''
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
      case 'status':
        return git.status(path)
      case 'diff':
        return git.diff(path, String(params.file ?? ''), Boolean(params.staged), params.context === 'full' ? 'full' : 'hunks')
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
        return git.commit(path, {
          message: String(params.message ?? ''),
          amend: Boolean(params.amend),
          stageAll: Boolean(params.stageAll),
        })
      case 'log':
        return { commits: await git.log(path, Number(params.limit ?? 30)) }
      case 'commitDetail':
        return git.commitDetail(path, String(params.sha ?? 'HEAD'))
      case 'branchDetail':
        return git.branchDetail(path, String(params.branch ?? ''))
      case 'branches':
        return git.branches(path)
      case 'switch':
        return git.switchBranch(path, String(params.branch ?? ''), Boolean(params.create))
      case 'fetch':
        return git.fetch(path, String(params.remote ?? 'origin'))
      case 'pull':
        return git.pull(path)
      case 'push': {
        const snapshot = await git.status(path)
        return git.push(path, snapshot.branch, snapshot.upstream)
      }
      case 'init':
        return git.init(path)
      case 'github':
        return githubAction(path, params)
      default: {
        const error = new Error(`unknown action: ${action}`)
        error.status = 404
        throw error
      }
    }
  }

  /**
   * Reject a file operation that named no files.
   * @param params - the request parameters.
   * @returns the file list.
   */
  function requireFiles(params) {
    const files = Array.isArray(params.files) ? params.files.filter((file) => typeof file === 'string' && file !== '') : []
    if (files.length === 0) throw new Error('files is empty')
    return files
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

    const token = resolveToken(params.token)
    if (token === null) return { connected: true, remote, authorized: false, reason: 'no-token' }

    if (request === 'repo') {
      const info = await github(token, `/repos/${remote.slug}`)
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
      const info = await github(token, `/repos/${remote.slug}/commits/${sha}`)
      return {
        connected: true,
        authorized: true,
        remote,
        commit: {
          sha: info.sha,
          // `author` is GitHub's account link; null when the commit email is not
          // on any account, which is why the panel keeps git's name as fallback.
          login: info.author?.login ?? null,
          name: info.author?.login ?? info.commit?.author?.name ?? null,
          avatarUrl: info.author?.avatar_url ?? null,
        },
      }
    }
    if (request === 'pulls') {
      const [info, pulls] = await Promise.all([
        github(token, `/repos/${remote.slug}`),
        github(token, `/repos/${remote.slug}/pulls?state=open&per_page=20&sort=updated`),
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
      const issues = await github(token, `/repos/${remote.slug}/issues?state=open&per_page=20&sort=updated`)
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
      })
      return { connected: true, authorized: true, remote, pull: { number: created.number, url: created.html_url } }
    }
    if (request === 'merge') {
      const number = Number(params.number)
      const merged = await github(token, `/repos/${remote.slug}/pulls/${number}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: String(params.method ?? 'merge') }),
      })
      return { connected: true, authorized: true, remote, merged: Boolean(merged.merged), message: merged.message }
    }
    throw new Error(`unknown github action: ${request}`)
  }

  return { handle, repos }
}
