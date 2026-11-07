/**
 * Icons: 16×16 line art drawn with `currentColor`, so every glyph inherits the
 * colour its row or button already chose (including the theme's accent and
 * state tokens).
 *
 * No icon package: the shell exposes React but no icon library to third-party
 * bundles, and a handful of hand-drawn paths weigh less than a dependency.
 */

/**
 * Build one icon component.
 * @param children - the SVG children.
 * @param options - `{ filled }` for solid marks.
 * @returns a React component taking `{ size, strokeWidth }`.
 */
function makeIcon(children, options = {}) {
  const filled = options.filled === true
  return function Icon(props) {
    const size = props?.size ?? 16
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: filled ? 'currentColor' : 'none',
        stroke: filled ? 'none' : 'currentColor',
        strokeWidth: props?.strokeWidth ?? 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { flex: 'none', display: 'block' },
      },
      children,
    )
  }
}

/** The sidebar's mark and the panel's title glyph: a branch with one commit. */
const IconBranch = makeIcon([
  h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
  h('circle', { key: 'b', cx: 4, cy: 12.8, r: 1.7 }),
  h('circle', { key: 'c', cx: 12, cy: 5, r: 1.7 }),
  h('path', { key: 'd', d: 'M4 4.9v6.2' }),
  h('path', { key: 'e', d: 'M12 6.7c0 2.4-2.2 3.1-4.6 3.4' }),
])

/** Refresh the panel from git. */
const IconRefresh = makeIcon([
  h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.7-3.8' }),
  h('path', { key: 'b', d: 'M13 2.6V5h-2.4' }),
])

/** Commit. */
const IconCheck = makeIcon([h('path', { key: 'a', d: 'M3.2 8.4 6.4 11.6 12.8 4.6' })])

/** A commit node, used by the history rows. */
const IconCommit = makeIcon([h('circle', { key: 'a', cx: 8, cy: 8, r: 2.6 }), h('path', { key: 'b', d: 'M1.8 8h3M11.2 8h3' })])

/** Add to the index. */
const IconPlus = makeIcon([h('path', { key: 'a', d: 'M8 3.2v9.6M3.2 8h9.6' })])

/** Remove from the index. */
const IconMinus = makeIcon([h('path', { key: 'a', d: 'M3.2 8h9.6' })])

/** Discard worktree changes. */
const IconUndo = makeIcon([
  h('path', { key: 'a', d: 'M3.4 7.6h6.1a3.1 3.1 0 0 1 0 6.2H6.2' }),
  h('path', { key: 'b', d: 'M6 4.4 3.2 7.6 6 10.8' }),
])

/** Push. */
const IconUpload = makeIcon([
  h('path', { key: 'a', d: 'M8 11.4V3.2' }),
  h('path', { key: 'b', d: 'M4.9 6.1 8 3l3.1 3.1' }),
  h('path', { key: 'c', d: 'M3 12.2v1.4h10v-1.4' }),
])

/** Pull / fetch. */
const IconDownload = makeIcon([
  h('path', { key: 'a', d: 'M8 3.2v8.2' }),
  h('path', { key: 'b', d: 'M4.9 8.3 8 11.4l3.1-3.1' }),
  h('path', { key: 'c', d: 'M3 12.2v1.4h10v-1.4' }),
])

/** Expand / collapse a diff. */
const IconChevronRight = makeIcon([h('path', { key: 'a', d: 'M6.2 3.6 10.6 8l-4.4 4.4' })])

/** Expanded state of the same control. */
const IconChevronDown = makeIcon([h('path', { key: 'a', d: 'M3.6 6.2 8 10.6l4.4-4.4' })])

/** The remote ("this branch tracks origin/main"). */
const IconCloud = makeIcon([
  h('path', { key: 'a', d: 'M4.6 11.4h6.6a2.6 2.6 0 0 0 .4-5.2 3.8 3.8 0 0 0-7.3-.6 2.9 2.9 0 0 0 .3 5.8Z' }),
])

/** A repository. */
const IconRepo = makeIcon([
  h('rect', { key: 'a', x: 2.6, y: 2.4, width: 10.8, height: 11.2, rx: 1.6 }),
  h('path', { key: 'b', d: 'M5.4 2.4v11.2M7.8 6h3' }),
])

