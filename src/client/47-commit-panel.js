/**
 * The commit-diff tab: one historical commit's changes, file by file.
 *
 * Cursor answers a click on a commit in its history with a comparison opened in
 * the sidebar; each touched file becomes its own block down the column. This is
 * that surface: a sticky commit header, then one block per file — path, status
 * and +/− counts, then only the changed hunks, never the whole file — all in
 * one scroll. Opening a second commit opens a second tab, so two commits can be
 * compared side by side without either one replacing the other.
 */

/** The chip label of a commit tab: the subject (or the short id when it has none). */
function CommitTabTitle(props) {
  const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
  const info = useInfo()
  const params = info?.tab?.navigation?.params ?? null
  const t = typeof props?.t === 'function' ? props.t : tr
  const subject = typeof params?.subject === 'string' && params.subject !== '' ? params.subject : ''
  const short = typeof params?.short === 'string' ? params.short : String(params?.sha ?? '').slice(0, 7)
  return h(
    'span',
    { className: 'gmg-difftabtitle' },
    h(IconCommit, { size: 11 }),
    h('span', { className: 'gmg-difftabname', title: subject === '' ? short : `${short} · ${subject}` }, subject === '' ? short || t('commitDiffTabTitle') : subject),
  )
}

/**
 * One file's block: its header is the fold control, its body the hunks.
 *
 * @param props - `{ file, t, open, onToggle }`.
 * @returns the block element.
 */
