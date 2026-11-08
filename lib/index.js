/**
 * dsh-git-management — host half.
 *
 * Two jobs, both small:
 *
 *   1. Turn one authenticated-by-same-origin HTTP endpoint into the action
 *      table in `actions.js` (the browser half is a page, not a Remote client,
 *      so a plain route is the honest seam; the same shape the community
 *      market plugin uses).
 *   2. Give that table a real `exec`, backed by the harness subprocess service
 *      and the system `git` binary — the same architecture VS Code's built-in
 *      git extension uses, and therefore the same one Cursor inherits.
 *
 * Nothing here holds state between requests: `git status` is the source of
 * truth, exactly as in VS Code. That is what keeps the panel honest when the
 * user also runs git in a terminal.
 *
 * @module dsh-git-management
 */

import { realpath, stat } from 'node:fs/promises'
import { createActions } from './actions.js'
import { createGit, MAX_OUTPUT_BYTES } from './git.js'

/** The package's own id, also the browser module id the build emits. */
export const name = 'dsh-git-management'

/** One exact route; the action name rides in the JSON body. */
const ROUTE = '/dsh-git/api'

/** Largest request body accepted (a commit message, a path, a token). */
const MAX_BODY_BYTES = 256 * 1024

/** POSIX-style grace before a git child is force-killed. */
const GRACE_MS = 5000

/** Ceiling for stderr captured from git (its diagnostics are short). */
const STDERR_BYTES = 256 * 1024

/**
 * Write one JSON response.
 * @param res - the server response.
 * @param status - HTTP status.
 * @param value - JSON-serializable body.
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Read and parse a JSON request body.
 * @param req - the incoming request.
 * @returns the parsed object (an empty object for an empty body).
 */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.status = 413
      error.code = 'payload-too-large'
      throw error
    }
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('invalid JSON body')
    error.status = 400
    error.code = 'invalid-argument'
    throw error
  }
}

/**
 * Refuse a request whose Origin names another site.
 *
 * The panel is a page served by this same host, so anything else — a page on
 * another origin, or a form post from one — has no business driving git. When
 * no Origin header is present (same-origin fetches often omit it) the request
 * is not cross-site by construction and is allowed through.
 *
 * @param req - the incoming request.
 * @returns true when the request must be refused.
 */
function isCrossOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

/**
 * Hosts that can only be this machine, regardless of the platform's spelling.
 * @type {Set<string>}
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Refuse a request whose Host is not this server.
 *
 * The Origin check alone compares two attacker-controlled headers: a DNS
 * rebinding page is same-origin with its own host, so `Origin === Host` passes
 * while the connection actually lands on loopback. The Host header is compared
 * here with the address the socket accepted and the port it listened on; a
 * reverse proxy in front of the panel can name itself in
 * `DSH_GIT_ALLOWED_HOSTS` (comma separated).
 *
 * @param req - the incoming request.
 * @returns true when the request must be refused.
 */
function isUntrustedHost(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host.trim() === '') return true
  let parsed = null
  try {
    parsed = new URL(`http://${host.trim()}`)
  } catch {
    return true
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const local = String(req.socket?.localAddress ?? '')
    .toLowerCase()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '')
  const allowed = String(process.env.DSH_GIT_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '')
  // An operator who names the reverse-proxy host has already chosen the port
  // it is reached on; do not compare it with the loopback listener's port.
  const explicitlyAllowed = allowed.includes(host.trim().toLowerCase())
  if (LOOPBACK_HOSTS.has(hostname) === false && (local === '' || hostname !== local) && explicitlyAllowed === false) {
    return true
  }
  if (explicitlyAllowed === false && parsed.port !== '' && req.socket?.localPort !== undefined && String(req.socket.localPort) !== parsed.port) return true
  return false
}

/** Case-insensitive path comparison only where the platform is. */
const FOLD_CASE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * Whether a path spells a `..` segment.
 * @param path - the raw path.
 * @returns true when a segment is exactly `..`.
 */
function hasTraversal(path) {
  return String(path ?? '')
    .split(/[\\/]+/)
    .some((part) => part === '..')
}

/**
 * Whether a request body may be parsed as JSON.
 *
 * Requiring `application/json` is what forces a CORS preflight: the other
 * content types a browser will send without one (`text/plain`, form encodings)
 * are refused here, so a page on another origin cannot post a body that this
 * route would act on. It is deliberately narrower than an Origin check, whose
 * behaviour differs between hosts.
 *
 * @param req - the incoming request.
 * @returns true when the body may be read.
 */
