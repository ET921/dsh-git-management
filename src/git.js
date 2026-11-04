/**
 * The Git engine, deliberately free of any Cordis / DSH type.
 *
 * Everything here takes one injected `exec(cwd, args, options)` function and
 * returns plain JSON-able data, so the whole layer can be exercised from a
 * plain Node script against a throwaway repository (see `scripts/verify.mjs`)
 * and reused unchanged inside the Host plugin, where `exec` is the harness
 * subprocess seam.
 *
 * The command set mirrors what VS Code's built-in `vscode.git` extension runs
 * (that extension is the base of Cursor's Source Control panel): the system
 * `git` binary does the work, `git status --porcelain=v2 -z` is the status
 * source, and every mutation is an argv array — never a shell string, so paths
 * with spaces, quotes, or shell metacharacters are inert.
 *
 * @module dsh-git-management/src/git
 */

/** Git's own convention: the exit status of `git diff` is 1 when differences exist. */
const DIFF_EXIT = 1

/** Upper bound for one command's captured output, in bytes. */
export const MAX_OUTPUT_BYTES = 6 * 1024 * 1024

/**
 * One failed Git command, carrying the machine-readable excerpt the panel shows.
 */
export class GitError extends Error {
  /**
   * @param message - human-readable summary (git's own stderr when it has one).
   * @param details - `{ argv, code, stdout, stderr }` for the panel's detail view.
   */
  constructor(message, details) {
    super(message)
    this.name = 'GitError'
    this.details = details
  }
}

/**
 * Trim a command's stderr into the single line worth surfacing.
 * @param text - captured stderr.
 * @returns the first non-empty line, or an empty string.
 */
function firstLine(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0)
  return line ?? ''
}

/**
 * Build the engine over one command executor.
 *
 * @param exec - `(cwd, args, options) => Promise<{ code, stdout, stderr }>`.
 * @returns the engine: every operation the panel can perform.
 */
