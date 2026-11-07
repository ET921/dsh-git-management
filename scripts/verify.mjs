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
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod } from 'node:fs/promises'
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

console.log('\n# http route guards')
{
  const { apply } = await import('../src/index.js')
  const { mkdtemp: mkTmp } = await import('node:fs/promises')
  const inside = await mkTmp(join(tmpdir(), 'dsh-git-inside-'))
  const outside = await mkTmp(join(tmpdir(), 'dsh-git-outside-'))
  const sibling = `${inside}-evil`
  await mkdir(sibling, { recursive: true })
  await mkdir(join(inside, 'nested'), { recursive: true })
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
    const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
    const req = {
      method: options.method ?? 'POST',
      headers: { host: '127.0.0.1:43129', ...(options.headers ?? {}) },
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
    check('a text/plain body is refused (forces a preflight)', plain.status === 415, plain)
    const noType = await call({ body: { action: 'repos', params: {} } })
    check('a body with no content-type is refused', noType.status === 415, noType)
    const crossPath = await call({ body: { action: 'status', params: { path: outside } }, headers: { 'content-type': 'application/json' } })
    check('a path outside the registered workspaces is refused', crossPath.status === 403, crossPath)
    const siblingPath = await call({ body: { action: 'repos', params: { path: sibling } }, headers: { 'content-type': 'application/json' } })
    check('a prefix that is not a subdirectory is refused', siblingPath.status === 403, siblingPath)
    const insideCall = await call({ body: { action: 'repos', params: { path: join(inside, 'nested') } }, headers: { 'content-type': 'application/json' } })
    check('the registered workspace itself is allowed', insideCall.status === 200, insideCall.status)
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