function CommitFileBlock(props) {
  const { file, t, open, onToggle } = props
  const { name, dir } = splitPath(file.path)
  const hasText = file.binary === false && file.rows.length > 0
  const toggle = () => onToggle()
  const header = h(
    'div',
    {
      className: 'gmg-cdiff-filehead',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': open,
      title: file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`,
      onClick: toggle,
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
      },
    },
    h('span', { className: 'gmg-cdiff-chevron' }, h(IconChevronDown, { size: 11 })),
    h('span', { className: 'gmg-status', style: { color: statusColor(file.status) }, title: t('status') }, statusGlyph(file.status)),
    h(
      'span',
      { className: 'gmg-path' },
      h('span', { className: 'gmg-name' }, name),
      dir === '' ? null : h('span', { className: 'gmg-dir' }, dir),
    ),
    file.oldPath === null ? null : h('span', { className: 'gmg-cdiff-rename', title: file.oldPath }, `← ${file.oldPath}`),
    h('span', { className: 'gmg-spacer' }),
    file.binary ? h('span', { className: 'gmg-gh-label' }, t('commitDiffBinaryBadge')) : null,
    file.additions > 0 ? h('span', { className: 'gmg-add-count gmg-stats' }, `+${file.additions}`) : null,
    file.deletions > 0 ? h('span', { className: 'gmg-del-count gmg-stats' }, `-${file.deletions}`) : null,
  )

  let body = null
  if (hasText === false) {
    body = h('div', { className: 'gmg-cdiff-note' }, file.binary ? t('commitDiffBinary') : t('commitDiffNoText'))
  } else {
    body = h('div', { className: 'gmg-cdiff-body' }, h(UnifiedDiff, { rows: file.rows }))
  }

  return h('section', { className: `gmg-cdiff-file${open ? '' : ' is-folded'}${hasText ? '' : ' is-flat'}` }, header, open ? body : null)
}

/**
 * The tab body.
 *
 * @param props - `{ view, params, t, onClose, onRetry }`; `view` is the cached
 *   `{ status, commit, files, additions, deletions, total, truncated }`.
 * @returns the panel element.
 */
function CommitDiffPanel(props) {
  const view = props.view ?? null
  const params = props.params ?? {}
  const t = typeof props?.t === 'function' ? props.t : tr
  const closeRef = useRef(typeof props?.onClose === 'function' ? props.onClose : () => {})
  useEffect(() => {
    closeRef.current = typeof props?.onClose === 'function' ? props.onClose : () => {}
  }, [props?.onClose])

  // Escape leaves the tab, the way it leaves a peek in an editor.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [folded, setFolded] = useState(() => new Set())
  const commit = view?.commit ?? null
  const files = view?.files ?? []
  const loading = view === null || view.status === 'loading' || view.status === 'idle'
  const error = view?.status === 'error' ? view.error : null
  const sha = commit?.sha ?? (typeof params.sha === 'string' ? params.sha : '')
  const short = commit?.short ?? (typeof params.short === 'string' ? params.short : String(sha).slice(0, 7))
  const subject = commit?.subject ?? (typeof params.subject === 'string' ? params.subject : '')
  const author = commit?.author ?? ''
  const lang = typeof props?.lang === 'string' ? props.lang : currentLocale()
  const additions = view?.additions ?? 0
  const deletions = view?.deletions ?? 0
  const total = view?.total ?? files.length
  const allFolded = files.length > 0 && files.every((file) => folded.has(file.path))

  const toggleFile = (path) => {
    setFolded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleAll = () => setFolded(allFolded ? new Set() : new Set(files.map((file) => file.path)))

  const header = h(
    'div',
    { className: 'gmg-cdiff-head' },
    h(
      'div',
      { className: 'gmg-cdiff-headline' },
      h(
        'button',
        { className: 'gmg-btn is-ghost', type: 'button', onClick: () => closeRef.current(), title: t('diffBackHint') },
        '←',
        t('diffBack'),
      ),
      short === '' ? null : h('span', { className: 'gmg-sha', title: sha }, short),
      h('span', { className: 'gmg-cdiff-subject', title: sha === '' ? subject : `${short} ${subject}` }, subject === '' ? t('commitDiffTabTitle') : subject),
    ),
    h(
      'div',
      { className: 'gmg-cdiff-subline' },
      author === '' ? null : h('span', { className: 'gmg-cdiff-meta' }, author),
      commit?.date ? h('span', { className: 'gmg-cdiff-meta' }, relativeTime(commit.date, lang)) : null,
      commit?.merge === true ? h('span', { className: 'gmg-gh-label' }, t('commitDiffMergeBadge')) : null,
      h('span', { className: 'gmg-spacer' }),
      h('span', { className: 'gmg-cdiff-meta' }, t('commitDiffFileCount', { files: total })),
      additions > 0 ? h('span', { className: 'gmg-add-count gmg-stats' }, `+${additions}`) : null,
      deletions > 0 ? h('span', { className: 'gmg-del-count gmg-stats' }, `-${deletions}`) : null,
      files.length > 0
        ? h('button', { className: 'gmg-btn is-ghost', type: 'button', onClick: toggleAll }, allFolded ? t('commitDiffExpandAll') : t('commitDiffCollapseAll'))
        : null,
    ),
  )

  let body
  if (loading) {
    body = h('div', { className: 'gmg-empty' }, t('commitDiffLoading'))
  } else if (error !== null) {
    body = h(
      'div',
      { className: 'gmg-cdiff-failure' },
      h('div', { className: 'gmg-empty' }, error),
      h(
        'div',
        { className: 'gmg-form' },
        h(
          'button',
          { className: 'gmg-btn is-primary', type: 'button', onClick: () => (typeof props.onRetry === 'function' ? props.onRetry() : null) },
          t('commitDiffRetry'),
        ),
      ),
    )
  } else if (files.length === 0) {
    body = h('div', { className: 'gmg-empty' }, t('commitDiffEmpty'))
  } else {
    body = h(
      'div',
      { className: 'gmg-cdiff-files' },
      files.map((file) =>
        h(CommitFileBlock, { key: file.path, file, t, open: folded.has(file.path) === false, onToggle: () => toggleFile(file.path) }),
      ),
      view?.truncated === true
        ? h('div', { className: 'gmg-cdiff-note' }, t('commitDiffTruncated', { shown: files.length, total }))
        : null,
    )
  }

  return h(
    'div',
    { className: 'gmg-root gmg-diffpanel gmg-commitpanel is-compact' },
    header,
    h('div', { className: 'gmg-cdiff-scroll' }, body),
  )
}