export function createGit(exec) {
  /**
   * Run one git command and refuse anything but a successful exit.
   * @param cwd - repository (or candidate) directory.
   * @param args - argv after `git`.
   * @param options - `{ allowExit: number[] }` plus executor options.
   * @returns the executor result.
   */
  async function must(cwd, args, options = {}) {
    const result = await exec(cwd, args, options)
    const allowed = options.allowExit ?? [0]
    if (!allowed.includes(result.code)) {
      const detail = firstLine(result.stderr) || firstLine(result.stdout) || `git ${args[0]} exited ${result.code}`
      throw new GitError(detail, { argv: ['git', ...args], ...result })
    }
    return result
  }

  /**
   * Read the repository facts the panel header needs.
   * @param cwd - candidate directory.
   * @returns `{ isRepo, root, gitDir, bare }`.
   */
  async function probe(cwd) {
    const result = await exec(cwd, ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--absolute-git-dir'], {})
    if (result.code !== 0) return { isRepo: false, root: null, gitDir: null }
    const [inside, root, gitDir] = String(result.stdout).split(/\r?\n/)
    return { isRepo: inside?.trim() === 'true', root: root?.trim() ?? null, gitDir: gitDir?.trim() ?? null }
  }

  /**
   * Parse `git status --porcelain=v2 -z`.
   *
   * The v2 format is the one with per-side (index/worktree) status letters and
   * an explicit `# branch.*` header; `-z` keeps paths verbatim (no quoting) and
   * makes renames a two-record sequence.
   *
   * @param text - the raw `-z` stream.
   * @returns branch facts plus one entry per path.
   */
  function parseStatus(text) {
    const state = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, entries: [] }
    const records = String(text).split('\0')
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (record === '') continue
      if (record.startsWith('# branch.oid ')) {
        const oid = record.slice('# branch.oid '.length).trim()
        state.oid = oid === '(initial)' ? null : oid
        continue
      }
      if (record.startsWith('# branch.head ')) {
        const head = record.slice('# branch.head '.length).trim()
        state.branch = head === '(detached)' ? null : head
        continue
      }
      if (record.startsWith('# branch.upstream ')) {
        state.upstream = record.slice('# branch.upstream '.length).trim()
        continue
      }
      if (record.startsWith('# branch.ab ')) {
        const match = /\+(\d+)\s+-(\d+)/.exec(record)
        if (match) {
          state.ahead = Number(match[1])
          state.behind = Number(match[2])
        }
        continue
      }
      const kind = record[0]
      if (kind === '1') {
        // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
        const fields = record.split(' ')
        if (fields.length < 9) continue
        state.entries.push({ kind: 'tracked', xy: fields[1], path: fields.slice(8).join(' ') })
        continue
      }
      if (kind === '2') {
        // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
        const fields = record.split(' ')
        if (fields.length < 10) continue
        const from = fields.slice(9).join(' ')
        index += 1
        const origPath = records[index] ?? ''
        state.entries.push({ kind: 'renamed', xy: fields[1], path: from, origPath })
        continue
      }
      if (kind === 'u') {
        // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
        const fields = record.split(' ')
        if (fields.length < 11) continue
        state.entries.push({ kind: 'conflict', xy: fields[1], path: fields.slice(10).join(' ') })
        continue
      }
      if (kind === '?') {
        state.entries.push({ kind: 'untracked', xy: '??', path: record.slice(2) })
        continue
      }
      // '!' (ignored) records are not requested by this panel's status call.
    }
    return state
  }

  /**
   * Parse `git diff --numstat -z` into a per-path line count.
   * @param text - the raw `-z` stream.
   * @returns `Map<string, { additions: number, deletions: number }>`; binary files count as 0/0.
   */
  function parseNumstat(text) {
    const counts = new Map()
    for (const record of String(text).split('\0')) {
      if (record === '') continue
      const [add, del, ...rest] = record.split('\t')
      const path = rest.join('\t')
      if (path === '') continue
      counts.set(path, {
        additions: add === '-' ? 0 : Number(add),
        deletions: del === '-' ? 0 : Number(del),
      })
    }
    return counts
  }

  /**
   * Map one porcelain `XY` pair to the glyph the panel draws.
   * @param entry - one parsed status entry.
   * @returns `{ status, staged }` where status is one of M/A/D/R/C/U/T.
   */
  function describe(entry) {
    if (entry.kind === 'untracked') return { status: 'U' }
    if (entry.kind === 'conflict') return { status: 'U' }
    const x = entry.xy?.[0] ?? '.'
    const y = entry.xy?.[1] ?? '.'
    const stagedSide = x !== '.' && x !== ' '
    const code = stagedSide ? x : y
    return { status: code === '?' ? 'U' : code }
  }

  /**
   * The panel's main read: branch header, staged list, working-tree list, and
   * per-file line counts.
   * @param cwd - repository directory (or any directory inside it).
   * @returns the status snapshot.
   */
  async function status(cwd) {
    const probed = await probe(cwd)
    if (!probed.isRepo) {
      return { isRepo: false, path: cwd, root: null, branch: null, upstream: null, ahead: 0, behind: 0, oid: null, staged: [], changes: [], conflicts: [], counts: {} }
    }
    const root = probed.root ?? cwd
    const raw = await must(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], {
      // GIT_OPTIONAL_LOCKS keeps a GUI poll from fighting the user's own git.
      env: { GIT_OPTIONAL_LOCKS: '0' },
      timeoutMs: 20000,
    })
    const parsed = parseStatus(raw.stdout)
    const [unstagedNumstat, stagedNumstat] = await Promise.all([
      exec(root, ['diff', '--numstat', '-z', '--no-renames'], { timeoutMs: 20000 }),
      exec(root, ['diff', '--cached', '--numstat', '-z', '--no-renames'], { timeoutMs: 20000 }),
    ])
    const working = unstagedNumstat.code === 0 ? parseNumstat(unstagedNumstat.stdout) : new Map()
    const stagedCounts = stagedNumstat.code === 0 ? parseNumstat(stagedNumstat.stdout) : new Map()

    const staged = []
    const changes = []
    const conflicts = []
    for (const entry of parsed.entries) {
      const { status: letter } = describe(entry)
      const x = entry.xy?.[0] ?? '.'
      const y = entry.xy?.[1] ?? '.'
      const row = {
        path: entry.path,
        origPath: entry.origPath ?? null,
        status: letter,
        kind: entry.kind,
        index: x,
        worktree: y,
      }
      if (entry.kind === 'conflict') {
        conflicts.push({ ...row, additions: 0, deletions: 0 })
        continue
      }
      if (entry.kind !== 'untracked' && x !== '.' && x !== ' ') {
        const counts = stagedCounts.get(entry.path) ?? { additions: 0, deletions: 0 }
        staged.push({ ...row, ...counts })
      }
      if (entry.kind === 'untracked' || (y !== '.' && y !== ' ')) {
        const counts = entry.kind === 'untracked' ? { additions: 0, deletions: 0 } : working.get(entry.path) ?? { additions: 0, deletions: 0 }
        changes.push({ ...row, ...counts })
      }
    }
    return {
      isRepo: true,
      path: cwd,
      root,
      bare: false,
      branch: parsed.branch,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      oid: parsed.oid,
      staged,
      changes,
      conflicts,
    }
  }

  /**
   * One file's unified diff, as the panel renders it.
   *
   * `context` decides how much unchanged text the patch carries: `full` asks
   * git for the whole file (`--unified` with a count larger than any file), so
   * the panel can show the complete text with the changed lines marked, exactly
   * as an editor shows a file rather than a fragment. `hunks` keeps git's
   * default three lines.
   *
   * @param cwd - repository directory.
   * @param file - repository-relative path.
   * @param staged - read the index→HEAD side instead of worktree→index.
   * @param context - `full` or `hunks`.
   * @returns `{ patch, isBinary, isUntracked }`.
   */
  async function diff(cwd, file, staged, context = 'hunks') {
    const unified = context === 'full' ? '--unified=999999' : '--unified=3'
    const args = ['diff', '--no-color', unified]
    if (staged) args.push('--cached')
    args.push('--', file)
    const result = await exec(cwd, args, { allowExit: [0, DIFF_EXIT], timeoutMs: 30000 })
    if (result.code !== 0 && result.code !== DIFF_EXIT) {
      throw new GitError(firstLine(result.stderr) || 'git diff failed', { argv: ['git', ...args], ...result })
    }
    let patch = String(result.stdout)
    let isUntracked = false
    // `git diff` compares two recorded sides. A file git has never seen has
    // neither, so it prints nothing at all — which used to reach the panel as
    // "no textual difference". Against the null device it reads as what it
    // becomes once staged: one new file, every line an addition.
    if (!staged && patch.trim() === '' && (await isTracked(cwd, file)) === false) {
      const created = await exec(cwd, ['diff', '--no-color', unified, '--no-index', '--', '/dev/null', file], { allowExit: [0, DIFF_EXIT], timeoutMs: 30000 })
      if (created.code === 0 || created.code === DIFF_EXIT) {
        patch = String(created.stdout)
        isUntracked = true
      }
    }
    // Both markers are whole lines of git's own: an added line of source that
    // merely quotes the words carries a `+` in front, so it cannot match. The
    // substring check this replaces flagged every diff of a file that mentions
    // "GIT binary patch" — including this file, which is how it was found.
    const isBinary = /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)
    return { file, staged: Boolean(staged), context, patch, isBinary, isUntracked }
  }

  /**
   * Whether the index knows this path.
   *
   * `ls-files --error-unmatch` exits non-zero for a path git has never seen;
   * that is the difference between "this file has no changes" and "this file
   * has no side to diff against yet".
   *
   * @param cwd - repository directory.
   * @param file - repository-relative path.
   * @returns true when the path is tracked or staged.
   */
  async function isTracked(cwd, file) {
    const result = await exec(cwd, ['ls-files', '--error-unmatch', '--', file], { timeoutMs: 10000 })
    return result.code === 0
  }

  /**
   * The staged-side diff of everything, for the commit preview.
   * @param cwd - repository directory.
   * @returns the unified patch text.
   */
  async function stagedPatch(cwd) {
    const result = await exec(cwd, ['diff', '--cached', '--no-color', '--unified=3'], { allowExit: [0, DIFF_EXIT], timeoutMs: 20000 })
    return String(result.stdout)
  }

  /** @param cwd - repository directory. @param paths - repository-relative paths. */
  async function stage(cwd, paths) {
    await must(cwd, ['add', '--', ...paths])
    return { staged: paths }
  }

  /** @param cwd - repository directory. @param paths - repository-relative paths. */
  async function unstage(cwd, paths) {
    const hasHead = await exec(cwd, ['rev-parse', '--verify', 'HEAD'], {})
    if (hasHead.code === 0) await must(cwd, ['restore', '--staged', '--', ...paths])
    else await must(cwd, ['rm', '--cached', '-r', '--', ...paths])
    return { unstaged: paths }
  }

  /**
   * Throw away worktree modifications for tracked files.
   * @param cwd - repository directory.
   * @param paths - repository-relative paths.
   */
  async function discard(cwd, paths) {
    await must(cwd, ['restore', '--worktree', '--', ...paths])
    return { discarded: paths }
  }

  /**
   * Delete untracked files the user explicitly asked to remove.
   * @param cwd - repository directory.
   * @param paths - repository-relative paths.
   */
  async function removeUntracked(cwd, paths) {
    await must(cwd, ['clean', '-f', '--', ...paths])
    return { removed: paths }
  }

  /**
   * Commit the index (optionally after staging everything, optionally amending).
   * @param cwd - repository directory.
   * @param options - `{ message, amend, stageAll, signOff }`.
   */
  async function commit(cwd, options) {
    const { message, amend = false, stageAll = false, signOff = false } = options
    if (typeof message !== 'string' || message.trim() === '') throw new GitError('提交信息不能为空 / commit message is empty', {})
    if (stageAll) await must(cwd, ['add', '-A'])
    const args = ['commit', '-m', message]
    if (amend) args.push('--amend')
    if (signOff) args.push('--signoff')
    const result = await must(cwd, args, { timeoutMs: 60000 })
    const summary = firstLine(result.stderr) || firstLine(result.stdout)
    const sha = /\[[^\]]*?([0-9a-f]{7,40})\]/.exec(result.stdout)
    return { summary, sha: sha?.[1] ?? null }
  }

  /**
   * Recent commits, newest first.
   * @param cwd - repository directory.
   * @param limit - how many to read.
   */
  async function log(cwd, limit = 30) {
    const result = await exec(cwd, ['log', `-n${Math.max(1, Math.min(200, limit))}`, '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e'], { timeoutMs: 20000 })
    if (result.code !== 0) return []
    return String(result.stdout)
      .split('\x1e')
      .map((chunk) => chunk.replace(/^\r?\n/, ''))
      .filter((chunk) => chunk.trim() !== '')
      .map((chunk) => {
        const [sha, short, author, email, date, subject] = chunk.split('\x1f')
        return { sha, short, author, email, date, subject }
      })
  }

  /**
   * Local branches plus the current one.
   *
   * `for-each-ref --format` does not understand `%x1f`, so the separator here is
   * a literal `|` — a character git forbids in a branch name — and the date is
   * read as unix seconds rather than as a string with its own spaces.
   *
   * @param cwd - repository directory.
   * @returns `{ current, branches: [{ name, current, upstream, sha, date }] }`.
   */
  async function branches(cwd) {
    const result = await exec(cwd, ['for-each-ref', '--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(objectname:short)|%(committerdate:unix)', 'refs/heads'], { timeoutMs: 20000 })
    if (result.code !== 0) return { current: null, branches: [] }
    const rows = String(result.stdout)
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [name, head, upstream, sha, unix] = line.split('|')
        const seconds = Number(unix)
        return {
          name,
          current: head === '*',
          upstream: upstream || null,
          sha: sha || null,
          date: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
        }
      })
    return { current: rows.find((row) => row.current)?.name ?? null, branches: rows }
  }

  /**
   * Switch to a branch, optionally creating it first.
   * @param cwd - repository directory.
   * @param name - branch name (validated by git itself).
   * @param create - `git switch -c <name>`.
   */
  async function switchBranch(cwd, name, create = false) {
    if (typeof name !== 'string' || name.trim() === '') throw new GitError('分支名不能为空 / branch name is empty', {})
    const args = create ? ['switch', '-c', name] : ['switch', name]
    const result = await must(cwd, args, { timeoutMs: 60000 })
    return { branch: name, summary: firstLine(result.stderr) || firstLine(result.stdout) }
  }

  /** @param cwd - repository directory. @param remote - remote name. */
  async function fetch(cwd, remote = 'origin') {
    const result = await must(cwd, ['fetch', '--prune', remote], { timeoutMs: 120000 })
    return { summary: firstLine(result.stderr) || 'fetched' }
  }

  /** @param cwd - repository directory. */
  async function pull(cwd) {
    const result = await must(cwd, ['pull', '--ff-only', '--no-edit'], { timeoutMs: 180000 })
    return { summary: firstLine(result.stdout) || firstLine(result.stderr) || 'up to date' }
  }

  /**
   * Push the current branch, publishing it on the first push.
   * @param cwd - repository directory.
   * @param branch - current branch name (needed to choose `-u`).
   * @param upstream - existing upstream, or null when the branch is unpublished.
   */
  async function push(cwd, branch, upstream) {
    const args = upstream ? ['push'] : ['push', '--set-upstream', 'origin', branch]
    const result = await must(cwd, args, { timeoutMs: 180000 })
    return { summary: firstLine(result.stderr) || firstLine(result.stdout) || 'pushed' }
  }

  /** @param cwd - repository directory. */
  async function init(cwd) {
    await must(cwd, ['init'], { timeoutMs: 30000 })
    return { initialized: true }
  }

  /**
   * The `origin` remote expressed as everything a GitHub surface needs.
   * @param cwd - repository directory.
   * @returns `{ remote, slug, webUrl, host, owner, repo }` or null when there is no GitHub remote.
   */
  async function remote(cwd) {
    const result = await exec(cwd, ['remote', '-v'], { timeoutMs: 10000 })
    if (result.code !== 0) return null
    const line = String(result.stdout)
      .split(/\r?\n/)
      .find((value) => /^origin\s/.test(value) && /\s\(fetch\)$/.test(value))
    if (line === undefined) return null
    const url = line.split(/\s+/)[1] ?? ''
    return { ...parseRemote(url), remoteUrl: url }
  }

  /**
   * Every checkout this repository knows about.
   *
   * `git worktree list --porcelain` prints one blank-line-separated block per
   * worktree, with `key value` lines (and bare markers for `bare`, `detached`,
   * `locked`, `prunable`). The first block is the main working tree.
   *
   * @param cwd - repository directory.
   * @returns `{ isRepo, root, worktrees }` where each row is
   *   `{ path, head, branch, detached, bare, locked, prunable, main }`.
   */
  async function worktrees(cwd) {
    const probed = await probe(cwd)
    if (!probed.isRepo) return { isRepo: false, root: null, worktrees: [] }
    const root = probed.root ?? cwd
    const result = await must(root, ['worktree', 'list', '--porcelain'], { timeoutMs: 20000 })
    const text = String(result.stdout)
    const blocks = text.split(/\r?\n\r?\n/).filter((block) => block.trim() !== '')
    const rows = blocks.map((block, index) => {
      const row = {
        path: '',
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        main: index === 0,
      }
      for (const line of block.split(/\r?\n/)) {
        const space = line.indexOf(' ')
        const key = space === -1 ? line : line.slice(0, space)
        const value = space === -1 ? '' : line.slice(space + 1)
        if (key === 'worktree') row.path = value
        else if (key === 'HEAD') row.head = value
        else if (key === 'branch') row.branch = value.replace(/^refs\/heads\//, '')
        else if (key === 'detached') row.detached = true
        else if (key === 'bare') row.bare = true
        else if (key === 'locked') row.locked = true
        else if (key === 'prunable') row.prunable = true
      }
      return row
    })
    // A path comparison in a fixed, case-insensitive form: git prints forward
    // slashes and the panel's own path may come from the workspace registry.
    return {
      isRepo: true,
      root: probed.root ?? root,
      rootKey: normalizePath(probed.root ?? root),
      worktrees: rows.filter((row) => row.path !== '').map((row) => ({ ...row, key: normalizePath(row.path) })),
    }
  }

  /**
   * Count tracked changes in one checkout, for the worktree list's badge.
   *
   * `--untracked-files=no` is deliberate: the untracked scan is the expensive
   * half of `git status`, and a worktree's untracked files are not what the
   * badge is for.
   *
   * @param path - the worktree's directory.
   * @returns the number of changed paths, or null when git refuses.
   */
  async function dirtyCount(path) {
    const result = await exec(path, ['status', '--porcelain', '--untracked-files=no', '-z'], {
      timeoutMs: 15000,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    })
    if (result.code !== 0) return null
    return String(result.stdout).split('\0').filter((record) => record !== '').length
  }

  /**
   * Create a worktree on a new branch.
   * @param cwd - any directory inside the repository.
   * @param options - `{ path, branch, from }`; `path` is absolute.
   * @returns the created worktree's directory and branch.
   */
  async function addWorktree(cwd, options) {
    const { path, branch, from = 'HEAD' } = options
    if (typeof path !== 'string' || path === '') throw new GitError('worktree path is required', {})
    if (typeof branch !== 'string' || branch === '') throw new GitError('worktree branch is required', {})
    await must(cwd, ['worktree', 'add', '-b', branch, path, from], { timeoutMs: 180000 })
    return { path, branch }
  }

  /**
   * Remove one worktree directory.
   *
   * No `--force`: a checkout with modified or untracked files must fail, and
   * git's own message explains why. The caller validates that `path` is a
   * currently listed worktree before reaching here.
   *
   * @param cwd - repository directory.
   * @param path - the worktree's directory.
   */
  async function removeWorktree(cwd, path) {
    const result = await must(cwd, ['worktree', 'remove', path], { timeoutMs: 60000 })
    return { summary: firstLine(result.stderr) || firstLine(result.stdout) || 'removed' }
  }

  /**
   * Drop records whose directory is gone.
   * @param cwd - repository directory.
   */
  async function pruneWorktrees(cwd) {
    const result = await must(cwd, ['worktree', 'prune'], { timeoutMs: 30000 })
    return { summary: firstLine(result.stdout) || firstLine(result.stderr) || 'pruned' }
  }

  /**
   * Everything a commit hover card shows, in two calls.
   *
   * `git show -s` carries the message; `git show --numstat` carries the stat
   * line. Binary files report `-` in numstat and are counted as files with no
   * line delta, which is what the card should say.
   *
   * @param cwd - repository directory.
   * @param sha - any ref or commit id.
   * @returns `{ sha, short, author, email, date, committer, subject, body, files, additions, deletions }`.
   */
  async function commitDetail(cwd, sha) {
    const format = '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%s%x1f%b'
    const info = await must(cwd, ['show', '-s', '--date=iso-strict', format, sha], { timeoutMs: 20000 })
    const [full, short, author, email, date, committer, subject, body] = String(info.stdout).split('\x1f')
    const stat = await exec(cwd, ['show', '--numstat', '--format=', sha], { timeoutMs: 20000 })
    let files = 0
    let additions = 0
    let deletions = 0
    for (const line of String(stat.stdout).split(/\r?\n/)) {
      if (line.trim() === '') continue
      const [add, del] = line.split('\t')
      files += 1
      if (add !== '-' && Number.isFinite(Number(add))) additions += Number(add)
      if (del !== '-' && Number.isFinite(Number(del))) deletions += Number(del)
    }
    return {
      sha: full ?? sha,
      short: short ?? String(sha).slice(0, 7),
      author: author ?? '',
      email: email ?? '',
      date: date ?? null,
      committer: committer ?? '',
      subject: subject ?? '',
      body: String(body ?? '').trim(),
      files,
      additions,
      deletions,
    }
  }

  /**
   * Where one branch points and how it tracks its upstream.
   * @param cwd - repository directory.
   * @param branch - the local branch name.
   * @returns `{ branch, exists, short, author, date, subject, upstream, track }`.
   */
  async function branchDetail(cwd, branch) {
    const info = await exec(cwd, ['log', '-1', '--date=iso-strict', '--pretty=format:%h%x1f%an%x1f%aI%x1f%s', branch], { timeoutMs: 20000 })
    if (info.code !== 0) return { branch, exists: false }
    const [short, author, date, subject] = String(info.stdout).split('\x1f')
    // `for-each-ref --format` does not understand `%x1f`; `|` is a separator it
    // can carry, and a branch name may not contain one.
    const ref = await exec(cwd, ['for-each-ref', '--format=%(upstream:short)|%(upstream:track)', `refs/heads/${branch}`], { timeoutMs: 10000 })
    const [upstream, track] = String(ref.stdout).trim().split('|')
    return {
      branch,
      exists: true,
      short: short ?? null,
      author: author ?? '',
      date: date ?? null,
      subject: subject ?? '',
      upstream: upstream || null,
      track: track || null,
    }
  }

  /**
   * The author recorded on one commit, as git has it.
   *
   * The email is what decides whether a local (unpushed) commit belongs to the
   * machine's own user: GitHub cannot answer for a sha it has never seen, but
   * the address can be matched against `user.email` before any guess is made.
   *
   * @param cwd - repository directory.
   * @param sha - any ref or commit id.
   * @returns `{ name, email }`, or null when the commit cannot be read.
   */
  async function commitAuthor(cwd, sha) {
    const result = await exec(cwd, ['show', '-s', '--pretty=format:%an%x1f%ae', String(sha)], { timeoutMs: 10000 })
    if (result.code !== 0) return null
    const [name, email] = String(result.stdout).trim().split('\x1f')
    return { name: name ?? '', email: email ?? '' }
  }

  /**
   * The identity this checkout authors commits with.
   *
   * `git config user.email` resolves the per-repo override and the global
   * setting behind it, which is the address the next commit will carry.
   *
   * @param cwd - repository directory.
   * @returns the configured email, or null when it is unset.
   */
  async function userEmail(cwd) {
    const result = await exec(cwd, ['config', 'user.email'], { timeoutMs: 10000 })
    if (result.code !== 0) return null
    const email = String(result.stdout).trim()
    return email === '' ? null : email
  }

  return {
    probe,
    status,
    diff,
    stagedPatch,
    stage,
    unstage,
    discard,
    removeUntracked,
    commit,
    log,
    branches,
    switchBranch,
    fetch,
    pull,
    push,
    init,
    remote,
    worktrees,
    dirtyCount,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    commitDetail,
    branchDetail,
    commitAuthor,
    userEmail,
  }
}

