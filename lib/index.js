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

import { stat } from 'node:fs/promises'
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
 * Confirm a path is an existing directory before git is pointed at it.
 * @param path - the candidate.
 * @returns the path, unchanged.
 */
async function requireDirectory(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    const error = new Error('path is required')
    error.status = 400
    throw error
  }
  const info = await stat(path).catch(() => null)
  if (info === null || !info.isDirectory()) {
    const error = new Error(`not a directory: ${path}`)
    error.status = 400
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
              sendJson(res, rejection, { error: rejection === 401 ? 'login required' : 'untrusted origin' })
              return
            }
            if (isCrossOrigin(req)) {
              sendJson(res, 403, { error: 'cross-origin request refused' })
              return
            }
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, plugin: name, version: 1 })
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405, { allow: 'GET, POST' })
              res.end()
              return
            }
            try {
              const body = await readJson(req)
              const action = String(body.action ?? '')
              const params = body.params ?? {}
              if (typeof params.path === 'string') await requireDirectory(params.path)
              const result = await actions.handle(action, {
                ...params,
                token: typeof body.token === 'string' ? body.token : params.token,
              })
              sendJson(res, 200, { ok: true, result })
            } catch (error) {
              const status = Number(error?.status ?? 400)
              sendJson(res, Number.isFinite(status) && status >= 400 && status <= 599 ? status : 400, {
                ok: false,
                error: String(error?.message ?? error),
                details: error?.details?.stderr ? String(error.details.stderr).slice(0, 4000) : undefined,
              })
            }
          },
        }),
      'dsh-git-management: /dsh-git/api route',
    )

    // One line at mount, so the log says which build the process actually
    // loaded — a page reload replaces the browser half but not this one.
    console.log('[dsh-git-management] host ready: /dsh-git/api (status, diff, commit, worktrees, github)')
  })
}