/** GitHub. */
const IconGithub = makeIcon(
  [
    h('path', {
      key: 'a',
      d: 'M8 1.4a6.6 6.6 0 0 0-2.1 12.9c.3.1.4-.1.4-.3v-1.1c-1.8.4-2.2-.9-2.2-.9-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.5.7 1.9.5.1-.4.2-.7.4-.9-1.5-.2-3-.7-3-3.2 0-.7.2-1.3.6-1.7-.1-.2-.3-.9.1-1.8 0 0 .5-.2 1.8.7a6.2 6.2 0 0 1 3.3 0c1.2-.9 1.8-.7 1.8-.7.4.9.1 1.6.1 1.8.4.4.6 1 .6 1.7 0 2.5-1.6 3-3.1 3.2.3.2.5.7.5 1.4v2c0 .2.1.4.4.3A6.6 6.6 0 0 0 8 1.4Z',
    }),
  ],
  { filled: true },
)

/** Star count. */
const IconStar = makeIcon([h('path', { key: 'a', d: 'M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.9Z' })])

/** Fork count. */
const IconFork = makeIcon([
  h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
  h('circle', { key: 'b', cx: 12, cy: 3.2, r: 1.7 }),
  h('circle', { key: 'c', cx: 8, cy: 12.8, r: 1.7 }),
  h('path', { key: 'd', d: 'M4 4.9v1.4c0 2 1.8 3 4 3s4-1 4-3V4.9' }),
  h('path', { key: 'e', d: 'M8 9.3v1.8' }),
])

/** An issue. */
const IconIssue = makeIcon([h('circle', { key: 'a', cx: 8, cy: 8, r: 6.2 }), h('circle', { key: 'b', cx: 8, cy: 8, r: 1.2, fill: 'currentColor', stroke: 'none' })])

/** A pull request. */
const IconPullRequest = makeIcon([
  h('circle', { key: 'a', cx: 4, cy: 3.2, r: 1.7 }),
  h('circle', { key: 'b', cx: 4, cy: 12.8, r: 1.7 }),
  h('circle', { key: 'c', cx: 12, cy: 12.8, r: 1.7 }),
  h('path', { key: 'd', d: 'M4 4.9v6.2' }),
  h('path', { key: 'e', d: 'M12 11.1V7.2a2 2 0 0 0-2-2H6.4' }),
  h('path', { key: 'f', d: 'M7.9 3.3 6.1 5.2l1.8 1.9' }),
])

/** A warning, for the error line. */
const IconAlert = makeIcon([
  h('path', { key: 'a', d: 'M8 2.4 14 13H2L8 2.4Z' }),
  h('path', { key: 'b', d: 'M8 6.3v3.2' }),
  h('circle', { key: 'c', cx: 8, cy: 11.4, r: 0.7, fill: 'currentColor', stroke: 'none' }),
])

/** Dismiss a notice. */
const IconClose = makeIcon([h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })])

/** Open in a browser. */
const IconExternal = makeIcon([
  h('path', { key: 'a', d: 'M9.4 2.6h4v4' }),
  h('path', { key: 'b', d: 'M13.4 2.6 7.6 8.4' }),
  h('path', { key: 'c', d: 'M11.6 9.6v3.2H3.2V4.4h3.2' }),
])

/** A lock, for the "private repository" line. */
const IconLock = makeIcon([
  h('rect', { key: 'a', x: 3.4, y: 7, width: 9.2, height: 6.6, rx: 1.4 }),
  h('path', { key: 'b', d: 'M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7' }),
])

/** A second checkout hanging off the repository: the worktree section's mark. */
const IconWorktree = makeIcon([
  h('circle', { key: 'a', cx: 4.2, cy: 3.4, r: 1.6 }),
  h('circle', { key: 'b', cx: 4.2, cy: 12.6, r: 1.6 }),
  h('path', { key: 'c', d: 'M4.2 5v6' }),
  h('rect', { key: 'd', x: 8.6, y: 5.4, width: 5.2, height: 5.2, rx: 1.2 }),
])

/** Prune: stale records cut away. */
const IconScissors = makeIcon([
  h('circle', { key: 'a', cx: 4, cy: 4, r: 1.6 }),
  h('circle', { key: 'b', cx: 4, cy: 12, r: 1.6 }),
  h('path', { key: 'c', d: 'M5.2 5.2 13 12.4' }),
  h('path', { key: 'd', d: 'M5.2 10.8 13 3.6' }),
])

/** A release marker: the tag chip's glyph, so the chip is not colour alone. */
const IconTag = makeIcon([
  h('path', { key: 'a', d: 'M2.6 7.4V3.4a.8.8 0 0 1 .8-.8h4l6 6-4.8 4.8-6-6Z' }),
  h('circle', { key: 'b', cx: 5.2, cy: 5.2, r: 1 }),
])
