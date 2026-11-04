/**
 * Plugin wiring: dictionaries, styles, and the right-column tab.
 *
 * One seat: `sidebarRightTabs.register` declares the type (and the start-page
 * card), and two slots keyed by that id supply the tab body and its chip. The
 * body itself swaps between the change list and a file's diff, so opening a
 * diff never covers the conversation column.
 */

/** Dictionary namespace for this plugin's copy. */
const NS = 'dsh-git-management'

/** The right-column tab's id: the `sidebarRightTabs` registration and both slot keys. */
const TAB_ID = 'dsh-git-management'

/** The tab kind, i.e. what the column records for `openTab(kind)`. */
const TAB_KIND = 'git'

/** The second tab type: one file's diff, opened beside the change list. */
const DIFF_TAB_ID = 'dsh-git-diff'

/** The diff tab's kind, as `sidebarRight.openTab` names it. */
const DIFF_TAB_KIND = 'git-diff'

/** Chinese copy (the GUI's default language on this machine). */
const zh = {
  panelTitle: '源代码管理',
  guideDescription: '暂存、提交、分支与同步',
  noRepo: '未选择仓库',
  switchRepo: '切换仓库',
  refresh: '刷新',
  loadRepos: '重新读取工作区',
  notARepoShort: '非仓库',
  dismiss: '关闭提示',
  loading: '正在读取…',
  pickWorkspace: '选择一个工作区开始管理版本。',
  notARepo: '这个目录还不是 Git 仓库。',
  initRepo: '初始化仓库',
  initHint: '会在此目录执行 git init，不会创建提交。',
  staged: '已暂存的更改',
  changes: '更改',
  noChanges: '没有未暂存的更改。',
  conflicts: '冲突',
  history: '历史提交',
  showMore: '显示全部',
  showLess: '收起',
  noCommits: '还没有提交。',
  branch: '当前分支',
  detached: '游离 HEAD',
  switchBranch: '切换分支',
  notPublished: '尚未发布到远端',
  fetch: '获取',
  fetchHint: 'git fetch --prune origin',
  pull: '拉取',
  pullHint: 'git pull --ff-only（只做快进合并）',
  push: '推送',
  pushHint: '首次推送会自动建立上游分支',
  newBranch: '新建分支',
  newBranchPlaceholder: '新分支名，例如 feature/panel',
  create: '创建',
  commitPlaceholder: '提交信息（Ctrl+Enter 提交）',
  stageAll: '全部暂存',
  amend: '修改上次提交',
  stagedCount: '项已暂存',
  changesCount: '项未暂存',
  commit: '提交',
  commitHint: '提交已暂存的更改',
  unstageAll: '全部取消暂存',
  stageAllFiles: '全部暂存',
  unstage: '取消暂存',
  stage: '暂存',
  discard: '放弃更改',
  delete: '删除文件',
  discardConfirm: '放弃对 {file} 的更改？此操作不可撤销。',
  deleteConfirm: '删除未跟踪的文件 {file}？此操作不可撤销。',
  discarded: '已放弃更改',
  deleted: '已删除文件',
  status: '状态',
  loadingDiff: '正在读取差异…',
  binaryDiff: '二进制文件，无法显示差异。',
  emptyDiff: '没有文本差异。',
  githubLoading: '正在检查 GitHub 远端…',
  noGithubRemote: '当前仓库没有 GitHub 远端（origin）。',
  stars: '星标',
  forks: '复刻',
  openIssues: '未关闭议题',
  openOnGithub: '在 GitHub 打开',
  newPull: '新建 PR',
  pullTitleDefault: '更新',
  connectGithub: '连接 GitHub',
  tokenHint: '需要一个 GitHub 个人访问令牌（classic 或 fine-grained）来读取议题与创建 PR。令牌只保存在这个浏览器里。',
  save: '保存',
  createToken: '创建令牌',
  tokenScope: 'classic 令牌需要 repo 权限；fine-grained 令牌需要目标仓库的 Contents 与 Pull requests 读写权限。推送本身走你本机 git 的凭据（SSH 或 credential manager），与这里的令牌无关。',
  pulls: '拉取请求',
  issues: '议题',
  noPulls: '没有打开的拉取请求。',
  noIssues: '没有打开的议题。',
  draft: '草稿',
  pullTitle: '标题',
  pullBody: '说明（可选）',
  baseBranch: '目标分支',
  cancel: '取消',
  createPull: '创建',
  worktrees: '工作樹',
  worktreeMain: '主',
  worktreeClean: 'clean',
  worktreeSwitch: '把面板切到此工作樹',
  worktreeOpen: '在 DSH 開成工作區',
  worktreeRemove: '移除工作樹',
  worktreeNew: '新增工作樹',
  worktreePrune: '清理失效記錄（git worktree prune）',
  worktreeNamePlaceholder: '名稱，例如 fix-ui',
  worktreeLayoutHint: '會建立在 .agents/worktrees/<名稱>，分支 worktree-<名稱>',
  worktreeBranchPreview: '將建立',
  worktreeRemoveConfirm: '移除工作樹 {path}？裡面未提交的內容會一併消失。',
  worktreeNone: '目前只有這一個工作樹。',
  worktreeStale: '宿主端還是舊版（沒有工作樹 API）。關視窗不會結束背景程序——請從選單或托盤「完全結束」DSH Desktop 再開。',
  openDiffHint: '開啟這個檔案的差異',
  diffBack: '返回',
  diffBackHint: '關閉差異檢視（Esc）',
  diffPrev: '上一個檔案',
  diffNext: '下一個檔案',
  diffSplit: '並排',
  diffUnified: '統一',
  diffShowStaged: '看已暫存',
  diffShowWorktree: '看工作區',
  diffStagedBadge: '已暫存',
  diffWorktreeBadge: '未暫存',
  diffNothingOpen: '從右側的變更清單點一個檔案。',
  diffTabTitle: '檔案差異',
  hoverLoading: '讀取中…',
  hoverStatLine: '{files} 個檔案變更，{additions} 行插入(+)，{deletions} 行刪除(-)',
  hoverNoBranch: '這個分支還沒有提交。',
}

