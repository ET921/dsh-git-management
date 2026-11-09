/**
 * Verify the plugin without the GUI.
 *
 * The Git engine and the action table are dependency-free by construction, so
 * this script drives them against a real throwaway repository with the real
 * `git` binary — the same way the Host does, minus the subprocess seam. It
 * fails loudly, and it leaves no repository behind.
 *
 * Run: `node scripts/verify.mjs`
 *
 * @module dsh-git-management/scripts/verify
 */

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, symlink } from 'node:fs/promises'
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGit, parseRemote } from '../src/git.js'
import { createActions } from '../src/actions.js'

let checks = 0
let failed = 0

/**
 * Assert one fact.
 * @param label - what is being checked.
 * @param condition - the fact.
 * @param detail - shown when it is false.
 */
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failed += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

/**
 * Assert deep equality on JSON values.
 * @param label - what is being checked.
 * @param actual - observed value.
 * @param expected - expected value.
 */
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected })
}

/**
 * The Host's `exec` contract, implemented with Node's own child_process.
 *
 * stdio is bound to files rather than pipes on purpose: a sandboxed shell can
 * spawn a child but cannot give it a pipe, so `pipe` fails with EPERM here even
 * though it is exactly what the Host's subprocess seam does. Files keep this
 * script runnable in both environments.
 *
 * @param cwd - working directory.
 * @param args - argv after `git`.
 * @param options - `{ env }`.
 * @returns `{ code, stdout, stderr }`.
 */
function exec(cwd, args, options = {}) {
  commandLog.push(['git', ...args].join(' '))
  const stamp = String(outputDir === '' ? 0 : outputIndex++)
  const outPath = join(outputDir, `out-${stamp}.txt`)
  const errPath = join(outputDir, `err-${stamp}.txt`)
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', ...(options.env ?? {}) },
    })
    child.on('error', () => {
      closeSync(outFd)
      closeSync(errFd)
      resolve({ code: -1, stdout: '', stderr: 'spawn failed' })
    })
    child.on('close', (code) => {
      closeSync(outFd)
      closeSync(errFd)
      resolve({ code: code ?? 0, stdout: readFileSync(outPath, 'utf8'), stderr: readFileSync(errPath, 'utf8') })
    })
  })
}

/** Where captured streams are parked; set before the first git call. */
let outputDir = ''
let outputIndex = 0
/** Every argv this script has run; the bare-status check asserts no `status`. */
const commandLog = []

const git = createGit(exec)

/** Placeholder workspace list; `repos` is the one action that reads it. */
const workspaces = async () => [
  { id: 'w1', title: 'fixture', path: currentRepo },
  { id: 'w2', title: 'not-a-repo', path: currentPlain },
]

const actions = createActions({ git, workspaces })

let currentRepo = ''
let currentPlain = ''

// Capture directory for the file-bound stdio; removed at the end.
outputDir = await mkdtemp(join(tmpdir(), 'dsh-git-out-'))

console.log('\n# remote URL parsing')
{
  equal('scp style', parseRemote('git@github.com:deepseek-ai/deepseek-harness.git').slug, 'deepseek-ai/deepseek-harness')
  equal('https style', parseRemote('https://github.com/foo/bar.git').slug, 'foo/bar')
  equal('https without .git', parseRemote('https://github.com/foo/bar').slug, 'foo/bar')
  equal('ssh url', parseRemote('ssh://git@gitlab.example.com/group/sub/project.git').slug, 'group/sub/project')
  equal('host kept', parseRemote('git@github.com:foo/bar.git').host, 'github.com')
  equal('web url', parseRemote('git@github.com:foo/bar.git').webUrl, 'https://github.com/foo/bar')
  equal('empty remote', parseRemote('').slug, null)
}

