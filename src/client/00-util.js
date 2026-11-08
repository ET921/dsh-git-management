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

/**
 * A keyed group that adds no element. The panel's page children are a mixed
 * list (header, notices, body…); wrapping the notice slice keeps that slot
 * stable, so a notice appearing no longer remounts the card below it.
 */
const Fragment = react.Fragment

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = react

/** Module id: the bundle's id and (by the plugin's own choice) its tab id. */
const PLUGIN_ID = 'dsh-git-management'

/** The host route registered by `src/index.js`. */
const API_ROUTE = '/dsh-git/api'

/** Where the panel remembers the chosen repository across reloads. */
const REPO_STORAGE_KEY = 'dsh-git-management/repo-path'

/** Where earlier builds kept the GitHub token; the key is wiped on load (plan-v2 S24). */
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
 * The GitHub token for this page load only (plan-v2 S24 / K1 decision (b)).
 *
 * It is deliberately memory-only: the token never reaches localStorage, and
 * the key older builds wrote is wiped as soon as the bundle runs. A reload
 * asks for it again — that is the whole cost of the guarantee.
 */
let gmgSessionToken = null

/**
 * Read the session token, if the user has entered one this page load.
 * @returns the token or null.
 */
function readToken() {
  return gmgSessionToken
}

/**
 * Remember (or forget) the GitHub token for this page load. Never persists.
 * @param token - the token, or null to forget it.
 */
function rememberToken(token) {
  gmgSessionToken = token === null || token === '' ? null : token
}

// Clear the persisted token every storage backend may still hold: the page can
// load before the storage service is ready, so one more sweep rides on the
// first user gesture as well.
function eraseStoredToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* private mode: there was nothing on disk to clear */
  }
}

eraseStoredToken()

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
 * The session token rides on the `github` action and nothing else (plan-v2
 * §3.3-7): a `status` poll has no business carrying a credential, and every
 * extra transport is another place it could leak.
 *
 * @param action - action name (`status`, `commit`, …).
 * @param params - action arguments; `path` is the repository directory.
 * @returns the action's result.
 * @throws when the host reports a failure, with git's own message; the thrown
 *   error carries the envelope's stable `code` (§3.1) and `details`.
 */
async function callHost(action, params = {}) {
  const token = action === 'github' ? readToken() ?? undefined : undefined
  const response = await fetch(apiUrl(API_ROUTE), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, params, token }),
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
    error.code = body?.code ?? null
    error.details = body?.details
    throw error
  }
  return body.result
}

/**
 * Copy one string to the clipboard, if this context exposes it.
 * @param value - the text.
 * @returns true when the clipboard took it.
 */
async function copyToClipboard(value) {
  try {
    await navigator.clipboard.writeText(String(value))
    return true
  } catch {
    return false
  }
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