/** English copy. */
const en = {
  panelTitle: 'Source Control',
  guideDescription: 'Stage, commit, branch and sync',
  noRepo: 'No repository selected',
  switchRepo: 'Switch repository',
  refresh: 'Refresh',
  loadRepos: 'Re-read workspaces',
  notARepoShort: 'no repo',
  dismiss: 'Dismiss',
  loading: 'Reading…',
  pickWorkspace: 'Pick a workspace to start tracking its history.',
  notARepo: 'This directory is not a Git repository yet.',
  initRepo: 'Initialise repository',
  initHint: 'Runs git init here. No commit is created.',
  staged: 'Staged changes',
  changes: 'Changes',
  noChanges: 'No unstaged changes.',
  conflicts: 'Conflicts',
  history: 'Recent commits',
  showMore: 'Show all',
  showLess: 'Show fewer',
  noCommits: 'No commits yet.',
  branch: 'Current branch',
  detached: 'detached HEAD',
  switchBranch: 'Switch branch',
  notPublished: 'not published to a remote',
  fetch: 'Fetch',
  fetchHint: 'git fetch --prune origin',
  pull: 'Pull',
  pullHint: 'git pull --ff-only (fast-forward only)',
  push: 'Push',
  pushHint: 'The first push publishes the branch and sets its upstream',
  newBranch: 'New branch',
  newBranchPlaceholder: 'new branch, e.g. feature/panel',
  create: 'Create',
  commitPlaceholder: 'Commit message (Ctrl+Enter to commit)',
  stageAll: 'Stage all',
  amend: 'Amend last commit',
  stagedCount: 'staged',
  changesCount: 'unstaged',
  commit: 'Commit',
  commitHint: 'Commit the staged changes',
  unstageAll: 'Unstage all',
  stageAllFiles: 'Stage all files',
  unstage: 'Unstage',
  stage: 'Stage',
  discard: 'Discard changes',
  delete: 'Delete file',
  discardConfirm: 'Discard changes in {file}? This cannot be undone.',
  deleteConfirm: 'Delete the untracked file {file}? This cannot be undone.',
  discarded: 'Changes discarded',
  deleted: 'File deleted',
  status: 'Status',
  loadingDiff: 'Reading the diff…',
  binaryDiff: 'Binary file; no textual diff.',
  emptyDiff: 'No textual difference.',
  githubLoading: 'Looking for a GitHub remote…',
  noGithubRemote: 'This repository has no GitHub remote (origin).',
  stars: 'Stars',
  forks: 'Forks',
  openIssues: 'Open issues',
  openOnGithub: 'Open on GitHub',
  newPull: 'New pull request',
  pullTitleDefault: 'Update',
  connectGithub: 'Connect GitHub',
  tokenHint: 'A GitHub personal access token (classic or fine-grained) is needed to read issues and open pull requests. It is stored in this browser only.',
  save: 'Save',
  createToken: 'Create token',
  tokenScope: 'A classic token needs the repo scope; a fine-grained token needs Contents and Pull requests read/write on the target repository. Pushing itself uses your machine’s own git credentials (SSH or credential manager), not this token.',
  pulls: 'Pull requests',
  issues: 'Issues',
  noPulls: 'No open pull requests.',
  noIssues: 'No open issues.',
  draft: 'draft',
  pullTitle: 'Title',
  pullBody: 'Description (optional)',
  baseBranch: 'base branch',
  cancel: 'Cancel',
  createPull: 'Create',
  worktrees: 'Worktrees',
  worktreeMain: 'main',
  worktreeClean: 'clean',
  worktreeSwitch: 'Point the panel at this worktree',
  worktreeOpen: 'Open as a DSH workspace',
  worktreeRemove: 'Remove worktree',
  worktreeNew: 'New worktree',
  worktreePrune: 'Prune stale records',
  worktreeNamePlaceholder: 'name, e.g. fix-ui',
  worktreeLayoutHint: 'Created at .agents/worktrees/<name> on branch worktree-<name>',
  worktreeBranchPreview: 'Will create',
  worktreeRemoveConfirm: 'Remove worktree {path}? Uncommitted work inside it is lost.',
  worktreeNone: 'This is the only worktree.',
  worktreeStale: 'The host is still the older build (no worktree API). Closing the window keeps the background process alive — fully quit DSH Desktop and relaunch.',
  openDiffHint: 'Open this file’s diff',
  diffBack: 'Back',
  diffBackHint: 'Close the diff view (Esc)',
  diffPrev: 'Previous file',
  diffNext: 'Next file',
  diffSplit: 'Split',
  diffUnified: 'Unified',
  diffShowStaged: 'Show staged',
  diffShowWorktree: 'Show working tree',
  diffStagedBadge: 'staged',
  diffWorktreeBadge: 'working tree',
  diffNothingOpen: 'Pick a file in the change list on the right.',
  diffTabTitle: 'File diff',
  hoverLoading: 'Reading…',
  hoverStatLine: '{files} files changed, {additions} insertions(+), {deletions} deletions(-)',
  hoverNoBranch: 'This branch has no commits yet.',
}

