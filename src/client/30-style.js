/**
 * Styles for the panel, injected once per page (the shell tears client plugin
 * CSS down with the plugin's own effect, so a reload cannot stack duplicates).
 *
 * Everything reads the alias tokens the theme service publishes, so light and
 * dark follow the GUI without a second palette here.
 */

/** Style element marker: one element per page, replaced on hot reload. */
const STYLE_MARKER = 'dsh-git-management/panel.css'

/** The stylesheet text. */
const PANEL_CSS = `
.gmg-root {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.45;
  --gmg-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
.gmg-page {
  max-width: 940px;
  margin: 0 auto;
  padding: 18px 24px 72px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gmg-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 2px 2px;
}
.gmg-head-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.gmg-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; letter-spacing: .01em; }
.gmg-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-family: var(--gmg-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-head-tools { display: flex; align-items: center; gap: 6px; flex: none; }
.gmg-select {
  max-width: 240px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  outline: none;
}
.gmg-select:hover { border-color: var(--dsw-alias-border-l2); }
.gmg-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background .12s ease, color .12s ease, opacity .12s ease;
}
.gmg-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gmg-icon-btn:disabled { opacity: .4; cursor: default; }
.gmg-icon-btn.is-spinning svg { animation: gmg-spin 1s linear infinite; }
@keyframes gmg-spin { to { transform: rotate(360deg); } }
.gmg-card {
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  overflow: hidden;
}
.gmg-branchbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; }
.gmg-branch {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  font-family: var(--gmg-mono); font-size: 12px;
  max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gmg-branch { position: relative; }
.gmg-branch:hover { border-color: var(--dsw-alias-border-l2); }
.gmg-branch-select {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; cursor: pointer; border: none; background: transparent;
}
.gmg-branch.is-detached { color: var(--dsw-alias-state-warn-primary); }
.gmg-track { color: var(--dsw-alias-label-secondary); font-size: 11px; font-family: var(--gmg-mono); display: inline-flex; align-items: center; gap: 4px; }
.gmg-ahead { color: var(--dsw-alias-state-success-primary); }
.gmg-behind { color: var(--dsw-alias-state-warn-primary); }
.gmg-spacer { flex: 1; }
.gmg-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease, opacity .12s ease;
  white-space: nowrap;
}
.gmg-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.gmg-btn:disabled { opacity: .45; cursor: default; }
.gmg-btn.is-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.gmg-btn.is-primary:hover:not(:disabled) { filter: brightness(1.08); }
.gmg-btn.is-ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
.gmg-btn.is-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gmg-btn.is-danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.gmg-commit { padding: 12px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-textarea {
  width: 100%; box-sizing: border-box;
  min-height: 62px; max-height: 220px; resize: vertical;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px; font-family: inherit; line-height: 1.5;
  outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.gmg-textarea:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
.gmg-textarea::placeholder { color: var(--dsw-alias-label-secondary); }
.gmg-commit-foot { display: flex; align-items: center; gap: 12px; }
.gmg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
.gmg-check input { accent-color: var(--dsw-alias-brand-primary); margin: 0; cursor: pointer; }
.gmg-group { border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-group-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-secondary);
  text-transform: uppercase;
}
.gmg-count { font-weight: 500; opacity: .75; }
.gmg-group-head .gmg-icon-btn { width: 22px; height: 22px; }
.gmg-files { display: flex; flex-direction: column; }
.gmg-file {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px 4px 12px;
  min-height: 28px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.gmg-file:hover { background: var(--dsw-alias-bg-layer-2); }
.gmg-file.is-open { background: var(--dsw-alias-bg-layer-2); border-left-color: var(--dsw-alias-brand-primary); }
.gmg-file-chevron { color: var(--dsw-alias-label-secondary); opacity: .7; display: inline-flex; }
.gmg-status { width: 16px; text-align: center; font-family: var(--gmg-mono); font-size: 11px; font-weight: 700; }
.gmg-path { display: flex; align-items: baseline; gap: 0; min-width: 0; flex: 1; font-size: 12.5px; }
.gmg-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-dir { color: var(--dsw-alias-label-secondary); opacity: .72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-stats { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); display: inline-flex; gap: 6px; }
.gmg-add-count { color: var(--dsw-alias-state-success-primary); }
.gmg-del-count { color: var(--dsw-alias-state-error-primary); }
.gmg-actions { display: inline-flex; gap: 2px; opacity: 0; transition: opacity .12s ease; }
.gmg-file:hover .gmg-actions, .gmg-file:focus-within .gmg-actions { opacity: 1; }
.gmg-actions .gmg-icon-btn { width: 22px; height: 22px; }
.gmg-diff {
  margin: 0 0 6px 22px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
  max-height: 420px;
  overflow: auto;
}
.gmg-diff pre { margin: 0; padding: 8px 0; font-family: var(--gmg-mono); font-size: 11.5px; line-height: 1.5; }
.gmg-diff-line { display: block; padding: 0 10px; white-space: pre; }
.gmg-diff-line.is-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); color: var(--dsw-alias-state-success-primary); }
.gmg-diff-line.is-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); color: var(--dsw-alias-state-error-primary); }
.gmg-diff-line.is-hunk { color: var(--dsw-alias-brand-primary); opacity: .95; }
.gmg-diff-line.is-meta { color: var(--dsw-alias-label-secondary); opacity: .8; }
.gmg-diff-note { padding: 8px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gmg-history { display: flex; flex-direction: column; }
.gmg-commit-row { display: flex; align-items: center; gap: 9px; padding: 7px 12px; }
.gmg-commit-row:hover { background: var(--dsw-alias-bg-layer-2); }
.gmg-sha {
  font-family: var(--gmg-mono); font-size: 11px;
  padding: 1px 6px; border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  flex: none;
}
.gmg-subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.gmg-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.gmg-notice {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 9px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gmg-notice.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); color: var(--dsw-alias-state-error-primary); }
.gmg-notice.is-ok { color: var(--dsw-alias-state-success-primary); }
.gmg-notice span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.gmg-empty { padding: 14px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gmg-gh { display: flex; flex-direction: column; }
.gmg-gh-head { display: flex; align-items: center; gap: 10px; padding: 11px 12px; flex-wrap: wrap; }
.gmg-gh-name { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
.gmg-gh-desc { width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gmg-gh-stats { display: inline-flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.gmg-gh-stats span { display: inline-flex; align-items: center; gap: 3px; }
.gmg-gh-body { border-top: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; }
.gmg-gh-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; }
.gmg-gh-row:hover { background: var(--dsw-alias-bg-layer-2); }
.gmg-gh-num { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); flex: none; }
.gmg-gh-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-gh-label { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.gmg-gh-tabs { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-gh-tab { font-size: 12px; padding: 4px 9px; border-radius: 7px; cursor: pointer; color: var(--dsw-alias-label-secondary); border: 1px solid transparent; display: inline-flex; align-items: center; gap: 5px; }
.gmg-gh-tab.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
.gmg-gh-tab:hover { color: var(--dsw-alias-label-primary); }
.gmg-form { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-input {
  height: 28px; padding: 0 9px;
  border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; outline: none;
}
.gmg-input:focus { border-color: var(--dsw-alias-brand-primary); }
.gmg-hint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
.gmg-kbd { font-family: var(--gmg-mono); font-size: 10.5px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.gmg-scroll-cap { max-height: 320px; overflow: auto; }

/* ---- the right-sidebar tab: a ~320-420px column, not a page ---- */
.gmg-root.is-compact .gmg-page { max-width: none; padding: 8px 8px 28px; gap: 8px; }
.gmg-root.is-compact .gmg-head { gap: 8px; align-items: center; padding: 2px 2px 0; }
.gmg-root.is-compact .gmg-title { font-size: 12px; font-weight: 600; }
.gmg-root.is-compact .gmg-sub { display: none; }
.gmg-root.is-compact .gmg-head-tools { flex: 1; min-width: 0; }
.gmg-root.is-compact .gmg-select { flex: 1; min-width: 0; max-width: none; }
.gmg-root.is-compact .gmg-card { border-radius: 10px; }
.gmg-root.is-compact .gmg-commit { padding: 8px; gap: 8px; }
.gmg-root.is-compact .gmg-commit-foot { flex-wrap: wrap; gap: 6px 10px; }
.gmg-root.is-compact .gmg-kbd-hint { display: none; }
.gmg-root.is-compact .gmg-textarea { min-height: 52px; font-size: 12.5px; }
.gmg-root.is-compact .gmg-branchbar { padding: 8px; gap: 6px; }
.gmg-root.is-compact .gmg-btn { padding: 0 8px; height: 25px; }
.gmg-root.is-compact .gmg-branch { max-width: 190px; }
.gmg-root.is-compact .gmg-group-head { padding: 7px 9px; }
.gmg-root.is-compact .gmg-file { padding: 4px 6px 4px 8px; gap: 6px; }
.gmg-root.is-compact .gmg-diff { margin-left: 4px; max-height: 320px; }
.gmg-root.is-compact .gmg-diff pre { font-size: 11px; }
.gmg-root.is-compact .gmg-gh-head { padding: 9px; gap: 8px; }
.gmg-root.is-compact .gmg-gh-desc { padding: 0 9px 9px !important; }
.gmg-root.is-compact .gmg-commit-row { padding: 6px 9px; gap: 7px; }
.gmg-root.is-compact .gmg-meta { display: none; }
`

/**
 * Install the stylesheet once.
 * @returns the disposer removing it.
 */
function installPanelStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_MARKER}"]`)
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_MARKER
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}
