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
/* Two layers of tokens, deliberately in two places.
   The palette is literal and lives on :root, because the hover cards are
   portalled to <body>: a token declared on .gmg-root is absent there, and the
   card's stat colours and mono text used to come out grey.
   The surface tokens reference the theme aliases, and DSH publishes those on
   <body>, not on <html> — so they must stay on .gmg-root, which is inside that
   scope. Declaring them on :root made every value invalid, which is why the row
   hover was transparent instead of a highlight. */
:root {
  --gmg-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  /* Saturated marks for where things live. The theme's accents are calmer than
     a git graph needs, so the panel carries its own vivid set: blue is this
     machine, violet is the server, amber is a tag. The light-theme block below
     darkens the inks enough to keep the contrast on a white surface. */
  --gmg-local: #4d82ff;
  --gmg-local-soft: rgba(77, 130, 255, .24);
  --gmg-head-ink: #05070d;
  --gmg-remote: #b06bff;
  --gmg-remote-soft: rgba(176, 107, 255, .28);
  --gmg-tag: #f59e0b;
  --gmg-tag-soft: rgba(245, 158, 11, .26);
  --gmg-ok: #22c55e;
  --gmg-warn: #f59e0b;
  --gmg-bad: #f45c5c;
}
/* On a white surface the same hue has to be darker to stay readable. */
@media (prefers-color-scheme: light) {
  :root {
    --gmg-local: #1d4ed8;
    --gmg-local-soft: rgba(29, 78, 216, .16);
    --gmg-head-ink: #ffffff;
    --gmg-remote: #7c3aed;
    --gmg-remote-soft: rgba(124, 58, 237, .16);
    /* #b45309 measured 4.95:1 at best (3.5:1 on its own soft chip) on this
       surface — under the 4.5:1 small-text floor. #92400e is the same amber
       family and lands at 5:1 on the chip (round2 D1). Dark keeps #f59e0b. */
    --gmg-tag: #92400e;
    --gmg-tag-soft: rgba(180, 83, 9, .16);
    --gmg-ok: #15803d;
    --gmg-warn: #b45309;
    --gmg-bad: #b91c1c;
  }
}
.gmg-root {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.45;
  /* Surfaces. The theme's own layers are tuned for a page, not for a column of
     cards on a page: on the light theme they are white on white, so the cards
     and the buttons inside them disappeared. These are resolved per theme in
     the block below. */
  --gmg-surface: var(--dsw-alias-bg-layer-2);
  --gmg-control: var(--dsw-alias-bg-layer-2);
  /* A hover has to be a step off the surface. Mixing the surface with itself
     (the old value) painted the highlight in exactly the card's colour, and a
     percentage of the *text* colour is the one tint that reads in both themes
     without knowing which one the app is actually in. */
  --gmg-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
  --gmg-edge: var(--dsw-alias-border-l2);
}
@media (prefers-color-scheme: light) {
  .gmg-root {
    /* Cards sit a step off the page, controls a step off the card. */
    --gmg-surface: color-mix(in srgb, var(--dsw-alias-bg-base) 93%, #000);
    --gmg-control: color-mix(in srgb, var(--dsw-alias-bg-base) 86%, #000);
    --gmg-edge: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  }
  .gmg-card { box-shadow: 0 1px 3px rgba(0, 0, 0, .08); }
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
/* The bare-repository badge: a read-only warning in chip clothing, in the warn
   family the panel uses for "this state is unusual" (same tone token as
   .gmg-wt-tag.is-warn). */
.gmg-bare {
  flex: none; font-size: 10.5px; line-height: 1.6; padding: 0 6px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}
.gmg-head-tools { display: flex; align-items: center; gap: 6px; flex: none; }
/* The "updated X ago" tag is the first thing to give way on a 360px column:
   fixed-width single line, clipped, so the repo select keeps its width. */
.gmg-last-sync { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-select {
  max-width: 240px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--gmg-edge);
  background: var(--gmg-control);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  outline: none;
}
.gmg-select:hover { border-color: var(--dsw-alias-border-l2); }
/* Repo switcher is the panel's primary navigation control; the outline:none
   above removed its only focus cue, so the ring has to come back here
   (round2 C1: keyboard focus was invisible). */
.gmg-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
/* The branch-bar "more" trigger: a ghost square a size step under the icon
   buttons (24px against 28), so it reads as auxiliary next to the sync row. */
.gmg-morebtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.gmg-morebtn:hover { background: var(--gmg-hover); color: var(--dsw-alias-label-primary); }
.gmg-morebtn:disabled { opacity: .4; cursor: default; }
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
.gmg-icon-btn:hover { background: var(--gmg-hover); color: var(--dsw-alias-label-primary); }
.gmg-icon-btn:disabled { opacity: .4; cursor: default; }
.gmg-icon-btn.is-spinning svg { animation: gmg-spin 1s linear infinite; }
@keyframes gmg-spin { to { transform: rotate(360deg); } }
.gmg-card {
  background: var(--gmg-surface);
  border: 1px solid var(--gmg-edge);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .22), inset 0 1px 0 rgba(255, 255, 255, .04);
}
.gmg-branchbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex-wrap: wrap; }
.gmg-branchpick { position: relative; display: inline-flex; min-width: 0; }
.gmg-branch {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  background: var(--gmg-local-soft);
  border: 1px solid color-mix(in srgb, var(--gmg-local) 45%, transparent);
  color: var(--gmg-local);
  font-family: var(--gmg-mono); font-size: 12px; font-weight: 600;
  max-width: 320px; overflow: hidden; cursor: pointer;
  appearance: none;
}
.gmg-branch:hover, .gmg-branch.is-open { border-color: var(--dsw-alias-border-l2); }
.gmg-branch svg:last-child { transition: transform .12s ease; }
.gmg-branch.is-open svg:last-child { transform: rotate(180deg); }
.gmg-branch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.gmg-branch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The portalled surfaces sit outside .gmg-root, so they carry the mono stack
   the panel defines there: a custom property does not cross that boundary. */
.gmg-hover, .gmg-branchmenu, .gmg-moremenu {
  --gmg-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
/* The branch list and the "more" action list share one floating-surface spec
   (same corner, border, shadow): what differs is the ARIA semantics underneath
   — listbox for the checkout picker, menu for the actions (design.md). */
.gmg-branchmenu, .gmg-moremenu {
  position: fixed; z-index: 4100;
  padding: 4px;
  display: flex; flex-direction: column; gap: 1px;
  max-height: 300px; overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 93%, var(--dsw-alias-label-primary) 7%);
  box-shadow: 0 14px 36px rgba(0, 0, 0, .45);
}
.gmg-branchitem, .gmg-moreitem {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 7px;
  font-family: var(--gmg-mono); font-size: 12px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.gmg-branchitem.is-active, .gmg-moreitem.is-active { background: var(--gmg-hover); }
.gmg-branchitem.is-current { color: var(--dsw-alias-brand-primary); }
/* A disabled action stays visitable and silent for the pointer, but has to
   read as "not offered now" — half the ink, no pointer hand. */
.gmg-moreitem[aria-disabled="true"] { opacity: .45; cursor: default; }
.gmg-branchitem-name, .gmg-moreitem-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-branchcheck { display: inline-flex; flex: none; }
.gmg-branchmenu-empty { padding: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.gmg-branch.is-detached { color: var(--dsw-alias-state-warn-primary); }
.gmg-track { color: var(--dsw-alias-label-secondary); font-size: 11px; font-family: var(--gmg-mono); display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
/* Where the local branch stands against its remote, at a glance. */
.gmg-track.is-synced { color: var(--gmg-ok); }
.gmg-track.is-ahead { color: var(--gmg-local); }
.gmg-track.is-behind { color: var(--gmg-warn); }
.gmg-track.is-diverged { color: var(--gmg-bad); }
.gmg-ahead { color: var(--gmg-ok); }
.gmg-behind { color: var(--gmg-warn); }
.gmg-synced { color: var(--gmg-ok); }
.gmg-spacer { flex: 1; }
.gmg-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--gmg-edge);
  background: var(--gmg-control);
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
  /* The fill is the theme's brand accent, but that accent is not a fixed hue:
     it is near-white in the dark theme and near-black in the light one. A
     hardcoded white label therefore vanished into the white fill and the
     button read as an empty pill (the GitHub token Save button). The ink has
     to be the surface colour the accent is designed to sit on. */
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.gmg-btn.is-primary:hover:not(:disabled) { filter: brightness(1.08); }
/* A disabled primary has to keep its label readable. Fading the whole button to
   45% composited a pale label onto a pale surface, and the result read as an
   empty grey box — the state said "nothing here" instead of "not yet". */
.gmg-btn.is-primary:disabled {
  opacity: 1;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, var(--gmg-control));
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);
  color: color-mix(in srgb, var(--dsw-alias-label-primary) 82%, transparent);
}
.gmg-btn.is-ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
.gmg-btn.is-ghost:hover:not(:disabled) { background: var(--gmg-hover); color: var(--dsw-alias-label-primary); }
.gmg-btn.is-danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.gmg-commit { padding: 12px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-textarea {
  width: 100%; box-sizing: border-box;
  min-height: 62px; max-height: 220px; resize: vertical;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--gmg-edge);
  background: var(--gmg-control);
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
  font-size: 12px; font-weight: 700; letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  text-transform: uppercase;
}
.gmg-count { font-weight: 500; opacity: .75; }
/* The fold control for a group: same 22px target as the other inline buttons,
   rotated a quarter turn when the group is open. */
.gmg-collapse {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; margin-left: -6px;
  padding: 0; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: transform .12s ease, color .12s ease, background .12s ease;
  transform: rotate(-90deg);
}
.gmg-collapse[aria-expanded="true"] { transform: rotate(0deg); color: var(--dsw-alias-label-primary); }
.gmg-collapse:hover:not(:disabled) { background: var(--gmg-hover); color: var(--dsw-alias-label-primary); }
/* Focus rings use one hue panel-wide; the collapse button used the lane blue
   (--gmg-local) here, which made the two keyboard cues disagree (round2 C5). */
.gmg-collapse:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.gmg-collapse:disabled { opacity: .35; cursor: default; }
.gmg-group.is-collapsed .gmg-group-head { border-bottom: none; }
.gmg-group-head .gmg-icon-btn { width: 22px; height: 22px; }
.gmg-files { display: flex; flex-direction: column; }
.gmg-file {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px 4px 12px;
  min-height: 28px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.gmg-file:hover { background: var(--gmg-hover); }
.gmg-file.is-open { background: var(--gmg-hover); border-left-color: var(--dsw-alias-brand-primary); }
.gmg-file-chevron { color: var(--dsw-alias-label-secondary); opacity: .7; display: inline-flex; }
.gmg-status { width: 16px; text-align: center; font-family: var(--gmg-mono); font-size: 11px; font-weight: 700; }
.gmg-path { display: flex; align-items: baseline; gap: 0; min-width: 0; flex: 1; font-size: 12.5px; }
.gmg-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-dir { color: var(--dsw-alias-label-secondary); opacity: .72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-stats { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); display: inline-flex; gap: 6px; }
.gmg-add-count { color: var(--gmg-ok); font-weight: 600; }
.gmg-del-count { color: var(--gmg-bad); font-weight: 600; }
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
/* The list is one row per commit, and each row draws its own slice of the
   graph. A lane stays continuous because every row is the same 22px and the
   engine ends its edges exactly on the row's top and bottom borders. */
.gmg-history {
  display: flex; flex-direction: column;
  /* The node ring is punched out of the row's own surface, so the engine can
     paint the current node's inner circle with this token and a hovered row
     still reads as one clean disc. */
  --gmg-row-bg: var(--dsw-alias-bg-base);
}
.gmg-commit-row {
  display: flex; align-items: center;
  height: 22px; line-height: 22px;
  padding: 0 10px 0 0;
  box-sizing: border-box;
  font-size: 13px;
  cursor: pointer;
}
.gmg-commit-row:hover { background: var(--gmg-hover); --gmg-row-bg: var(--gmg-hover); }
.gmg-commit-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
/* The graph rides in the row's flex flow at the left edge; the row carries no
   left padding because the rail brings its own inset. */
.gmg-commit-row .gmg-graph { flex: none; display: block; overflow: visible; }
.gmg-graph-edge { fill: none; stroke-width: 1; stroke-linecap: round; }
.gmg-graph-node { stroke: var(--gmg-row-bg); }
.gmg-commit-row:hover .gmg-graph-node { stroke: transparent; }
/* The checkout is a hollow ring: the engine draws the inner circle with no fill
   so CSS can punch it out of the row's own surface. Left alone, a circle with no
   fill falls back to SVG's default black, which reads as a dot in the middle of
   the node — barely visible on the dark theme, plainly wrong on the light one.
   The token is the row's, so a hovered row takes the highlight with it. */
.gmg-graph-node.is-current-inner { fill: var(--gmg-row-bg); }
/* Ref chips, Cursor-style: one named capsule, then one glyph per colour family.
   These are filled marks, not tinted text — the name is what a reader acts on,
   and at 11px it has to survive on a saturated ground. The ink is the theme's
   paired mark ink (near-black in dark, white in light), the one value that
   clears 4.5:1 on all three family colours. */
.gmg-ref {
  flex: none; max-width: 108px; margin-left: 4px;
  display: inline-flex; align-items: center; gap: 4px;
  height: 18px; padding: 0 8px; border-radius: 10px;
  font-family: var(--gmg-mono); font-size: 11px; line-height: 1; font-weight: 600;
  border: 0; overflow: hidden; white-space: nowrap;
  color: var(--gmg-head-ink);
}
/* Where a ref lives is the point of these colours: blue is this machine,
   violet is the server, amber is a tag. */
.gmg-ref.is-head { background: var(--gmg-local); }
.gmg-ref.is-branch { background: var(--gmg-local); }
.gmg-ref.is-remote { background: var(--gmg-remote); }
.gmg-ref.is-tag { background: var(--gmg-tag); }
.gmg-ref.is-detached { background: var(--gmg-tag); }
/* A family chip is icon-only, so it drops the capsule's horizontal padding and
   takes its count in front of the glyph. */
.gmg-ref.is-cluster { padding: 0 5px; gap: 3px; }
.gmg-ref-count { font-size: 10px; font-weight: 700; }
.gmg-ref svg { flex: none; opacity: 1; }
/* The name is its own flex item so a long ref can end in an ellipsis instead of
   being sliced at the chip's edge; min-width: 0 is what lets a flex item shrink
   below its content width. */
.gmg-ref-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-sha {
  font-family: var(--gmg-mono); font-size: 11px;
  padding: 1px 6px; border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  flex: none;
}
/* The subject is the only growing item in a row. The spacer stays in the markup
   (the group heads use the same shape) but must not grow here, or it would take
   half the free width and ellipsize the subject at 50% for no reason. */
.gmg-commit-row .gmg-spacer { flex: 0 0 0; }
.gmg-subject {
  flex: 1; min-width: 0; margin-left: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}
.gmg-commit-row.is-current .gmg-subject { font-weight: 600; }
.gmg-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.gmg-notice {
  display: flex; align-items: center; gap: 8px;
  /* wrap is what lets the error details drop to their own full-width row
     (flex-basis: 100% on .gmg-err-details); nothing wraps in the one-line
     notice, so this stays inert there. */
  flex-wrap: wrap;
  padding: 8px 12px; border-radius: 9px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gmg-notice.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); color: var(--dsw-alias-state-error-primary); }
.gmg-notice.is-warn { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); color: var(--dsw-alias-state-warn-primary); }
.gmg-notice.is-ok { color: var(--dsw-alias-state-success-primary); }
/* Every tone keeps its dismiss button stuck while the page scrolls, because
   a notice the user has scrolled past reads as no response. */