/**
 * The diff tab's body.
 *
 * The file to show arrives as the tab's navigation parameters — `openTab(kind,
 * { params })` records them, and `useTabNavigation` is this seat's hook onto
 * that record, so re-opening the tab for another file only bumps `revision`.
 *
 * @param props - session-scoped slot props plus `useTabNavigation` and `t`.
 * @returns the boundary element wrapping the diff.
 */
function DiffTabBody(props) {
  const useNavigation = typeof props.useTabNavigation === 'function' ? props.useTabNavigation : () => null
  const navigation = useNavigation((snapshot) => snapshot)
  const params = navigation?.params ?? null
  const revision = navigation?.revision ?? 0

  useEffect(() => {
    if (params !== null && typeof params.file === 'string' && typeof params.path === 'string') openDiff(params)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the
    // signal that the opener asked for this file, even when it is the same one.
  }, [revision])

  const close = () => {
    const actions = props.actions
    if (actions !== undefined && typeof actions.close === 'function') actions.close()
    else closeDiff()
  }

  return h(PanelBoundary, { ...props, compact: true, seat: 'diff', onClose: close })
}

/**
 * The diff tab's chip: the file name, so a strip of tabs says which is which.
 * @param props - slot props plus `useTabNavigation` and `t`.
 * @returns the title element.
 */
function DiffTabTitle(props) {
  const useNavigation = typeof props.useTabNavigation === 'function' ? props.useTabNavigation : () => null
  const navigation = useNavigation((snapshot) => snapshot)
  const params = navigation?.params ?? null
  const t = typeof props?.t === 'function' ? props.t : tr
  const file = typeof params?.file === 'string' ? params.file : t('diffTabTitle')
  const slash = file.lastIndexOf('/')
  return h(
    'span',
    { className: 'gmg-difftabtitle' },
    h(IconChevronRight, { size: 11 }),
    h('span', { className: 'gmg-difftabname', title: file }, slash === -1 ? file : file.slice(slash + 1)),
    params?.staged === true ? h('span', { className: 'gmg-gh-label' }, t('diffStagedBadge')) : null,
  )
}

/**
 * The tab body: either the change list or, when the seat says so, the diff.
 *
 * Both live in the same column; the diff is a tab of its own so opening one
 * leaves the change list — and the conversation — exactly where they were.
 *
 * @param props - session-scoped slot props.
 * @returns the panel element.
 */
function GitTabShell(props) {
  return props.seat === 'diff' ? h(DiffPanel, props) : h(GitPanel, props)
}

/**
 * The tab body wrapped in the crash boundary, told it lives in a narrow column.
 * @param props - session-scoped slot props.
 * @returns the boundary element.
 */
function GitTabBody(props) {
  return h(PanelBoundary, { ...props, compact: true, seat: 'list' })
}

/**
 * Error boundary: a crash inside the panel renders one readable line instead
 * of taking the whole main column down with it.
 */
class PanelBoundary extends react.Component {
  /** @param props - slot props. */
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  /**
   * Capture a render failure.
   * @param error - the thrown value.
   * @returns the next state.
   */
  static getDerivedStateFromError(error) {
    return { error }
  }