function isJsonRequest(req) {
  const type = req.headers['content-type']
  if (typeof type !== 'string' || type.trim() === '') return false
  return type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * Resolve a path to its canonical absolute form.
 * @param path - the candidate.
 * @returns the real path, or null when it cannot be resolved.
 */
async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * Confirm a path is an existing directory before git is pointed at it.
 *
 * The canonical path is returned, so every later comparison and every git
 * child works on the same spelling: `/var` and `/private/var` are one place on
 * macOS, and a symlink cannot be used to step outside a workspace.
 *
 * @param path - the candidate.
 * @returns the canonical directory.
 */
async function requireDirectory(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    const error = new Error('path is required')
    error.status = 400
    error.code = 'invalid-argument'
    throw error
  }
  if (hasTraversal(path)) {
    const error = new Error(`path traversal is not allowed: ${path}`)
    error.status = 403
    error.code = 'outside-workspace'
    throw error
  }
  const info = await stat(path).catch(() => null)
  if (info === null || !info.isDirectory()) {
    const error = new Error(`not a directory: ${path}`)
    error.status = 400
    error.code = 'invalid-argument'
    throw error
  }
  const canonical = await canonicalPath(path)
  if (canonical === null) {
    const error = new Error(`not a directory: ${path}`)
    error.status = 400
    error.code = 'invalid-argument'
    throw error
  }
  return canonical
}

/**
 * One comparable form of a canonical path: forward slashes, no trailing slash,
 * and case folded only on the platforms whose filesystems do that.
 * @param path - the raw path.
 * @returns the comparable key.
 */
function pathKey(path) {
  const normalized = String(path ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return FOLD_CASE ? normalized.toLowerCase() : normalized
}

/**
 * Confirm a path belongs to a registered workspace.
 *
 * Every action that takes a `path` ends up running git in that directory, and
 * several of them write (`discard`, `clean -f`, `commit`). Without this the
 * route would drive any repository on the disk for anyone who can reach it.
 * Both sides are canonicalised first: a `..` segment or a symlink that points
 * outside the workspace must not pass a string prefix test. A host that
 * publishes no workspace list (or none yet) keeps the old behaviour rather
 * than locking the panel out of a directory it cannot see.
 *
 * @param path - the canonical repository directory from the request.
 * @param workspaces - the registered workspaces, `[{ path }]`.
 * @returns the path, unchanged.
 */
async function requireWorkspace(path, workspaces) {
  const roots = []
  for (const workspace of workspaces ?? []) {
    if (typeof workspace?.path !== 'string' || workspace.path === '') continue
    const root = await canonicalPath(workspace.path)
    if (root !== null) {
      const key = pathKey(root)
      if (key !== '') roots.push(key)
    }
  }
  if (roots.length === 0) return path
  const candidate = pathKey(path)
  const inside = roots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
  if (inside === false) {
    const error = new Error(`path is outside the registered workspaces: ${path}`)
    error.status = 403
    error.code = 'outside-workspace'
    throw error
  }
  return path
}

/**
 * Refuse a request the host's own connection gate rejects.
 *
 * A route registered on `webServer` sits outside the `/api` prefix the core
 * fence guards, so it has to ask the gate itself. Hosts without a `connection`
 * service (or the Desktop shell, whose page speaks the app protocol) publish
 * no gate, and this is then a pass-through.
 *
 * @param ctx - host context.
 * @param req - the incoming request.
 * @returns a status code to refuse with, or undefined to allow.
 */
function gateRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined
  try {
    const rejection = connection.requestRejection(req)
    return typeof rejection === 'number' ? rejection : undefined
  } catch {
    return 403
  }
}

/** Codes whose failure is a state conflict, not a malformed request. */
const CONFLICT_CODES = new Set(['bare-readonly', 'unresolved-conflicts', 'operation-in-progress', 'non-fast-forward', 'detached-head', 'locked', 'stash-empty'])

/**
 * The HTTP status for one action failure.
 *
 * Codes are the stable part of the contract; the status is derived from them
 * so a client can branch on either. GitHub errors keep the status GitHub gave.
 * @param error - the thrown failure.
 * @returns an HTTP status.
 */
function statusForError(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === 'unknown-action') return 404
  if (code === 'timeout') return 504
  if (code === 'payload-too-large') return 413
  if (code === 'unsupported-media-type') return 415
  if (code === 'outside-workspace' || code === 'untrusted-origin' || code === 'untrusted-host') return 403
  if (CONFLICT_CODES.has(code)) return 409
  const status = Number(error?.status ?? 400)
  return Number.isFinite(status) && status >= 400 && status <= 599 ? status : 400
}