/**
 * One path form for comparison: forward slashes, no trailing slash, folded case
 * (Windows and macOS compare paths case-insensitively in practice).
 * @param path - the raw path.
 * @returns the comparable key.
 */
export function normalizePath(path) {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Parse a git remote URL into `{ host, owner, repo, slug, webUrl }`.
 *
 * Covers the three shapes users actually have: `git@host:owner/repo.git`,
 * `https://host/owner/repo(.git)`, and `ssh://git@host/owner/repo.git`.
 *
 * @param url - the raw remote URL.
 * @returns the parsed parts; `slug` is null when the URL is not host/owner/repo.
 */
export function parseRemote(url) {
  const raw = String(url ?? '').trim()
  if (raw === '') return { host: null, owner: null, repo: null, slug: null, webUrl: null }
  let host = null
  let path = ''
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw)
  if (/^[a-z+]+:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      host = parsed.hostname
      path = parsed.pathname
    } catch {
      return { host: null, owner: null, repo: null, slug: null, webUrl: null }
    }
  } else if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    path = raw
  }
  const cleaned = path.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  const parts = cleaned.split('/').filter((part) => part !== '')
  if (parts.length < 2) return { host, owner: parts[0] ?? null, repo: null, slug: null, webUrl: null }
  const owner = parts.slice(0, -1).join('/')
  const repo = parts[parts.length - 1]
  return {
    host,
    owner,
    repo,
    slug: `${owner}/${repo}`,
    webUrl: host === null ? null : `https://${host}/${owner}/${repo}`,
  }
}