  /**
   * Log the failure once, so the console names the plugin.
   * @param error - the thrown value.
   */
  componentDidCatch(error) {
    console.error('[dsh-git-management] panel crashed:', error)
  }

  /**
   * Render the panel, or the failure line.
   * @returns the element.
   */
  render() {
    if (this.state.error !== null) {
      return h(
        'div',
        { className: 'gmg-root' },
        h(
          'div',
          { className: 'gmg-page' },
          h(
            'div',
            { className: 'gmg-notice is-error' },
            h('span', null, `Source Control failed to render: ${String(this.state.error?.message ?? this.state.error)}`),
          ),
        ),
      )
    }
    return h(GitTabShell, this.props)
  }
}

/**
 * Cordis plugin body: dictionaries, styles, a right-column tab type, and the
 * two slots that type needs.
 *
 * The right column is a tabbed pane (`ui-sidebar-right`), not a list of
 * panels: a tab is declared once through `sidebarRightTabs.register`, which
 * also owns the card that appears on the column's start page beside Files and
 * New terminal, and twice through slots (body + chip title), keyed by the same
 * tab id.
 *
 * @param ctx - the client plugin context.
 */
exports.apply = function apply(ctx) {
  // One inject for the services this plugin cannot work without: a throw here
  // would take the whole web boot down, so the wiring is also contained.
  ctx.inject(['slots', 'locale', 'sidebarRightTabs'], (scoped) => {
    try {
      scoped.effect(() => scoped.locale.register(NS, { zh, en }), 'dsh-git-management: dictionaries')

      const t = scoped.locale.bind(NS)
      // Components read copy through this binding; the registrations below also
      // hand `t` in as a prop, and either path resolves to the same dictionary.
      gmgTranslate = t

      scoped.effect(() => installPanelStyles(), 'dsh-git-management: panel styles')

      // The tab type: `title` is the tab strip's chip text, `guide` is the one
      // card this plugin contributes to the column's start page.
      scoped.effect(
        () =>
          scoped.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            title: () => t('panelTitle'),
            guide: [
              {
                id: 'source-control',
                order: 30,
                title: () => t('panelTitle'),
                description: () => t('guideDescription'),
                icon: IconBranch,
              },
            ],
          }),
        'dsh-git-management: source control tab type',
      )

      // Both seats wait on `slots.inject`: a slot is only registerable once its
      // declaring entry has run.
      scoped.slots.inject('sidebar.right.pane.tab', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
            inject: () => ({ t, lang: scoped.locale.getLocale().active }),
          },
          GitTabBody,
        ),
      )

      scoped.slots.inject('sidebar.right.pane.tab.title', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
            locale: NS,
            inject: () => ({ t }),
          },
          GitTabTitle,
        ),
      )

      // The second type: one file's diff as its own tab. No guide entry — this
      // tab is only ever reached from a row in the list, never from the start
      // page, and `multiple: false` makes a second click re-navigate the same
      // tab instead of piling up one tab per file.
      scoped.effect(
        () =>
          scoped.sidebarRightTabs.register({
            id: DIFF_TAB_ID,
            kind: DIFF_TAB_KIND,
            priority: 'extension',
            title: () => t('diffTabTitle'),
            guide: [],
          }),
        'dsh-git-management: diff tab type',
      )

      scoped.slots.inject('sidebar.right.pane.tab', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: DIFF_TAB_ID,
            locale: NS,
            inject: () => ({ t }),
          },
          DiffTabBody,
        ),
      )

      scoped.slots.inject('sidebar.right.pane.tab.title', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab.title',
            key: DIFF_TAB_ID,
            locale: NS,
            inject: () => ({ t }),
          },
          DiffTabTitle,
        ),
      )

      console.log('[dsh-git-management] tabs registered (source control + file diff)')
    } catch (error) {
      console.error('[dsh-git-management] mount failed:', error)
    }
  })

  // Opening a file's diff is a tab open in the same column: the change list and
  // the conversation both stay exactly where the user left them.
  ctx.inject(['sidebarRight'], (scoped) => {
    gmgSidebarBridge = {
      openDiff: (params) => {
        try {
          scoped.sidebarRight.openTab(DIFF_TAB_KIND, { params })
        } catch (error) {
          console.error('[dsh-git-management] could not open the diff tab:', error)
        }
      },
    }
  })

  // The worktree rows' "open as a workspace" action: create the workspace
  // (idempotent per canonical path) and hand the user to it. Optional services,
  // so a GUI without them simply renders the action as unavailable.
  ctx.inject(['workspaces', 'uiWorkspace'], (scoped) => {
    gmgWorkspaceBridge = async (path) => {
      const view = await scoped.workspaces.create({ path })
      await scoped.uiWorkspace.openWorkspace(view.id)
      return view
    }
  })
}
