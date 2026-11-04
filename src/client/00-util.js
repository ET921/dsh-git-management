/**
 * Shared plumbing for the browser half: React access, the host endpoint, and
 * the small pure helpers the panel uses.
 *
 * The shell evaluates `lib/client.js` as a factory with a `require` table, so
 * `react` is the same instance the rest of the GUI renders with — not a copy.
 */

/** React, from the shell's module table. */
const react = require('react')

/** Terse hyperscript; this file set is JSX-free so the build needs no compiler. */
const h = react.createElement

const { useCallback, useEffect, useMemo, useRef, useState } = react

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
 * @param status - M, A, D, R, C, U or T.
 * @returns a CSS custom-property name.
 */
function statusColor(status) {
  switch (status) {
    case 'A':
    case 'U':
      return 'var(--dsw-alias-state-success-primary)'
    case 'D':
      return 'var(--dsw-alias-state-error-primary)'
    case 'M':
    case 'T':
      return 'var(--dsw-alias-state-warn-primary)'
    case 'R':
    case 'C':
      return 'var(--dsw-alias-brand-primary)'
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