/**
 * The machine-readable part of a failure, without stdout or any token.
 * @param error - the thrown failure.
 * @returns `{ argv?, exitCode?, stderr? }`, or undefined.
 */
function detailsForError(error) {
  const details = error?.details
  if (details === undefined || details === null) return undefined
  const answer = {}
  if (Array.isArray(details.argv)) answer.argv = details.argv.map((value) => String(value))
  const exitCode = Number(details.code)
  if (Number.isFinite(exitCode)) answer.exitCode = exitCode
  if (typeof details.stderr === 'string' && details.stderr.trim() !== '') answer.stderr = details.stderr.slice(0, 4000)
  return Object.keys(answer).length === 0 ? undefined : answer
}

/**
 * Cordis plugin body.
 * @param ctx - host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'subprocess'], (host) => {
    /**
     * Run one git command through the harness subprocess seam.
     *
     * `argv` is an array and the seam never shell-interprets it, so no path or
     * commit message can be spliced into a command line.
     *
     * @param cwd - child working directory.
     * @param args - argv after `git`.
     * @param options - `{ timeoutMs, env }`.
     * @returns `{ code, stdout, stderr }`.
     */
    const exec = async (cwd, args, options = {}) => {
      const controller = new AbortController()
      const timeoutMs = Number(options.timeoutMs ?? 30000)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const handle = host.subprocess.spawn({
          argv: ['git', ...args],
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_OUTPUT_BYTES },
            stderr: { maxBytes: STDERR_BYTES },
          },
          graceMs: GRACE_MS,
          env: {
            // A GUI must never block on a credential prompt, an editor, or a pager.
            GIT_TERMINAL_PROMPT: '0',
            GIT_PAGER: 'cat',
            GIT_EDITOR: 'true',
            GIT_ASKPASS: 'echo',
            // Stable, parseable messages regardless of the user's locale.
            LC_ALL: 'en_US.UTF-8',
            LANG: 'en_US.UTF-8',
            ...(options.env ?? {}),
          },
          signal: controller.signal,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        return { code: outcome.exitCode ?? -1, stdout, stderr, signal: outcome.signal }
      } catch (error) {
        return { code: -1, stdout: '', stderr: String(error?.message ?? error), signal: null }
      } finally {
        clearTimeout(timer)
      }
    }

    const git = createGit(exec)
    const workspaceList = () => {
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined) return []
      return registry.list().map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
      }))
    }
    const actions = createActions({ git, workspaces: workspaceList })

    ctx.effect(
      () =>
        host.webServer.register({
          kind: 'exact',
          path: ROUTE,
          handler: async (req, res) => {
            const rejection = gateRejection(ctx, req)
            if (rejection !== undefined) {
              sendJson(res, rejection, { ok: false, code: 'untrusted-origin', error: rejection === 401 ? 'login required' : 'untrusted origin' })
              return
            }
            if (isCrossOrigin(req)) {
              sendJson(res, 403, { ok: false, code: 'untrusted-origin', error: 'cross-origin request refused' })
              return
            }
            if (isUntrustedHost(req)) {
              sendJson(res, 403, { ok: false, code: 'untrusted-host', error: 'untrusted host' })
              return
            }
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, plugin: name, version: 2 })
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405, { allow: 'GET, POST' })
              res.end()
              return
            }
            try {
              if (isJsonRequest(req) === false) {
                sendJson(res, 415, { ok: false, code: 'unsupported-media-type', error: 'content-type must be application/json' })
                return
              }
              const body = await readJson(req)
              const action = String(body.action ?? '')
              let params = body.params ?? {}
              if (typeof params.path === 'string') {
                const canonical = await requireDirectory(params.path)
                await requireWorkspace(canonical, workspaceList())
                params = { ...params, path: canonical }
              }
              const result = await actions.handle(action, {
                ...params,
                token: typeof body.token === 'string' ? body.token : params.token,
              })
              sendJson(res, 200, { ok: true, result })
            } catch (error) {
              const status = statusForError(error)
              const code = typeof error?.code === 'string' ? error.code : status === 409 ? 'operation-in-progress' : status === 404 ? 'unknown-action' : status === 504 ? 'timeout' : 'git-error'
              sendJson(res, status, {
                ok: false,
                code,
                error: String(error?.message ?? error),
                details: detailsForError(error),
              })
            }
          },
        }),
      'dsh-git-management: /dsh-git/api route',
    )

    // One line at mount, so the log says which build the process actually
    // loaded — a page reload replaces the browser half but not this one.
    console.log('[dsh-git-management] host ready: /dsh-git/api (status, diff, commit, commit diff, worktrees, github)')
  })
}