console.log('\n# git engine against a real repository')
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-fixture-'))
  currentRepo = dir
  currentPlain = await mkdtemp(join(tmpdir(), 'dsh-plain-'))
  try {
    check('not a repo before init', (await git.probe(dir)).isRepo === false)
    await exec(dir, ['init', '-b', 'main'])
    await exec(dir, ['config', 'user.email', 'dev@example.com'])
    await exec(dir, ['config', 'user.name', 'Dev'])
    await exec(dir, ['config', 'commit.gpgsign', 'false'])
    check('repo detected after init', (await git.probe(dir)).isRepo === true)

    await writeFile(join(dir, 'README.md'), '# fixture\n')
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'index.js'), 'export const one = 1\n')
    await writeFile(join(dir, 'name with space.txt'), 'spaces are fine\n')

    let snapshot = await git.status(dir)
    check('branch is main', snapshot.branch === 'main', snapshot.branch)
    check('three untracked files', snapshot.changes.length === 3, snapshot.changes)
    check('untracked renders as U', snapshot.changes.every((row) => row.status === 'U'), snapshot.changes)
    check('paths with spaces survive', snapshot.changes.some((row) => row.path === 'name with space.txt'), snapshot.changes)

    await git.stage(dir, ['README.md', 'name with space.txt'])
    snapshot = await git.status(dir)
    check('two staged', snapshot.staged.length === 2, snapshot.staged)
    check('staged side A', snapshot.staged.every((row) => row.status === 'A'), snapshot.staged)
    check('one change left', snapshot.changes.length === 1, snapshot.changes)

    await git.stage(dir, ['src/index.js'])
    const committed = await git.commit(dir, { message: 'initial commit' })
    check('commit returned a sha', typeof committed.sha === 'string' && committed.sha !== null, committed)
    snapshot = await git.status(dir)
    check('tree clean after commit', snapshot.changes.length === 0 && snapshot.staged.length === 0, snapshot)

    const log = await git.log(dir, 5)
    check('one commit in log', log.length === 1, log)
    check('log subject', log[0]?.subject === 'initial commit', log[0])
    check('the root commit has no parents', Array.isArray(log[0]?.parents) && log[0].parents.length === 0, log[0]?.parents)
    check('log decorates HEAD with its branch', (log[0]?.refs ?? []).some((ref) => ref.startsWith('HEAD -> ')), log[0]?.refs)

    // The rail draws one lane per open line of history, which it can only do
    // from the parent list; a merge is where that list stops being a single sha.
    const baseSha = String((await exec(dir, ['rev-parse', 'HEAD'])).stdout).trim()
    await exec(dir, ['switch', '-c', 'rail-side'])
    await exec(dir, ['commit', '--allow-empty', '-m', 'side work'])
    await exec(dir, ['switch', 'main'])
    // The default scope follows the checked-out line, which is the only window
    // a lane layout can draw without tips that begin in mid-air.
    const headScoped = await git.log(dir, 10)
    check('the default log follows the checked-out line', headScoped.every((row) => row.subject !== 'side work'), headScoped.map((row) => row.subject))
    const allScoped = await git.log(dir, 10, 'all')
    check('scope "all" reads the other branch', allScoped.some((row) => row.subject === 'side work'), allScoped.map((row) => row.subject))
    await exec(dir, ['commit', '--allow-empty', '-m', 'main work'])
    await exec(dir, ['merge', '--no-ff', '--no-edit', 'rail-side'])
    const merged = await git.log(dir, 10)
    check('log reads every branch, not just the checked-out one', new Set(merged.flatMap((row) => row.refs)).size >= 2, merged.map((row) => row.refs))
    const mergeRow = merged.find((row) => (row.parents ?? []).length === 2)
    check('a merge carries two parents', mergeRow !== undefined, merged.map((row) => row.parents))
    check('the merge is the newest commit', mergeRow?.sha === merged[0]?.sha, { merge: mergeRow?.sha, head: merged[0]?.sha })

    // A stash is reachable only through `refs/stash`, so the "all" view has to
    // exclude it explicitly; left in, its two parents open two orphan lanes.
    await writeFile(join(dir, 'README.md'), '# fixture\n\nstashed change\n')
    await exec(dir, ['stash', 'push', '-m', 'rail stash probe'])
    const withStash = await git.log(dir, 15, 'all')
    check('the "all" view leaves the stash out', withStash.every((row) => !row.subject.includes('rail stash probe')), withStash.map((row) => row.subject))
    await exec(dir, ['stash', 'drop'])
    // Put the fixture back the way the rest of the file expects it.
    await exec(dir, ['reset', '--hard', baseSha])
    await exec(dir, ['branch', '-D', 'rail-side'])

    // A colleague's pushed branch is only ever a remote-tracking ref here. The
    // graph has to read those refs, or the panel shows one developer's line and
    // calls it the team's history.
    const peerBare = await mkdtemp(join(tmpdir(), 'dsh-git-peer-bare-'))
    const peerClone = await mkdtemp(join(tmpdir(), 'dsh-git-peer-clone-'))
    try {
      await exec(peerBare, ['init', '--bare', '-b', 'main'])
      await exec(dir, ['remote', 'add', 'peer', peerBare])
      await exec(dir, ['push', 'peer', 'main:main'])
      await exec(peerClone, ['clone', peerBare, '.'])
      await exec(peerClone, ['config', 'user.name', 'Colleague'])
      await exec(peerClone, ['config', 'user.email', 'colleague@example.com'])
      await exec(peerClone, ['switch', '-c', 'colleague/fix'])
      await exec(peerClone, ['commit', '--allow-empty', '-m', 'colleague work'])
      await exec(peerClone, ['push', 'origin', 'colleague/fix'])
      await git.fetch(dir, 'peer')
      const collaboration = await git.log(dir, 20, 'all')
      check('a colleague push reaches the graph after a fetch', collaboration.some((row) => row.subject === 'colleague work'), collaboration.map((row) => row.subject))
      check('the colleague branch labels its row as a remote', collaboration.some((row) => (row.refs ?? []).includes('peer/colleague/fix')), collaboration.map((row) => row.refs))
      const mineOnly = await git.log(dir, 20)
      check('the narrow scope keeps the colleague line out', mineOnly.every((row) => row.subject !== 'colleague work'), mineOnly.map((row) => row.subject))
    } finally {
      await exec(dir, ['remote', 'remove', 'peer'])
      await rm(peerBare, { recursive: true, force: true })
      await rm(peerClone, { recursive: true, force: true })
    }

    const detail = await actions.handle('commitDetail', { path: dir, sha: 'HEAD' })
    check('commitDetail carries the subject', detail.subject === 'initial commit', detail)
    check('commitDetail counts the touched files', detail.files === 3, detail)
    check('commitDetail sums additions', detail.additions === 3 && detail.deletions === 0, detail)
    check('commitDetail carries the author', detail.author === 'Dev', detail)

    const branchInfo = await actions.handle('branchDetail', { path: dir, branch: 'main' })
    check('branchDetail finds the branch', branchInfo.exists === true && branchInfo.subject === 'initial commit', branchInfo)
    check('branchDetail reports no upstream yet', branchInfo.upstream === null, branchInfo)

    await writeFile(join(dir, 'README.md'), '# fixture\n\nmore\n')
    snapshot = await git.status(dir)
    check('modification shows as M', snapshot.changes[0]?.status === 'M', snapshot.changes)
    check('line counts reported', snapshot.changes[0]?.additions === 2, snapshot.changes)

    const patch = await git.diff(dir, 'README.md', false)
    check('diff mentions the added line', patch.patch.includes('+more'), patch.patch)
    check('a tracked diff is not flagged untracked', patch.isUntracked === false)

    // An untracked file has no side to compare against, so `git diff` prints
    // nothing; the host falls back to the null device and the panel gets the
    // file's content as added lines instead of "no textual difference".
    await writeFile(join(dir, 'untracked.txt'), 'first line\nsecond line\n')
    const untrackedPatch = await git.diff(dir, 'untracked.txt', false)
    check('an untracked file still gets a patch', untrackedPatch.isUntracked === true && untrackedPatch.patch.includes('+first line'), untrackedPatch.patch.slice(0, 160))
    check('the untracked patch reads as a new file', untrackedPatch.patch.includes('new file mode'), untrackedPatch.patch.slice(0, 160))
    await writeFile(join(dir, 'untracked.bin'), Buffer.from([0, 1, 2, 3]))
    const untrackedBinary = await git.diff(dir, 'untracked.bin', false)
    check('an untracked binary reports binary', untrackedBinary.isUntracked === true && untrackedBinary.isBinary === true, untrackedBinary.patch.slice(0, 120))
    await rm(join(dir, 'untracked.txt'), { force: true })
    await rm(join(dir, 'untracked.bin'), { force: true })

    // A text diff that quotes the binary marker must stay text: the marker is a
    // whole line git prints itself, not any occurrence of the words.
    await writeFile(join(dir, 'marker.txt'), "const isBinary = patch.includes('GIT binary patch')\n")
    await git.stage(dir, ['marker.txt'])
    const markerDiff = await git.diff(dir, 'marker.txt', true)
    check('a diff that quotes the binary marker stays text', markerDiff.isBinary === false, markerDiff.patch.slice(0, 160))
    check('the quoted marker line is a real addition', markerDiff.patch.includes("+const isBinary = patch.includes('GIT binary patch')"), markerDiff.patch.slice(0, 200))
    await git.unstage(dir, ['marker.txt'])
    await rm(join(dir, 'marker.txt'), { force: true })

    // `git add -- <path>` still treats the argument as a pathspec, so a name
    // containing `[` used to stage whichever sibling matched the glob. Two
    // files where one name is also a pattern for the other is the whole test.
    await writeFile(join(dir, 'bracket.txt'), 'plain\n')
    await writeFile(join(dir, 'b[br]acket.txt'), 'weird\n')
    await git.stage(dir, ['b[br]acket.txt'])
    const stagedFiles = String((await exec(dir, ['diff', '--cached', '--name-only'])).stdout).trim().split(/\r?\n/).filter((name) => name !== '')
    check('staging a bracketed name stages only that file', stagedFiles.length === 1 && stagedFiles[0] === 'b[br]acket.txt', stagedFiles)
    check('the sibling the glob would match stays out', stagedFiles.includes('bracket.txt') === false, stagedFiles)
    equal('isTracked resolves the literal name', await git.isTracked(dir, 'b[br]acket.txt'), true)
    await git.unstage(dir, ['b[br]acket.txt'])
    const bracketPatch = await git.diff(dir, 'b[br]acket.txt', false)
    check('diff reads the bracketed file, not its sibling', bracketPatch.patch.includes('+weird'), bracketPatch.patch.slice(0, 200))
    await git.removeUntracked(dir, ['b[br]acket.txt'])
    check('removeUntracked deletes only the named file', existsSync(join(dir, 'b[br]acket.txt')) === false && existsSync(join(dir, 'bracket.txt')) === true)
    await rm(join(dir, 'bracket.txt'), { force: true })

    // One path can be on both sides at once: staged as an addition, then
    // deleted from the disk. Each list needs its own letter, or the "changes"
    // list claims a file that is gone is an addition.
    await writeFile(join(dir, 'both-sides.txt'), 'temporary\n')
    await git.stage(dir, ['both-sides.txt'])
    await rm(join(dir, 'both-sides.txt'), { force: true })
    const bothSides = await git.status(dir)
    check('an added-then-deleted file is an addition on the staged side', bothSides.staged.some((row) => row.path === 'both-sides.txt' && row.status === 'A'), bothSides.staged.map((row) => `${row.path}:${row.status}`))
    check('and a deletion on the worktree side', bothSides.changes.some((row) => row.path === 'both-sides.txt' && row.status === 'D'), bothSides.changes.map((row) => `${row.path}:${row.status}`))
    await git.unstage(dir, ['both-sides.txt'])

    await git.stage(dir, ['README.md'])
    const stagedPatch = await git.stagedPatch(dir)
    check('staged patch mentions the added line', stagedPatch.includes('+more'))

    // Discard restores the worktree from the index, so it only reverts the
    // unstaged half: unstage first, then the whole modification is gone.
    await git.unstage(dir, ['README.md'])
    await git.discard(dir, ['README.md'])
    snapshot = await git.status(dir)
    // Compare with line endings normalised: `core.autocrlf` may hand the
    // worktree back CRLF even though the blob is LF.
    const restored = (await readFile(join(dir, 'README.md'), 'utf8')).replace(/\r\n/g, '\n')
    check('discard restored the file', restored === '# fixture\n', JSON.stringify(restored))
    check('tree clean after discard', snapshot.changes.length === 0, snapshot)

    const branches = await git.branches(dir)
    equal('current branch', branches.current, 'main')
    await git.switchBranch(dir, 'feature/panel', true)
    snapshot = await git.status(dir)
    check('switched to new branch', snapshot.branch === 'feature/panel', snapshot.branch)
    check('branch list grew', (await git.branches(dir)).branches.length === 2)

    // ---- worktrees --------------------------------------------------------
    const initial = await actions.handle('worktrees', { path: dir })
    check('one worktree before adding', initial.worktrees?.length === 1, initial)
    check('the first row is the main worktree', initial.worktrees?.[0]?.main === true, initial.worktrees)

    const createdWorktree = await actions.handle('createWorktree', { path: dir, name: 'panel' })
    check('createWorktree names the branch worktree-panel', createdWorktree.branch === 'worktree-panel', createdWorktree)
    check('createWorktree lands under .agents/worktrees', String(createdWorktree.path).replace(/\\/g, '/').endsWith('/.agents/worktrees/panel'), createdWorktree.path)
    check('the checkout exists on disk', existsSync(createdWorktree.path) === true)

    let listed = await actions.handle('worktrees', { path: dir })
    check('two worktrees after adding', listed.worktrees.length === 2, listed.worktrees)
    const added = listed.worktrees.find((row) => row.main !== true)
    check('the added worktree reports its branch', added?.branch === 'worktree-panel', added)
    check('a fresh worktree counts as clean', added?.dirty === 0 && added?.dirtyKnown === true, added)
    check('the repository root is reported', typeof listed.root === 'string' && listed.root !== '', listed.root)

    // A tracked modification is what the badge counts; an untracked file is not.
    await writeFile(join(added.path, 'README.md'), '# fixture\n\nchanged in the worktree\n')
    await writeFile(join(added.path, 'untracked.txt'), 'ignored by the badge\n')
    listed = await actions.handle('worktrees', { path: dir })
    const dirty = listed.worktrees.find((row) => row.main !== true)
    check('dirty count sees the tracked edit only', dirty?.dirty === 1, dirty)

    const traversal = await actions.handle('createWorktree', { path: dir, name: '../evil' }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('a traversing worktree name is refused', traversal, 'rejected')

    const removeMain = await actions.handle('removeWorktree', { path: dir, target: dir }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('removing the main worktree is refused', removeMain, 'rejected')

    const removeInUse = await actions.handle('removeWorktree', { path: added.path, target: added.path }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('removing the worktree the panel is in is refused', removeInUse, 'rejected')

    const removeDirty = await actions.handle('removeWorktree', { path: dir, target: added.path }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('removing a dirty worktree is refused by git', removeDirty, 'rejected')

    await exec(added.path, ['restore', '--', 'README.md'])
    await exec(added.path, ['clean', '-fd'])
    const removedWorktree = await actions.handle('removeWorktree', { path: dir, target: added.path })
    check('removeWorktree returns the fresh list', Array.isArray(removedWorktree.worktrees) && removedWorktree.worktrees.length === 1, removedWorktree)
    check('the removed checkout is gone from disk', existsSync(added.path) === false)

    const pruned = await actions.handle('pruneWorktrees', { path: dir })
    check('pruneWorktrees returns the list', Array.isArray(pruned.worktrees), pruned)

    await exec(dir, ['remote', 'add', 'origin', 'https://github.com/example/fixture.git'])
    const remote = await git.remote(dir)
    equal('origin parsed', remote?.slug, 'example/fixture')

    const github = await actions.handle('github', { path: dir, action: 'remote' })
    check('github remote action reports connected', github.connected === true, github)
    const unauthenticated = await actions.handle('github', { path: dir, action: 'repo' })
    check('without a token the API is refused', unauthenticated.authorized === false || process.env.GITHUB_TOKEN !== undefined, unauthenticated)

    // ---- GitHub identity for a commit that is not on the remote yet --------
    const localAuthor = await git.commitAuthor(dir, 'HEAD')
    check('commitAuthor reads the name and email', localAuthor?.name === 'Dev' && localAuthor?.email === 'dev@example.com', localAuthor)
    equal('userEmail reads the checkout identity', await git.userEmail(dir), 'dev@example.com')

    const realFetch = global.fetch
    const githubCalls = []
    global.fetch = async (url) => {
      const target = String(url)
      githubCalls.push(target)
      if (target.endsWith('/user')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ login: 'dev-gh', name: 'Dev', avatar_url: null }) }
      }
      if (target.includes('/search/commits')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 1, items: [{ author: { login: 'other-gh' } }] }) }
      }
      return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) }
    }
    try {
      const own = await actions.handle('github', { path: dir, action: 'commit', sha: 'HEAD', token: 'stub' })
      check('an unpushed own commit is named by the authenticated account', own.commit?.login === 'dev-gh' && own.local === true, own)
      check('the own path asks for the commit and the viewer only', githubCalls.length === 2 && githubCalls[1].endsWith('/user'), githubCalls)

      // A commit by somebody else, still local: there is no sha on GitHub to
      // ask about, so the address is what names the author.
      const foreignCommit = await exec(dir, ['-c', 'user.name=Grace', '-c', 'user.email=grace@example.com', 'commit', '--allow-empty', '-m', 'by grace'])
      const foreignSha = String((await exec(dir, ['rev-parse', 'HEAD'])).stdout).trim()
      check('the fixture can make a commit by another author', foreignCommit.code === 0 && foreignSha.length === 40, foreignCommit)
      githubCalls.length = 0
      const foreign = await actions.handle('github', { path: dir, action: 'commit', sha: foreignSha, token: 'stub' })
      check('another author is named by their email, unpushed', foreign.commit?.login === 'other-gh' && foreign.local === true, foreign)
      check(
        'the other-author path searches the commit email',
        githubCalls.length === 2 && githubCalls[1].includes('/search/commits?q=author-email%3Agrace%40example.com'),
        githubCalls,
      )

      githubCalls.length = 0
      const again = await actions.handle('github', { path: dir, action: 'commit', sha: foreignSha, token: 'stub' })
      check('the same address is only looked up once', again.commit?.login === 'other-gh' && githubCalls.length === 1, githubCalls)
      await exec(dir, ['reset', '--soft', 'HEAD~1'])
    } finally {
      global.fetch = realFetch
    }

    // ---- GitHub token destination -----------------------------------------
    // A remote URL is repository content. Before any GitHub call, its host has
    // to agree with the API base: without GITHUB_API_URL only github.com may
    // receive the token; with one, the API host (and, for HTTP remotes, the
    // port) must match. A mismatch must not even attempt a fetch.
    const savedOrigin = String((await exec(dir, ['remote', 'get-url', 'origin'])).stdout).trim()
    const savedApiUrl = process.env.GITHUB_API_URL
    const hostCalls = []
    const realGithubFetch = global.fetch
    global.fetch = async (url, init) => {
      hostCalls.push({ url: String(url), auth: init?.headers?.authorization ?? null })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ full_name: 'owner/repo', default_branch: 'main', owner: { avatar_url: null } }),
      }
    }
    try {
      delete process.env.GITHUB_API_URL
      await exec(dir, ['remote', 'set-url', 'origin', 'https://attacker.example/owner/repo.git'])
      const stranger = await actions.handle('github', { path: dir, action: 'repo', token: 'ghp_secret' })
      check('a non-GitHub remote is refused as unsupported-host', stranger.authorized === false && stranger.reason === 'unsupported-host', stranger)
      check('a non-GitHub remote causes zero GitHub calls', hostCalls.length === 0, hostCalls)

      // An ambient token must not leak either: the host gate runs before any
      // token is resolved.
      const savedAmbientToken = process.env.GITHUB_TOKEN
      process.env.GITHUB_TOKEN = 'ghp_ambient_secret'
      try {
        const ambient = await actions.handle('github', { path: dir, action: 'repo' })
        check(
          'an ambient token is not sent to a non-GitHub remote',
          ambient.authorized === false && ambient.reason === 'unsupported-host' && hostCalls.length === 0,
          ambient,
        )
      } finally {
        if (savedAmbientToken === undefined) delete process.env.GITHUB_TOKEN
        else process.env.GITHUB_TOKEN = savedAmbientToken
      }

      process.env.GITHUB_API_URL = 'https://ghe.example.com/api/v3'
      const mismatched = await actions.handle('github', { path: dir, action: 'repo', token: 'ghp_secret' })
      check('a configured API base for another host is refused', mismatched.authorized === false && mismatched.reason === 'unsupported-host', mismatched)
      check('a mismatched API base causes zero GitHub calls', hostCalls.length === 0, hostCalls)

      // Same host, different port: still a different destination.
      await exec(dir, ['remote', 'set-url', 'origin', 'https://ghe.example.com:8443/owner/repo.git'])
      const wrongPort = await actions.handle('github', { path: dir, action: 'repo', token: 'ghp_secret' })
      check(
        'an HTTP remote on another port is refused',
        wrongPort.authorized === false && wrongPort.reason === 'unsupported-host' && hostCalls.length === 0,
        wrongPort,
      )

      // Matching host and port: the token may be sent, and it goes to the
      // operator-configured base — never to a base derived from the remote.
      await exec(dir, ['remote', 'set-url', 'origin', 'https://ghe.example.com/owner/repo.git'])
      const allowed = await actions.handle('github', { path: dir, action: 'repo', token: 'ghp_ghes' })
      check('a matching GITHUB_API_URL may fetch', allowed.authorized === true && hostCalls.length === 1, allowed)
      check('the matching call uses the configured API base', hostCalls[0]?.url === 'https://ghe.example.com/api/v3/repos/owner/repo', hostCalls[0])
      check('the matching call carries the token', hostCalls[0]?.auth === 'Bearer ghp_ghes', hostCalls[0])
    } finally {
      global.fetch = realGithubFetch
      if (savedApiUrl === undefined) delete process.env.GITHUB_API_URL
      else process.env.GITHUB_API_URL = savedApiUrl
      await exec(dir, ['remote', 'set-url', 'origin', savedOrigin])
    }

    const empties = await actions.handle('stage', { path: dir, files: [] }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('stage with no files rejects', empties, 'rejected')

    const repos = await actions.handle('repos', {})
    check('repos lists both workspaces', repos.repos.length === 2, repos.repos)
    check('repos marks the repository', repos.repos.find((row) => row.path === dir)?.isRepo === true, repos.repos)
    check('repos marks the plain directory', repos.repos.find((row) => row.path === currentPlain)?.isRepo === false, repos.repos)

    const notRepo = await git.status(currentPlain)
    check('plain directory reports isRepo false', notRepo.isRepo === false, notRepo)

    const error = await git.commit(currentPlain, { message: 'x' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('git failure surfaces as GitError', error?.name === 'GitError', error)
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (currentPlain !== '') await rm(currentPlain, { recursive: true, force: true })
  }
}

console.log('\n# GitHub token persistence (host credential store)')
{
  // The token is the host's now (plan-v2 S24): `saveToken` writes it into the
  // DSH credential service under the name `git` already reads, `clearToken`
  // deletes it, and every `github` action resolves it at call time. A fake
  // store keeps this section off the real credential file and records every
  // call, so what was written — and when it was read — is assertable.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-token-'))
  const storeCalls = []
  const fakeStore = {
    async resolve(ref) {
      storeCalls.push(['resolve', ref])
      return ref === 'GITHUB_TOKEN' ? { value: ' stored-token ' } : undefined
    },
    async set(ref, value) {
      storeCalls.push(['set', ref, value])
    },
    async unset(ref) {
      storeCalls.push(['unset', ref])
    },
  }
  const withStore = createActions({ git, workspaces, credentials: () => fakeStore })
  const withoutStore = createActions({ git, workspaces, credentials: () => undefined })
  try {
    await exec(dir, ['init', '-b', 'main'])
    await exec(dir, ['config', 'user.email', 'dev@example.com'])
    await exec(dir, ['config', 'user.name', 'Dev'])
    await exec(dir, ['remote', 'add', 'origin', 'https://github.com/example/token-fixture.git'])

    // (a) A save trims what the user pasted and writes the trimmed value under
    // the name `git` and every other host tool already read.
    const saved = await withStore.handle('saveToken', { token: '  ghp_x  ' })
    check('saveToken reports saved', saved?.saved === true, saved)
    equal('saveToken writes the trimmed token under GITHUB_TOKEN', storeCalls, [['set', 'GITHUB_TOKEN', 'ghp_x']])

    // (b) Blank is not a credential: it must not reach the store at all.
    storeCalls.length = 0
    const blank = await withStore.handle('saveToken', { token: '   ' }).then(
      () => null,
      (error) => error,
    )
    check('a blank token is rejected as invalid-argument', blank?.code === 'invalid-argument', blank)
    check('a blank token writes nothing', storeCalls.length === 0, storeCalls)

    // (c) Forget deletes the stored credential.
    const cleared = await withStore.handle('clearToken', {})
    check('clearToken reports cleared', cleared?.cleared === true, cleared)
    equal('clearToken unsets GITHUB_TOKEN', storeCalls, [['unset', 'GITHUB_TOKEN']])

    // (d) A host without the service refuses the save rather than pretending.
    const unavailable = await withoutStore.handle('saveToken', { token: 'ghp_x' }).then(
      () => null,
      (error) => error,
    )
    check(
      'saveToken without a credentials service is credential-unavailable',
      unavailable?.code === 'credential-unavailable' && unavailable?.status === 501,
      unavailable,
    )

    // (e)/(f) What rides on the wire: the stored token when the request has
    // none, the request's own when it does, and the store is asked per call so
    // a changed credential reaches the very next request without a restart.
    const realFetch = global.fetch
    const tokenCalls = []
    global.fetch = async (url, init) => {
      tokenCalls.push({ url: String(url), auth: init?.headers?.authorization ?? null })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ full_name: 'example/token-fixture', default_branch: 'main', owner: { avatar_url: null } }),
      }
    }
    try {
      storeCalls.length = 0
      const stored = await withStore.handle('github', { path: dir, action: 'repo' })
      check('the github action authorises from the stored token', stored.authorized === true && tokenCalls.length === 1, stored)
      check('a request with no token uses the stored one', tokenCalls[0]?.auth === 'Bearer stored-token', tokenCalls[0])

      await withStore.handle('github', { path: dir, action: 'repo' })
      check(
        'the store is read once per github action, not cached',
        storeCalls.filter((call) => call[0] === 'resolve').length === 2,
        storeCalls,
      )

      tokenCalls.length = 0
      await withStore.handle('github', { path: dir, action: 'repo', token: 'request-token' })
      check('a request token wins over the stored one', tokenCalls[0]?.auth === 'Bearer request-token', tokenCalls[0])

      // The environment stays the last resort, and never outranks the store.
      const savedEnvToken = process.env.GITHUB_TOKEN
      process.env.GITHUB_TOKEN = 'env-token'
      try {
        tokenCalls.length = 0
        await withStore.handle('github', { path: dir, action: 'repo' })
        check('the store outranks an ambient environment token', tokenCalls[0]?.auth === 'Bearer stored-token', tokenCalls[0])
        tokenCalls.length = 0
        await withoutStore.handle('github', { path: dir, action: 'repo' })
        check('without a store the environment token still answers', tokenCalls[0]?.auth === 'Bearer env-token', tokenCalls[0])
      } finally {
        if (savedEnvToken === undefined) delete process.env.GITHUB_TOKEN
        else process.env.GITHUB_TOKEN = savedEnvToken
      }
    } finally {
      global.fetch = realFetch
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

console.log('\n# commit diff (one history row → one tab)')
{
  // A repository written for this section only: the shape a history row needs
  // (root commit, a one-line edit, a rename, a deletion, a binary and a merge)
  // is easier to state here than to tease out of the shared fixture.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-commitdiff-'))
  const revParse = async () => String((await exec(dir, ['rev-parse', 'HEAD'])).stdout).trim()
  try {
    await exec(dir, ['init', '-b', 'main'])
    await exec(dir, ['config', 'user.email', 'dev@example.com'])
    await exec(dir, ['config', 'user.name', 'Dev'])
    await exec(dir, ['config', 'commit.gpgsign', 'false'])

    await writeFile(join(dir, 'README.md'), '# fixture\nfirst line\nsecond line\n')
    await writeFile(join(dir, 'name with space.txt'), 'spaces are fine\nsecond line\nthird line\n')
    await writeFile(join(dir, 'b[br]acket.txt'), 'weird name\n')
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-m', 'root commit'])
    const rootSha = await revParse()

    const root = await actions.handle('commitDiff', { path: dir, sha: rootSha })
    check('commitDiff resolves the commit', root.sha === rootSha, root.sha)
    check('commitDiff carries the subject', root.subject === 'root commit', root.subject)
    check('a root commit has no parents', Array.isArray(root.parents) && root.parents.length === 0, root.parents)
    check('commitDiff lists every file the commit touched', root.total === 4 && root.files.length === 4, { total: root.total, files: root.files.map((file) => file.path) })
    check('a new file reads as an addition', root.files.every((file) => file.status === 'A'), root.files.map((file) => `${file.path}:${file.status}`))
    check('the patch carries the commit’s lines', root.files.find((file) => file.path === 'README.md')?.patch.includes('+first line'), root.files.find((file) => file.path === 'README.md')?.patch)
    check('a path with spaces is read whole', root.files.some((file) => file.path === 'name with space.txt'), root.files.map((file) => file.path))
    check('a bracketed path is literal, not a glob', root.files.some((file) => file.path === 'b[br]acket.txt'), root.files.map((file) => file.path))
    const rootBinary = root.files.find((file) => file.path === 'bin.dat')
    check('a binary file is flagged', rootBinary?.binary === true, rootBinary?.patch)
    check('a binary file has no line counts to add', rootBinary?.additions === 0 && rootBinary?.deletions === 0, rootBinary)

    // A short id is enough to ask; the answer names the full one.
    const shortened = await actions.handle('commitDiff', { path: dir, sha: rootSha.slice(0, 7) })
    check('a short sha resolves to the full commit', shortened.sha === rootSha, shortened.sha)

    // One changed line in a long file: the tab must carry the change and its
    // context, never the file. This is the "僅變更" half of the feature.
    const longLines = Array.from({ length: 60 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`)
    await writeFile(join(dir, 'long.txt'), `${longLines.join('\n')}\n`)
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-m', 'add a long file'])
    longLines[39] = 'line-40 changed'
    await writeFile(join(dir, 'long.txt'), `${longLines.join('\n')}\n`)
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-m', 'edit line forty'])
    const editSha = await revParse()
    const edit = await actions.handle('commitDiff', { path: dir, sha: editSha })
    check('only the touched file is in the commit', edit.files.length === 1 && edit.files[0].path === 'long.txt', edit.files.map((file) => file.path))
    const longPatch = edit.files[0]?.patch ?? ''
    check('a one-line edit is one hunk', (longPatch.match(/^@@/gm) ?? []).length === 1, longPatch)
    check('the hunk starts at the change, not at the top of the file', /^@@ -37,7 \+37,7 @@/m.test(longPatch), longPatch.split('\n').find((line) => line.startsWith('@@')))
    check('the changed line is in the patch', longPatch.includes('+line-40 changed'), longPatch)
    check('the rest of the file is not', longPatch.includes('line-01') === false && longPatch.includes('line-60') === false, longPatch.slice(0, 200))

    // Rename (with an edit), delete and a binary edit in one commit.
    await exec(dir, ['mv', 'name with space.txt', 'renamed file.txt'])
    await writeFile(join(dir, 'renamed file.txt'), 'spaces are still fine\nsecond line\nthird line\n')
    await rm(join(dir, 'b[br]acket.txt'), { force: true })
    await writeFile(join(dir, 'bin.dat'), Buffer.from([9, 9, 9, 9]))
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-m', 'rename, delete, binary'])
    const mixedSha = await revParse()
    const mixed = await actions.handle('commitDiff', { path: dir, sha: mixedSha })
    const renamed = mixed.files.find((file) => file.path === 'renamed file.txt')
    check('a rename stays one file with its old path', renamed?.status === 'R' && renamed?.oldPath === 'name with space.txt', renamed)
    check('the rename patch says so', renamed?.patch.includes('rename from name with space.txt'), renamed?.patch)
    check('a rename with edits keeps its hunks', renamed?.patch.includes('+spaces are still fine'), renamed?.patch)
    check('a deletion keeps its own status', mixed.files.find((file) => file.path === 'b[br]acket.txt')?.status === 'D', mixed.files.map((file) => `${file.path}:${file.status}`))
    check('a modified binary stays flagged', mixed.files.find((file) => file.path === 'bin.dat')?.binary === true, mixed.files)
    check('the stat line covers the whole commit', mixed.additions === 1 && mixed.deletions === 2, { additions: mixed.additions, deletions: mixed.deletions })

    // A chmod-only commit: the patch carries no hunk, and the tab says what
    // changed rather than "no textual difference".
    //
    // `update-index --chmod` writes the mode to the index only. On a filesystem
    // that records the executable bit (`core.fileMode=true`, i.e. macOS and
    // Linux) the worktree file stays 644, so the file is left dirty and the next
    // `git add -A` in this script sweeps it into an unrelated commit. Windows
    // hides that because it does not track the bit at all.
    await exec(dir, ['update-index', '--chmod=+x', 'long.txt'])
    await chmod(join(dir, 'long.txt'), 0o755)
    await exec(dir, ['commit', '-m', 'make long.txt executable'])
    const modeSha = await revParse()
    const mode = await actions.handle('commitDiff', { path: dir, sha: modeSha })
    check('a mode-only change is still a file row', mode.total === 1 && mode.files[0]?.path === 'long.txt', mode.files)
    check('the mode change is in the patch', /^old mode 100644$/m.test(mode.files[0]?.patch ?? '') && /^new mode 100755$/m.test(mode.files[0]?.patch ?? ''), mode.files[0]?.patch)
    check('a mode-only change has no line counts', mode.additions === 0 && mode.deletions === 0, mode)

    // A merge is the first-parent change, exactly like the hover card's stat.
    await exec(dir, ['switch', '-c', 'side'])
    await writeFile(join(dir, 'side.txt'), 'side line\n')
    await exec(dir, ['add', 'side.txt'])
    await exec(dir, ['commit', '-m', 'side work'])
    await exec(dir, ['switch', 'main'])
    await exec(dir, ['merge', '--no-ff', '--no-edit', 'side'])
    const mergeSha = await revParse()
    const merge = await actions.handle('commitDiff', { path: dir, sha: mergeSha })
    check('a merge reports both parents', merge.merge === true && merge.parents.length === 2, merge.parents)
    check('a merge is diffed against its first parent', merge.total === 1 && merge.files[0]?.path === 'side.txt', merge.files.map((file) => file.path))
    check('the merged file carries its added line', merge.files[0]?.patch.includes('+side line'), merge.files[0]?.patch)

    await exec(dir, ['commit', '--allow-empty', '-m', 'nothing to change'])
    const emptySha = await revParse()
    const empty = await actions.handle('commitDiff', { path: dir, sha: emptySha })
    check('an empty commit has no files', empty.files.length === 0 && empty.total === 0, empty)

    // The cap: a commit larger than the tab draws is still counted in full,
    // and the tab is told that it only holds the first block of patches.
    await mkdir(join(dir, 'bulk'), { recursive: true })
    for (let index = 0; index < 65; index += 1) {
      await writeFile(join(dir, 'bulk', `f-${String(index).padStart(2, '0')}.txt`), `line ${index}\n`)
    }
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-m', 'sixty-five new files'])
    const bulkSha = await revParse()
    const bulk = await actions.handle('commitDiff', { path: dir, sha: bulkSha })
    check('a commit past the cap still reports every file', bulk.total === 65, bulk.total)
    check('only the first sixty patches are read', bulk.files.length === 60, bulk.files.length)
    check('the tab is told the list is truncated', bulk.truncated === true, bulk.truncated)
    check('the stat line still covers the whole commit', bulk.additions === 65, bulk.additions)

    const invalid = await actions.handle('commitDiff', { path: dir, sha: 'not-a-sha' }).then(
      () => 'resolved',
      () => 'rejected',
    )
    equal('a commit id that is not hex is refused', invalid, 'rejected')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

console.log('\n# edge states (own fixtures)')
{
  const edge = await mkdtemp(join(tmpdir(), 'dsh-git-edge-'))
  const bare = join(edge, 'bare.git')
  const work = join(edge, 'work')
  try {
    // A bare repository has no worktree, so `rev-parse --show-toplevel` fails
    // outright; the probe used to read that failure as "not a repository".
    await exec(edge, ['init', '--bare', '--quiet', bare])
    const bareProbe = await git.probe(bare)
    check('a bare repository is still recognised', bareProbe.isRepo === true && bareProbe.bare === true, bareProbe)

    await exec(edge, ['init', '--quiet', '-b', 'main', work])
    await exec(work, ['config', 'user.email', 'dev@example.com'])
    await exec(work, ['config', 'user.name', 'Dev'])
    await exec(work, ['config', 'commit.gpgsign', 'false'])
    await writeFile(join(work, 'a.txt'), 'one\n')
    await exec(work, ['add', '-A'])
    await exec(work, ['commit', '--quiet', '-m', 'base'])

    // A detached HEAD has no branch name; `push` must refuse rather than build
    // `--set-upstream origin null`.
    const baseSha = String((await exec(work, ['rev-parse', 'HEAD'])).stdout).trim()
    await exec(work, ['checkout', '--quiet', baseSha])
    const detached = await git.status(work)
    const pushError = await git.push(work, detached.branch, detached.upstream).then(
      () => null,
      (thrown) => thrown,
    )
    check('push from a detached HEAD is refused', pushError?.name === 'GitError', pushError?.message)
    check('the refusal names the way out', /detached/i.test(String(pushError?.message ?? '')), pushError?.message)
    check('the detached refusal carries detached-head code', pushError?.code === 'detached-head' && pushError?.status === 409, { code: pushError?.code, status: pushError?.status })
    await exec(work, ['checkout', '--quiet', 'main'])

    // A merge commit has no diff of its own; `git show --numstat` printed
    // nothing, so the hover card claimed "0 files, +0 -0".
    await exec(work, ['checkout', '--quiet', '-b', 'side'])
    await writeFile(join(work, 'side.txt'), 'side\n')
    await exec(work, ['add', '-A'])
    await exec(work, ['commit', '--quiet', '-m', 'side work'])
    await exec(work, ['checkout', '--quiet', 'main'])
    await writeFile(join(work, 'main.txt'), 'main\n')
    await exec(work, ['add', '-A'])
    await exec(work, ['commit', '--quiet', '-m', 'main work'])
    await exec(work, ['merge', '--no-ff', '--no-edit', '--quiet', 'side'])
    const mergeDetail = await git.commitDetail(work, 'HEAD')
    check('a merge commit reports the files it brought in', mergeDetail.files > 0, mergeDetail)
    check('a merge commit reports its line counts', mergeDetail.additions > 0, mergeDetail)

    // Conflicted merge: `abortMerge` is the panel's only way out.
    await writeFile(join(work, 'clash.txt'), 'base\n')
    await exec(work, ['add', '-A'])
    await exec(work, ['commit', '--quiet', '-m', 'clash base'])
    await exec(work, ['checkout', '--quiet', '-b', 'clash-side'])
    await writeFile(join(work, 'clash.txt'), 'theirs\n')
    await exec(work, ['commit', '--quiet', '-am', 'theirs'])
    await exec(work, ['checkout', '--quiet', 'main'])
    await writeFile(join(work, 'clash.txt'), 'ours\n')
    await exec(work, ['commit', '--quiet', '-am', 'ours'])
    await exec(work, ['merge', 'clash-side'])
    const conflicted = await git.status(work)
    check('the fixture is really in conflict', conflicted.conflicts.length > 0, conflicted.conflicts)
    const aborted = await git.abortMerge(work)
    check('abortMerge reports back', typeof aborted.summary === 'string', aborted)
    const clean = await git.status(work)
    check('the merge is gone after aborting', clean.conflicts.length === 0, clean.conflicts)
    check('aborting restored the branch', clean.branch === 'main', clean.branch)

    // Branch names may contain `|` on the platforms that allow the byte, and
    // that character used to be the field separator.
    const piped = await exec(work, ['branch', 'a|b'])
    const listed = await git.branches(work)
    check('the branch list survives a pipe in a name', listed.branches.every((row) => typeof row.name === 'string' && row.name !== ''), listed.branches)
    if (piped.code === 0) {
      check('a piped branch name reaches the panel intact', listed.branches.some((row) => row.name === 'a|b'), listed.branches.map((row) => row.name))
    }
    const detailPiped = await git.branchDetail(work, listed.branches[0].name)
    check('branchDetail parses without the pipe separator', detailPiped.exists === true && detailPiped.branch === listed.branches[0].name, detailPiped)
  } finally {
    await rm(edge, { recursive: true, force: true })
  }
}

console.log('\n# input and destination guards')
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-guard-'))
  const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-git-guard-outside-'))
  try {
    await exec(dir, ['init', '-q', '-b', 'main'])
    await exec(dir, ['config', 'user.email', 'dev@example.com'])
    await exec(dir, ['config', 'user.name', 'Dev'])
    await exec(dir, ['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'a.txt'), 'one\n')
    await exec(dir, ['add', '-A'])
    await exec(dir, ['commit', '-q', '-m', 'base'])
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    await writeFile(join(outsideDir, 'secret.txt'), 'TOP SECRET\n')
    await symlink(outsideDir, join(dir, 'etc'), 'dir')
    await symlink(join(dir, '.git'), join(dir, 'gitdir'), 'dir')

    const insideDiff = await actions.handle('diff', { path: dir, file: 'a.txt' })
    check('a normal repo-relative diff still works', insideDiff.patch.includes('+two'), insideDiff.patch)

    const dotgit = await actions.handle('diff', { path: dir, file: '.git/config' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('diff refuses .git/config with unsafe-path', dotgit?.code === 'unsafe-path', dotgit)
    const dotdot = await actions.handle('diff', { path: dir, file: '../outside.txt' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('diff refuses a .. segment with unsafe-path', dotdot?.code === 'unsafe-path', dotdot)
    const absolute = await actions.handle('diff', { path: dir, file: '/etc/hosts' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('diff refuses an absolute path with unsafe-path', absolute?.code === 'unsafe-path', absolute)
    const symlinkDiff = await actions.handle('diff', { path: dir, file: 'etc/secret.txt' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('diff refuses a directory symlink that escapes the repo', symlinkDiff?.code === 'unsafe-path', symlinkDiff)
    const gitdirDiff = await actions.handle('diff', { path: dir, file: 'gitdir/config' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('diff refuses a symlink into the git directory', gitdirDiff?.code === 'unsafe-path', gitdirDiff)
    const stagedEscape = await actions.handle('stage', { path: dir, files: ['../outside.txt'] }).then(
      () => null,
      (thrown) => thrown,
    )
    check('stage refuses a .. segment with unsafe-path', stagedEscape?.code === 'unsafe-path', stagedEscape)
    await writeFile(join(dir, '.git', 'index.lock'), '')
    const locked = await actions.handle('stage', { path: dir, files: ['a.txt'] }).then(
      () => null,
      (thrown) => thrown,
    )
    check('an index lock reports locked with 409', locked?.code === 'locked' && locked?.status === 409, locked)
    await rm(join(dir, '.git', 'index.lock'), { force: true })

    const pwn = join(dir, 'pwn.txt')
    const injection = await actions.handle('commitDetail', { path: dir, sha: `--output=${pwn}` }).then(
      () => null,
      (thrown) => thrown,
    )
    check(
      'commitDetail refuses a sha that is a git option',
      injection?.code === 'invalid-argument' && existsSync(pwn) === false,
      { error: injection?.message, wrote: existsSync(pwn) },
    )
    const optionBranch = await actions.handle('branchDetail', { path: dir, branch: '--all' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('branchDetail refuses an option-shaped branch', optionBranch?.code === 'invalid-argument', optionBranch)
    const detach = await actions.handle('switch', { path: dir, branch: '--detach' }).then(
      () => null,
      (thrown) => thrown,
    )
    const stillMain = (await git.status(dir)).branch === 'main'
    check('switch refuses an option-shaped branch without moving HEAD', detach?.code === 'invalid-argument' && stillMain, detach)
    const optionRemote = await actions.handle('fetch', { path: dir, remote: '--all' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('fetch refuses an option-shaped remote', optionRemote?.code === 'invalid-argument', optionRemote)

    const weirdLimit = await actions.handle('log', { path: dir, limit: 'not-a-number' })
    check('a non-numeric log limit falls back instead of hiding history', weirdLimit.commits.length === 1, weirdLimit)

    // A local path remote is not GitHub; it must not receive the token and it
    // must not be turned into a fake api.github.com slug.
    const realFetch = global.fetch
    let localCalls = 0
    global.fetch = async () => {
      localCalls += 1
      return { ok: true, status: 200, text: async () => '{}' }
    }
    try {
      await exec(dir, ['remote', 'add', 'origin', 'file:///tmp/example.git'])
      const localRemote = await actions.handle('github', { path: dir, action: 'repo', token: 'ghp_local' })
      check(
        'a file:// remote is not treated as GitHub and sends no token',
        localRemote.authorized === false && localRemote.reason === 'unsupported-host' && localCalls === 0,
        localRemote,
      )
    } finally {
      global.fetch = realFetch
      await exec(dir, ['remote', 'remove', 'origin'])
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  }
}

console.log('\n# state machine, sync and stash')
{
  const base = await mkdtemp(join(tmpdir(), 'dsh-git-state-'))
  const configure = async (repo) => {
    await exec(repo, ['config', 'user.email', 'dev@example.com'])
    await exec(repo, ['config', 'user.name', 'Dev'])
    await exec(repo, ['config', 'commit.gpgsign', 'false'])
  }
  try {
    // ---- bare ------------------------------------------------------------
    const bare = join(base, 'bare.git')
    await exec(base, ['init', '--bare', '-q', '-b', 'main', bare])
    commandLog.length = 0
    const bareStatus = await actions.handle('status', { path: bare })
    check(
      'bare status returns bare:true with empty lists',
      bareStatus.isRepo === true && bareStatus.bare === true && bareStatus.changes.length === 0 && bareStatus.conflicts.length === 0,
      bareStatus,
    )
    check(
      'bare status carries no operation or error code',
      bareStatus.operation === null && bareStatus.code === undefined && bareStatus.staged.length === 0,
      { operation: bareStatus.operation, code: bareStatus.code, staged: bareStatus.staged },
    )
    check(
      'bare status does not run git status',
      commandLog.every((line) => /^git status( |$)/.test(line) === false),
      commandLog.slice(0, 12),
    )
    const bareStage = await actions.handle('stage', { path: bare, files: ['a.txt'] }).then(
      () => null,
      (thrown) => thrown,
    )
    check('a write in a bare repo is refused with bare-readonly', bareStage?.code === 'bare-readonly', bareStage)
    const bareCommit = await actions.handle('commit', { path: bare, message: 'x' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('commit in a bare repo is refused with bare-readonly', bareCommit?.code === 'bare-readonly', bareCommit)
    const bareInit = await actions.handle('init', { path: bare }).then(
      () => null,
      (thrown) => thrown,
    )
    check('init in a bare repo is refused with bare-readonly', bareInit?.code === 'bare-readonly', bareInit)
    const coreBare = String((await exec(bare, ['config', '--get', 'core.bare'])).stdout).trim()
    check('the refused init leaves the repository bare', coreBare === 'true', coreBare)

    // ---- merge conflict and commit gate ----------------------------------
    const mergeRepo = join(base, 'merge')
    await exec(base, ['init', '-q', '-b', 'main', mergeRepo])
    await configure(mergeRepo)
    await writeFile(join(mergeRepo, 'clash.txt'), 'base\n')
    await exec(mergeRepo, ['add', '-A'])
    await exec(mergeRepo, ['commit', '-q', '-m', 'base'])
    await exec(mergeRepo, ['switch', '-q', '-c', 'side'])
    await writeFile(join(mergeRepo, 'clash.txt'), 'side\n')
    await exec(mergeRepo, ['commit', '-q', '-am', 'side'])
    await exec(mergeRepo, ['switch', '-q', 'main'])
    await writeFile(join(mergeRepo, 'clash.txt'), 'main\n')
    await exec(mergeRepo, ['commit', '-q', '-am', 'main'])
    await exec(mergeRepo, ['merge', 'side'])
    const conflicted = await actions.handle('status', { path: mergeRepo })
    check('status reports an in-progress merge', conflicted.operation === 'merge', conflicted.operation)
    check('status lists the conflict', conflicted.conflicts.length > 0, conflicted.conflicts)
    const blockedCommit = await actions.handle('commit', { path: mergeRepo, message: 'merged' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('commit refuses unresolved conflicts', blockedCommit?.code === 'unresolved-conflicts', blockedCommit)
    await writeFile(join(mergeRepo, 'clash.txt'), 'resolved\n')
    await exec(mergeRepo, ['add', 'clash.txt'])
    const resolvedCommit = await actions.handle('commit', { path: mergeRepo, message: 'merge resolved' })
    check('a resolved merge can be committed from the panel', typeof resolvedCommit.sha === 'string' && resolvedCommit.sha !== null, resolvedCommit)
    const afterResolved = await actions.handle('status', { path: mergeRepo })
    check('the merge operation is gone after committing', afterResolved.operation === null, afterResolved.operation)

    // ---- rebase in progress ----------------------------------------------
    const rebaseRepo = join(base, 'rebase')
    await exec(base, ['init', '-q', '-b', 'main', rebaseRepo])
    await configure(rebaseRepo)
    await writeFile(join(rebaseRepo, 'clash.txt'), 'base\n')
    await exec(rebaseRepo, ['add', '-A'])
    await exec(rebaseRepo, ['commit', '-q', '-m', 'base'])
    await exec(rebaseRepo, ['switch', '-q', '-c', 'side'])
    await writeFile(join(rebaseRepo, 'clash.txt'), 'side\n')
    await exec(rebaseRepo, ['commit', '-q', '-am', 'side'])
    await exec(rebaseRepo, ['switch', '-q', 'main'])
    await writeFile(join(rebaseRepo, 'clash.txt'), 'main\n')
    await exec(rebaseRepo, ['commit', '-q', '-am', 'main'])
    await exec(rebaseRepo, ['rebase', 'side'])
    const rebasing = await actions.handle('status', { path: rebaseRepo })
    check('status reports an in-progress rebase', rebasing.operation === 'rebase', rebasing.operation)
    const rebaseCommit = await actions.handle('commit', { path: rebaseRepo, message: 'during rebase' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('commit during a rebase is refused with operation-in-progress', rebaseCommit?.code === 'operation-in-progress', rebaseCommit)
    await exec(rebaseRepo, ['rebase', '--abort'])

    // ---- diverged pull: ff refuses, merge succeeds -----------------------
    const remote = join(base, 'remote.git')
    await exec(base, ['init', '--bare', '-q', '-b', 'main', remote])
    const local = join(base, 'local')
    const peer = join(base, 'peer')
    await exec(base, ['init', '-q', '-b', 'main', local])
    await configure(local)
    await writeFile(join(local, 'seed.txt'), 'seed\n')
    await exec(local, ['add', '-A'])
    await exec(local, ['commit', '-q', '-m', 'seed'])
    await exec(local, ['remote', 'add', 'origin', remote])
    await exec(local, ['push', '-q', '-u', 'origin', 'main'])
    await exec(base, ['clone', '-q', remote, peer])
    await configure(peer)
    await writeFile(join(local, 'local.txt'), 'local\n')
    await exec(local, ['add', '-A'])
    await exec(local, ['commit', '-q', '-m', 'local work'])
    await writeFile(join(peer, 'peer.txt'), 'peer\n')
    await exec(peer, ['add', '-A'])
    await exec(peer, ['commit', '-q', '-m', 'peer work'])
    await exec(peer, ['push', '-q', 'origin', 'main'])
    await exec(local, ['fetch', '-q', 'origin'])
    const diverged = await actions.handle('status', { path: local })
    check('diverged status reports ahead/behind', diverged.ahead === 1 && diverged.behind === 1, { ahead: diverged.ahead, behind: diverged.behind })
    const rejectedPush = await actions.handle('push', { path: local }).then(
      () => null,
      (thrown) => thrown,
    )
    check('a non-fast-forward push reports non-fast-forward', rejectedPush?.code === 'non-fast-forward' && rejectedPush?.status === 409, rejectedPush)
    // Push one more peer commit so the pull's fetch prints "From <remote>"
    // first; the non-fast-forward reason is only on a later stderr line.
    await writeFile(join(peer, 'peer2.txt'), 'peer2\n')
    await exec(peer, ['add', '-A'])
    await exec(peer, ['commit', '-q', '-m', 'peer second'])
    await exec(peer, ['push', '-q', 'origin', 'main'])
    const ffPull = await actions.handle('pull', { path: local, mode: 'ff' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('ff-only pull reports non-fast-forward', ffPull?.code === 'non-fast-forward', ffPull)
    check('ff-only pull does not surface the fetch progress line as the error', String(ffPull?.message ?? '').startsWith('From ') === false, ffPull?.message)
    check(
      'the regression fixture really emitted fetch progress before the fatal line',
      String(ffPull?.details?.stderr ?? '').startsWith('From '),
      String(ffPull?.details?.stderr ?? '').slice(0, 120),
    )
    const merged = await actions.handle('pull', { path: local, mode: 'merge' })
    check('merge pull succeeds and reports its mode', merged.mode === 'merge' && merged.conflicts === false, merged)

    // ---- stash push / pop / count ----------------------------------------
    await writeFile(join(local, 'seed.txt'), 'changed\n')
    const zero = await actions.handle('stash', { path: local, op: 'count' })
    check('stash count starts at zero', zero.op === 'count' && zero.count === 0, zero)
    const pushedStash = await actions.handle('stash', { path: local, op: 'push', message: 'wip' })
    check('stash push saves one entry', pushedStash.op === 'push' && pushedStash.stashed === true && pushedStash.count === 1, pushedStash)
    const afterPush = await actions.handle('status', { path: local })
    check('the worktree is clean after stash push', afterPush.changes.length === 0, afterPush.changes)
    const popped = await actions.handle('stash', { path: local, op: 'pop' })
    check('stash pop restores without conflict', popped.op === 'pop' && popped.conflicts === false && popped.count === 0, popped)
    const emptyPop = await actions.handle('stash', { path: local, op: 'pop' }).then(
      () => null,
      (thrown) => thrown,
    )
    check('popping an empty stash reports stash-empty', emptyPop?.code === 'stash-empty', emptyPop)

    // A real pop conflict: stash a change, commit a different change to the
    // same file, then pop. The stash entry is kept and status lists the file.
    await exec(local, ['add', 'seed.txt'])
    await exec(local, ['commit', '-q', '-m', 'stash base'])
    await writeFile(join(local, 'seed.txt'), 'stashed version\n')
    const conflictSource = await actions.handle('stash', { path: local, op: 'push', message: 'conflicting' })
    check('the conflicting stash was saved', conflictSource.stashed === true && conflictSource.count === 1, conflictSource)
    await writeFile(join(local, 'seed.txt'), 'committed version\n')
    await exec(local, ['commit', '-q', '-am', 'conflicting commit'])
    const conflictPop = await actions.handle('stash', { path: local, op: 'pop' })
    check('a conflicting stash pop reports conflicts:true', conflictPop.conflicts === true, conflictPop)
    const conflictStatus = await actions.handle('status', { path: local })
    check(
      'the conflicting pop lists the file in status.conflicts',
      conflictStatus.conflicts.some((row) => row.path === 'seed.txt'),
      conflictStatus.conflicts,
    )

    // ---- GitHub timeout ---------------------------------------------------
    await exec(mergeRepo, ['remote', 'add', 'origin', 'https://github.com/example/timeout.git'])
    const realFetch = global.fetch
    global.fetch = async () => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    }
    try {
      const timeout = await actions.handle('github', { path: mergeRepo, action: 'repo', token: 'ghp_timeout' }).then(
        () => null,
        (thrown) => thrown,
      )
      check('a GitHub timeout maps to code timeout and status 504', timeout?.code === 'timeout' && timeout?.status === 504, timeout)
    } finally {
      global.fetch = realFetch
      await exec(mergeRepo, ['remote', 'remove', 'origin'])
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

console.log('\n# http route guards')
{
  const { apply } = await import('../src/index.js')
  const { mkdtemp: mkTmp } = await import('node:fs/promises')
  const inside = await mkTmp(join(tmpdir(), 'dsh-git-inside-'))
  const outside = await mkTmp(join(tmpdir(), 'dsh-git-outside-'))
  const sibling = `${inside}-evil`
  await mkdir(sibling, { recursive: true })
  await mkdir(join(inside, 'nested'), { recursive: true })
  await mkdir(join(inside, 'plain'), { recursive: true })
  const escapeLink = join(inside, 'escape-link')
  await symlink(outside, escapeLink, 'dir')
  let handler = null
  const fakeRes = () => {
    const answer = { status: 0, body: '' }
    return {
      answer,
      writeHead(status) {
        answer.status = status
      },
      end(body) {
        answer.body = String(body ?? '')
      },
    }
  }
  const call = async (options) => {
    const chunks = options.rawBody !== undefined ? [Buffer.from(options.rawBody)] : options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
    const req = {
      method: options.method ?? 'POST',
      headers: { host: '127.0.0.1:43129', ...(options.headers ?? {}) },
      socket: options.socket ?? { localAddress: '127.0.0.1', localPort: 43129 },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
    const res = fakeRes()
    await handler(req, res)
    return res.answer
  }
  const fakeCtx = {
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ id: 'w1', title: 'inside', path: inside }] } : undefined),
    inject: (deps, callback) => callback({ webServer: { register: (declaration) => (handler = declaration.handler, () => {}) }, subprocess: { spawn: () => ({ done: Promise.resolve({ exitCode: 1 }), collected: { stdout: null, stderr: null } }) } }),
    effect: (fn) => fn(),
  }
  try {
    apply(fakeCtx)
    check('the route registered a handler', typeof handler === 'function')
    const ok = await call({ body: { action: 'repos', params: {} }, headers: { 'content-type': 'application/json' } })
    check('a JSON request from the panel is served', ok.status === 200, ok)
    const plain = await call({ body: { action: 'repos', params: {} }, headers: { 'content-type': 'text/plain' } })
    check('a text/plain body is refused (forces a preflight)', plain.status === 415 && JSON.parse(plain.body).code === 'unsupported-media-type', plain)
    const noType = await call({ body: { action: 'repos', params: {} } })
    check('a body with no content-type is refused', noType.status === 415, noType)
    const crossPath = await call({ body: { action: 'status', params: { path: outside } }, headers: { 'content-type': 'application/json' } })
    check('a path outside the registered workspaces is refused', crossPath.status === 403 && JSON.parse(crossPath.body).code === 'outside-workspace', crossPath)
    const siblingPath = await call({ body: { action: 'repos', params: { path: sibling } }, headers: { 'content-type': 'application/json' } })
    check('a prefix that is not a subdirectory is refused', siblingPath.status === 403, siblingPath)
    const insideCall = await call({ body: { action: 'repos', params: { path: join(inside, 'nested') } }, headers: { 'content-type': 'application/json' } })
    check('the registered workspace itself is allowed', insideCall.status === 200, insideCall.status)

    const health = await call({ method: 'GET' })
    check('GET health reports version 2', health.status === 200 && JSON.parse(health.body).version === 2, health)
    const unknown = await call({ body: { action: 'nope', params: {} }, headers: { 'content-type': 'application/json' } })
    check('an unknown action is 404 with unknown-action code', unknown.status === 404 && JSON.parse(unknown.body).code === 'unknown-action', unknown)
    const invalidJson = await call({ rawBody: '{', headers: { 'content-type': 'application/json' } })
    check('invalid JSON is 400 with invalid-argument code', invalidJson.status === 400 && JSON.parse(invalidJson.body).code === 'invalid-argument', invalidJson)
    const gitFailure = await call({
      body: { action: 'commit', params: { path: join(inside, 'plain'), message: 'x' } },
      headers: { 'content-type': 'application/json' },
    })
    const gitFailureBody = JSON.parse(gitFailure.body)
    check(
      'a git failure carries code and argv/exitCode details',
      gitFailure.status === 400 &&
        gitFailureBody.code === 'git-error' &&
        Array.isArray(gitFailureBody.details?.argv) &&
        gitFailureBody.details?.exitCode === 1,
      gitFailure,
    )

    const traversal = await call({ body: { action: 'repos', params: { path: `${inside}/..` } }, headers: { 'content-type': 'application/json' } })
    check('a .. segment is refused as outside-workspace', traversal.status === 403 && JSON.parse(traversal.body).code === 'outside-workspace', traversal)
    const symlinkCall = await call({ body: { action: 'repos', params: { path: escapeLink } }, headers: { 'content-type': 'application/json' } })
    check('a workspace symlink to outside is refused', symlinkCall.status === 403, symlinkCall)

    // DNS rebinding: Origin and Host agree with each other, but not with the
    // socket the request actually landed on.
    const rebound = await call({
      body: { action: 'repos', params: {} },
      headers: { host: 'evil.example:43129', origin: 'http://evil.example:43129', 'content-type': 'application/json' },
      socket: { localAddress: '127.0.0.1', localPort: 43129 },
    })
    check('a rebound Host is refused', rebound.status === 403 && JSON.parse(rebound.body).code === 'untrusted-host', rebound)
    const loopback = await call({
      body: { action: 'repos', params: {} },
      headers: { host: '127.0.0.1:43129', 'content-type': 'application/json' },
      socket: { localAddress: '127.0.0.1', localPort: 43129 },
    })
    check('a loopback Host with the listening port is allowed', loopback.status === 200, loopback)
    const wrongPort = await call({
      body: { action: 'repos', params: {} },
      headers: { host: '127.0.0.1:9999', 'content-type': 'application/json' },
      socket: { localAddress: '127.0.0.1', localPort: 43129 },
    })
    check('a loopback Host on another port is refused', wrongPort.status === 403 && JSON.parse(wrongPort.body).code === 'untrusted-host', wrongPort)
    const savedAllowedHosts = process.env.DSH_GIT_ALLOWED_HOSTS
    process.env.DSH_GIT_ALLOWED_HOSTS = 'panel.example.com:8443'
    try {
      const proxied = await call({
        body: { action: 'repos', params: {} },
        headers: { host: 'panel.example.com:8443', 'content-type': 'application/json' },
        socket: { localAddress: '127.0.0.1', localPort: 43129 },
      })
      check('an explicitly allowed proxy Host (with its port) is accepted', proxied.status === 200, proxied)
    } finally {
      if (savedAllowedHosts === undefined) delete process.env.DSH_GIT_ALLOWED_HOSTS
      else process.env.DSH_GIT_ALLOWED_HOSTS = savedAllowedHosts
    }
  } finally {
    await rm(inside, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
    await rm(sibling, { recursive: true, force: true })
  }
}

console.log('\n# packaging')
{
  // Every git call above parked its streams here; nothing may touch it before
  // the last one has finished.
  if (outputDir !== '') await rm(outputDir, { recursive: true, force: true })
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  check('host half present after build', existsSync(join(root, 'lib', 'index.js')))
  check('client bundle present after build', existsSync(join(root, 'lib', 'client.js')))
  if (existsSync(join(root, 'lib', 'client.js'))) {
    const bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8')
    check('client bundle registers the module id', bundle.includes('id: "dsh-git-management"'), bundle.slice(0, 120))
    check('client bundle has no ESM import', /^\s*import\s/m.test(bundle) === false)
  }
}

console.log(`\n${checks - failed}/${checks} checks passed`)
if (failed > 0) {
  console.error(`${failed} check(s) failed`)
  process.exitCode = 1
}