.gmg-notice.is-error, .gmg-notice.is-warn, .gmg-notice.is-ok { position: sticky; top: 8px; z-index: 5; }
/* Exit fade for an auto-dismissed notice. No prefers-reduced-motion branch on
   purpose: the JS removes the node on transitionend, and dropping this
   transition would leave the notice stuck on screen. */
.gmg-notice.is-fading { opacity: 0; transition: opacity .18s ease; }
/* Error readability (round2 E1 lineage): one line still answers what went
   wrong, and the details row opens the evidence — the argv, the stderr tail —
   instead of a wall of unparsed mono. */
.gmg-err-details {
  flex-basis: 100%;
  display: flex; flex-direction: column; gap: 4px;
  font-family: var(--gmg-mono); font-size: 11px; line-height: 1.5;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 160px; overflow: auto;
}
.gmg-err-argv { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.gmg-err-stderr { white-space: pre-wrap; word-break: break-word; }
.gmg-err-next { padding: 2px 0 0 22px; }
.gmg-icon-btn:focus-visible,
.gmg-file:focus-visible,
.gmg-branchitem:focus-visible,
.gmg-moreitem:focus-visible,
.gmg-morebtn:focus-visible,
/* GitHub tabs are plain buttons that never carry .gmg-btn, so without this
   they were the one control family with no keyboard focus ring at all
   (round2 C2). */
.gmg-gh-tab:focus-visible,
.gmg-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
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
.gmg-gh-row:hover { background: var(--gmg-hover); }
.gmg-gh-num { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); flex: none; }
.gmg-gh-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-gh-label { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.gmg-gh-tabs { display: flex; gap: 4px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-gh-tab { font-size: 12px; padding: 4px 9px; border-radius: 7px; cursor: pointer; color: var(--dsw-alias-label-secondary); border: 1px solid transparent; display: inline-flex; align-items: center; gap: 5px; }
.gmg-gh-tab.is-active { background: var(--gmg-hover); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
.gmg-gh-tab:hover { color: var(--dsw-alias-label-primary); }
.gmg-form { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.gmg-input {
  height: 28px; padding: 0 9px;
  border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; outline: none;
}
/* The ring is the textarea's (.gmg-textarea:focus), so the two form controls
   don't disagree on what "focused" looks like (round2 C3). */
.gmg-input:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
.gmg-hint { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
/* The amend preview quotes the message being rewritten: one clipped line is
   the point, and a 4px step keeps it from touching the textarea it previews. */
.gmg-amend-preview { margin: 0 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The merge-in-progress hint shares the commit foot's row and must be the side
   that yields: it grows, wraps on a 360px column, and the commit button keeps
   its place (same slot rule as .gmg-conflict-hint, opposite direction). */
.gmg-merge-hint { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.gmg-kbd { font-family: var(--gmg-mono); font-size: 10.5px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.gmg-scroll-cap { max-height: 320px; overflow: auto; }

/* ---- worktrees ---- */
.gmg-wts { display: flex; flex-direction: column; }
.gmg-wt {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 10px 5px 12px;
  min-height: 28px;
  font-size: 12px;
}
.gmg-wt:hover { background: var(--gmg-hover); }
.gmg-wt.is-current { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.gmg-wt-branch { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-primary); flex: none; max-width: 44%; }
.gmg-wt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gmg-mono); font-size: 11.5px; }
.gmg-wt-tag {
  flex: none; font-size: 10px; line-height: 1.6; padding: 0 5px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary);
}
.gmg-wt-tag.is-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
.gmg-wt-tag.is-current { color: var(--dsw-alias-brand-primary); border-color: transparent; padding: 0 2px; }
.gmg-wt-path { flex: 1; min-width: 0; color: var(--dsw-alias-label-secondary); opacity: .8; font-family: var(--gmg-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-wt-dirty { flex: none; font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.gmg-wt-dirty.is-dirty { color: var(--dsw-alias-state-warn-primary); }
.gmg-wt .gmg-actions { opacity: 0; }
.gmg-wt:hover .gmg-actions, .gmg-wt:focus-within .gmg-actions { opacity: 1; }

/* ---- the centre-column diff ---- */
.gmg-difftabtitle { display: inline-flex; align-items: center; gap: 3px; min-width: 0; }
.gmg-difftabname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-diffpanel { display: flex; flex-direction: column; height: 100%; background: var(--dsw-alias-bg-base); overflow: hidden; }
.gmg-diffhead {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  flex: none;
}
.gmg-diffpath { font-family: var(--gmg-mono); font-size: 12.5px; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-diffscroll { flex: 1; overflow: auto; }
.gmg-diffbody { font-family: var(--gmg-mono); font-size: 12px; line-height: 1.6; min-width: max-content; padding-bottom: 40px; }
.gmg-diffrow { display: grid; grid-template-columns: 54px 54px 1fr; align-items: start; }
.gmg-diffrow.is-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
.gmg-diffrow.is-del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.gmg-diffrow.is-hunk { background: var(--dsw-alias-bg-layer-2); }
.gmg-diff-no {
  color: var(--dsw-alias-label-secondary); opacity: .75;
  text-align: right; padding: 0 8px 0 2px;
  font-size: 11px; user-select: none;
  border-right: 1px solid var(--dsw-alias-border-l1);
  white-space: nowrap;
}
.gmg-diff-cell { padding: 0 12px; white-space: pre; color: var(--dsw-alias-label-primary); }
.gmg-diff-cell.is-add { color: var(--dsw-alias-state-success-primary); }
.gmg-diff-cell.is-del { color: var(--dsw-alias-state-error-primary); }
.gmg-diff-cell.is-hunk { grid-column: 1 / -1; color: var(--dsw-alias-brand-primary); padding: 3px 12px; font-size: 11px; }
.gmg-diff-cell.is-meta { grid-column: 1 / -1; color: var(--dsw-alias-label-secondary); opacity: .7; }
/* Side-by-side: let the body grow to its widest row so the scroll container
   offers one whole-body horizontal scrollbar — the same contract the unified
   view already has (min-width: max-content, line above) — instead of silently
   clipping every long line (poweruser G13). Each text track floors at its own
   max-content: a minmax(0, 1fr) track can end up narrower than one line when
   the two halves divide space equally, which is exactly the clip this fixes. */
.gmg-diffbody.is-split { min-width: max-content; width: 100%; }
.gmg-diffbody.is-split .gmg-diffrow.is-splitrow { grid-template-columns: 44px minmax(max-content, 1fr) 44px minmax(max-content, 1fr); }
.gmg-diffbody.is-split .gmg-diff-cell { overflow: hidden; }
/* Side-by-side tints each half, not the row: one row can carry a removal on
   the left and an addition on the right, and the gutters belong to that half. */
.gmg-diffbody.is-split .gmg-diff-cell.is-add,
.gmg-diffbody.is-split .gmg-diff-no.is-add {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
}
.gmg-diffbody.is-split .gmg-diff-cell.is-del,
.gmg-diffbody.is-split .gmg-diff-no.is-del {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
.gmg-diffbody.is-split .gmg-diffrow.is-splitrow > .gmg-diff-no:nth-child(3) { border-left: 1px solid var(--dsw-alias-border-l1); }
.gmg-diffbody.is-split .gmg-diff-cell.is-blank,
.gmg-diffbody.is-split .gmg-diff-no.is-blank { background: var(--dsw-alias-bg-layer-1); }
.gmg-diffbody.is-split .gmg-diff-cell.is-hunk { grid-column: 1 / -1; }

/* ---- hover detail: three zones, each with its own surface ---- */
.gmg-hovertarget { display: contents; }

.gmg-hover {
  position: fixed; z-index: 4000;
  max-width: 400px; min-width: 240px;
  padding: 0;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 93%, var(--dsw-alias-label-primary) 7%);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .5);
  font-size: 12px;
  overflow: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
}
.gmg-hovercard { display: flex; flex-direction: column; }
.gmg-hoverzone { padding: 8px 11px; }
.gmg-hoverzone.is-head {
  display: flex; align-items: center; gap: 7px;
  position: sticky; top: 0; z-index: 1;
  /* The card is portalled out of .gmg-root, so it reads the theme token
     directly rather than the panel's --gmg-hover. */
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.gmg-hoverzone.is-head .gmg-sha {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.gmg-hoverzone.is-subject {
  padding: 9px 11px;
  font-size: 13px; font-weight: 650; line-height: 1.45;
  color: var(--dsw-alias-label-primary);
}
.gmg-hoverzone.is-body {
  padding: 9px 11px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 45%, transparent);
  font-size: 11.5px; line-height: 1.6;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gmg-hoverzone.is-foot {
  display: flex; flex-direction: column; gap: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 65%, transparent);
}
.gmg-hoverauthor { font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-primary); opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-hoverdot { color: var(--dsw-alias-label-primary); opacity: .45; }
.gmg-hoversubject { font-weight: 600; font-size: 12.5px; line-height: 1.4; }

.gmg-hovertrack { margin-top: 5px; font-family: var(--gmg-mono); font-size: 11px; color: var(--dsw-alias-label-primary); opacity: .8; }
.gmg-hoverstats { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11.5px; color: var(--dsw-alias-label-primary); opacity: .9; }
.gmg-stat-sep { opacity: .45; }
.gmg-stat-add { color: var(--gmg-ok); font-family: var(--gmg-mono); font-weight: 600; }
.gmg-stat-del { color: var(--gmg-bad); font-family: var(--gmg-mono); font-weight: 600; }
.gmg-statbar { display: flex; height: 3px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-bg-base); }
.gmg-statbar-add { height: 100%; background: var(--gmg-ok); }
.gmg-statbar-del { height: 100%; background: var(--gmg-bad); }

/* Copy-sha + open-on-GitHub, one row over both portalled surfaces. Right
   aligned so it reads as an action row, not a stat; the compact 22px buttons
   keep the hover card from growing a whole row taller just for two marks. */
.gmg-quicklinks { display: flex; align-items: center; justify-content: flex-end; gap: 4px; flex: none; }
.gmg-quicklinks .gmg-icon-btn { width: 22px; height: 22px; }
.gmg-quicklinks a.gmg-icon-btn { text-decoration: none; }

/* ---- the commit-diff tab: one commit, every file stacked ---- */
.gmg-cdiff-head {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px 7px;
  border-bottom: 1px solid var(--gmg-edge);
  background: var(--dsw-alias-bg-base);
  flex: none;
}
.gmg-cdiff-headline { display: flex; align-items: center; gap: 6px; min-width: 0; }
.gmg-cdiff-headline .gmg-btn { flex: none; padding: 0 6px; }
.gmg-cdiff-subject { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gmg-cdiff-subline { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
.gmg-cdiff-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gmg-cdiff-scroll { flex: 1; overflow: auto; overscroll-behavior: contain; padding-bottom: 24px; }
.gmg-cdiff-files { display: flex; flex-direction: column; }
.gmg-cdiff-file { border-bottom: 1px solid var(--gmg-edge); }
/* Each file header sticks to the top of the scroll while its own diff passes
   under it, which is how a reader keeps track of which file is on screen. */
.gmg-cdiff-filehead {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 6px;
  background: var(--gmg-control);
  border-bottom: 1px solid var(--gmg-edge);
  cursor: pointer;
  font-size: 12px;
}
.gmg-cdiff-filehead:hover { background: var(--gmg-hover); }
.gmg-cdiff-filehead:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.gmg-cdiff-chevron { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); transition: transform .12s ease; }
.gmg-cdiff-file.is-folded .gmg-cdiff-chevron { transform: rotate(-90deg); }
.gmg-cdiff-rename { font-size: 10.5px; color: var(--dsw-alias-label-secondary); opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 38%; flex: none; }
.gmg-cdiff-body .gmg-diffbody { padding-bottom: 0; }
.gmg-cdiff-note { padding: 8px 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.gmg-cdiff-failure { display: flex; flex-direction: column; }

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
/* The aux trigger steps down with the compact bar (24 → 22, the same ladder
   as .gmg-collapse). */
.gmg-root.is-compact .gmg-morebtn { width: 22px; height: 22px; }
.gmg-root.is-compact .gmg-btn { padding: 0 8px; height: 25px; }
.gmg-root.is-compact .gmg-branch { max-width: 190px; }
.gmg-root.is-compact .gmg-group-head { padding: 7px 9px; }
.gmg-root.is-compact .gmg-file { padding: 4px 6px 4px 8px; gap: 6px; }
.gmg-root.is-compact .gmg-diff { margin-left: 4px; max-height: 320px; }
.gmg-root.is-compact .gmg-diff pre { font-size: 11px; }
.gmg-root.is-compact .gmg-gh-head { padding: 9px; gap: 8px; }
.gmg-root.is-compact .gmg-gh-desc { padding: 0 9px 9px !important; }
/* Compact narrows the row's right inset and the chips; the 22px height stays,
   because the graph's slice is drawn for it. */
.gmg-root.is-compact .gmg-commit-row { padding: 0 8px 0 0; }
.gmg-root.is-compact .gmg-ref { max-width: 84px; font-size: 10px; }
.gmg-root.is-compact .gmg-wt { padding: 5px 6px 5px 8px; gap: 5px; }
.gmg-root.is-compact .gmg-wt-path { display: none; }
.gmg-root.is-compact .gmg-meta { display: none; }
.gmg-root.is-compact .gmg-diffhead { padding: 8px; gap: 6px; }
.gmg-root.is-compact .gmg-diffpath { max-width: 100%; flex: 1; }
.gmg-root.is-compact .gmg-diffbody { font-size: 11.5px; }
.gmg-root.is-compact .gmg-diffrow { grid-template-columns: 40px 40px 1fr; }
.gmg-root.is-compact .gmg-diffbody.is-split .gmg-diffrow.is-splitrow { grid-template-columns: 34px minmax(max-content, 1fr) 34px minmax(max-content, 1fr); }
.gmg-root.is-compact .gmg-diff-no { padding: 0 5px 0 1px; }
.gmg-root.is-compact .gmg-diff-cell { padding: 0 8px; }
.gmg-root.is-compact .gmg-cdiff-head { padding: 7px 8px 6px; }
.gmg-root.is-compact .gmg-cdiff-subject { font-size: 12px; }
.gmg-root.is-compact .gmg-cdiff-filehead { padding: 4px 6px; }
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
