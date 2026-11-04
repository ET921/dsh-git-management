/**
 * The centre-column diff view.
 *
 * This is the seat that plays the editor's part in the Cursor comparison: the
 * right column keeps the file list, and clicking a row swaps this panel into
 * the main column at full width, with both gutters, a unified/split switch,
 * and prev/next across the same change set. Closing it returns to the
 * conversation (`selectPanel(null)`).
 */

/**
 * One gutter cell.
 * @param props - `{ value }`.
 * @returns the cell element.
 */
function DiffGutter(props) {
  return h('span', { className: 'gmg-diff-no' }, props.value === null || props.value === undefined ? '' : String(props.value))
}

/**
 * One body cell.
 * @param props - `{ kind, text }`.
 * @returns the cell element.
 */
function DiffCell(props) {
  return h('span', { className: `gmg-diff-cell is-${props.kind ?? 'blank'}` }, props.text ?? '')
}

/**
 * The diff panel body in unified form.
 * @param props - `{ rows }`.
 * @returns the element.
 */
function UnifiedDiff(props) {
  const rows = props.rows
  return h(
    'div',
    { className: 'gmg-diffbody' },
    rows.map((row, index) => {
      if (row.kind === DIFF_HUNK) {
        return h('div', { className: 'gmg-diffrow is-hunk', key: index }, h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-cell is-hunk' }, row.text))
      }
      if (row.kind === DIFF_META) {
        return h('div', { className: 'gmg-diffrow is-meta', key: index }, h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-no' }), h('span', { className: 'gmg-diff-cell is-meta' }, row.text))
      }
      return h(
        'div',
        { className: `gmg-diffrow is-${row.kind}`, key: index },
        h(DiffGutter, { value: row.oldNo }),
        h(DiffGutter, { value: row.newNo }),
        h(DiffCell, { kind: row.kind, text: row.text }),
      )
    }),
  )
}

/**
 * The diff panel body in side-by-side form.
 * @param props - `{ pairs }`.
 * @returns the element.
 */
function SplitDiff(props) {
  return h(
    'div',
    { className: 'gmg-diffbody is-split' },
    props.pairs.map((pair, index) => {
      if (pair.left?.kind === DIFF_HUNK) {
        return h('div', { className: 'gmg-diffrow is-hunk is-splitrow', key: index }, h('span', { className: 'gmg-diff-cell is-hunk' }, pair.left.text))
      }
      const left = pair.left
      const right = pair.right
      return h(
        'div',
        { className: 'gmg-diffrow is-splitrow', key: index },
        h(DiffGutter, { value: left?.oldNo ?? null }),
        h(DiffCell, { kind: left?.kind ?? 'blank', text: left?.text ?? '' }),
        h(DiffGutter, { value: right?.newNo ?? null }),
        h(DiffCell, { kind: right?.kind ?? 'blank', text: right?.text ?? '' }),
      )
    }),
  )
}

/**
 * The panel itself.
 * @param props - `{ t }` from the slot's locale namespace.
 * @returns the element.
 */
function DiffPanel(props) {
  const t = typeof props?.t === 'function' ? props.t : tr
  const state = useDiffState()
  const panel = useGitStore()
  const target = state.target
  const compact = props?.compact === true
  const rootClass = `gmg-root gmg-diffpanel${compact ? ' is-compact' : ''}`

  // Closing is the tab's own action when the column provides one, so the strip
  // drops the tab instead of leaving an empty seat behind.
  const closeRef = useRef(typeof props?.onClose === 'function' ? props.onClose : closeDiff)
  useEffect(() => {
    closeRef.current = typeof props?.onClose === 'function' ? props.onClose : closeDiff
  }, [props?.onClose])

  // Escape leaves the diff, the way it leaves a peek in an editor.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (getDiffState().target === null) return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (target === null) {
    return h('div', { className: rootClass }, h('div', { className: 'gmg-empty' }, t('diffNothingOpen')))
  }

  // The same change set, so prev/next walks exactly what the sidebar lists.
  const status = panel.status
  const siblings = status === null
    ? []
    : [
        ...status.staged.map((row) => ({ row, staged: true })),
        ...status.changes.map((row) => ({ row, staged: false })),
        ...status.conflicts.map((row) => ({ row, staged: false })),
      ]
  const currentIndex = siblings.findIndex((entry) => entry.row.path === target.file && entry.staged === target.staged)
  const go = (offset) => {
    if (siblings.length === 0) return
    const next = (currentIndex + offset + siblings.length) % siblings.length
    const entry = siblings[next]
    openDiff({ path: target.path, file: entry.row.path, staged: entry.staged, status: entry.row.status })
  }

  const additions = state.rows.filter((row) => row.kind === DIFF_ADD).length
  const deletions = state.rows.filter((row) => row.kind === DIFF_DEL).length
  const otherSide = siblings.some((entry) => entry.row.path === target.file && entry.staged !== target.staged)

  const header = h(
    'div',
    { className: 'gmg-diffhead' },
    h(
      'button',
      { className: 'gmg-btn is-ghost', type: 'button', onClick: () => (props.onClose ?? closeDiff)(), title: t('diffBackHint') },
      '←',
      t('diffBack'),
    ),
    h('span', { className: `gmg-status`, style: { color: statusColor(target.status ?? 'M') } }, statusGlyph(target.status ?? 'M')),
    h('span', { className: 'gmg-diffpath', title: target.file }, target.file),
    h('span', { className: 'gmg-gh-label' }, target.staged ? t('diffStagedBadge') : t('diffWorktreeBadge')),
    h('span', { className: 'gmg-add-count gmg-stats' }, `+${additions}`),
    h('span', { className: 'gmg-del-count gmg-stats' }, `-${deletions}`),
    h('span', { className: 'gmg-spacer' }),
    otherSide
      ? h(
          'button',
          {
            className: 'gmg-btn',
            type: 'button',
            onClick: () => openDiff({ ...target, staged: !target.staged }),
          },
          target.staged ? t('diffShowWorktree') : t('diffShowStaged'),
        )
      : null,
    h(
      'button',
      { className: 'gmg-btn', type: 'button', disabled: siblings.length < 2, onClick: () => go(-1), title: t('diffPrev') },
      '↑',
    ),
    h(
      'button',
      { className: 'gmg-btn', type: 'button', disabled: siblings.length < 2, onClick: () => go(1), title: t('diffNext') },
      '↓',
    ),
    h(
      'button',
      {
        className: 'gmg-btn',
        type: 'button',
        onClick: () => toggleDiffMode(),
        title: state.mode === 'unified' ? t('diffSplit') : t('diffUnified'),
      },
      state.mode === 'unified' ? t('diffSplit') : t('diffUnified'),
    ),
    h('button', { className: 'gmg-icon-btn', type: 'button', onClick: () => (props.onClose ?? closeDiff)(), title: t('dismiss') }, h(IconClose, { size: 14 })),
  )

  let body
  if (state.loading) body = h('div', { className: 'gmg-empty' }, t('loadingDiff'))
  else if (state.error !== null) body = h('div', { className: 'gmg-empty' }, state.error)
  else if (state.note === 'binary') body = h('div', { className: 'gmg-empty' }, t('binaryDiff'))
  else if (state.note === 'empty') body = h('div', { className: 'gmg-empty' }, t('emptyDiff'))
  else if (state.rows.length === 0) body = h('div', { className: 'gmg-empty' }, t('emptyDiff'))
  else body = state.mode === 'unified' ? h(UnifiedDiff, { rows: state.rows }) : h(SplitDiff, { pairs: state.pairs })

  return h(
    'div',
    { className: rootClass },
    header,
    h('div', { className: 'gmg-diffscroll' }, body),
  )
}
