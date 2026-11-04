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
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
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

    await writeFile(join(dir, 'README.md'), '# fixture\n\nmore\n')
    snapshot = await git.status(dir)
    check('modification shows as M', snapshot.changes[0]?.status === 'M', snapshot.changes)
    check('line counts reported', snapshot.changes[0]?.additions === 2, snapshot.changes)

    const patch = await git.diff(dir, 'README.md', false)
    check('diff mentions the added line', patch.patch.includes('+more'), patch.patch)

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

    await exec(dir, ['remote', 'add', 'origin', 'https://github.com/example/fixture.git'])
    const remote = await git.remote(dir)
    equal('origin parsed', remote?.slug, 'example/fixture')

    const github = await actions.handle('github', { path: dir, action: 'remote' })
    check('github remote action reports connected', github.connected === true, github)
    const unauthenticated = await actions.handle('github', { path: dir, action: 'repo' })
    check('without a token the API is refused', unauthenticated.authorized === false || process.env.GITHUB_TOKEN !== undefined, unauthenticated)

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

if (outputDir !== '') await rm(outputDir, { recursive: true, force: true })

console.log('\n# packaging')
{
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
