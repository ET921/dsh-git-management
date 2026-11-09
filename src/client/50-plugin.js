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

/**
 * The third tab type: one commit's whole change set.
 *
 * Registered `multiple: true`, which is what makes every history click its own
 * tab — the same independent-instance rule the terminal tabs use. Without it
 * the column would reuse one tab and a second commit would replace the first.
 */
const COMMIT_TAB_ID = 'dsh-git-commit'

/** The commit tab's kind, as `sidebarRight.openTab` names it. */
const COMMIT_TAB_KIND = 'git-commit'

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
  history: 'Graph',
  showMore: '显示全部',
  showLess: '收起',
  showScopeHead: '我的分支',
  showScopeAll: '全部引用',
  scopeHeadHint: '只看当前分支：同事推到远端的分支不会出现在这里',
  scopeAllHint: '本地与远端分支、标签全画在一起：按「获取」后，同事推上来的分支会出现在这里，便于跟踪与合并',
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
  amendPreview: '将改写 {short} · {subject}',
  amendStageAllConfirm: '这次 amend 会先暂存全部更改，再改写上一笔提交——范围可能比你打的字多。继续？',
  finishMergeHint: '合并进行中：按「提交」完成这次合并，或按「中止合并」放弃。',
  rebaseInProgressHint: 'rebase 进行中：请在终端执行 git rebase --continue 或 --abort。',
  cherryPickInProgressHint: 'cherry-pick 进行中：请在终端执行 git cherry-pick --continue 或 --abort。',
  markResolved: '标记为已解决',
  conflictBlockHint: '有未解决的冲突——解决后逐档标记。',
  abortMerge: '中止合并',
  mergeAbortConfirm: '中止这次合并？工作区会回到合并前的状态。',
  stagedCount: '项已暂存',
  changesCount: '项未暂存',
  commit: '提交',
  commitHint: '提交已暂存的更改',
  commitNeedsMessage: '先写提交信息',
  commitNeedsStaged: '先暂存至少一个文件',
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
  lastSynced: '更新于 {ago}',
  copySha: '复制提交号',
  copied: '已复制',
  openCommitOnGithub: '在 GitHub 打开此提交',
  loadingDiff: '正在读取差异…',
  binaryDiff: '二进制文件，无法显示差异。',
  diffUnmerged: '这个文件有未解决的冲突——先解决，再标记为已解决。',
  emptyDiff: '没有文本差异。',
  githubLoading: '正在检查 GitHub 远端…',
  retryGithub: '重新检查',
  loadReposFailed: '读不到工作区列表——可能是宿主端还没准备好。',
  noGithubRemote: '当前仓库没有 GitHub 远端（origin）。',
  stars: '星标',
  forks: '复刻',
  openIssues: '未关闭议题',
  openOnGithub: '在 GitHub 打开',
  newPull: '新建 PR',
  pullTitleDefault: '更新',
  connectGithub: '连接 GitHub',
  tokenHint: '需要一个 GitHub 个人访问令牌（classic 或 fine-grained）来读取议题与创建 PR。令牌储存在本机的 DSH 凭证存放区（与模型 API key 同一个受保护的存放区），重新载入或重启后仍然有效；随时可以按「忘记令牌」清除。',
  save: '保存',
  createToken: '创建令牌',
  forgetToken: '忘记令牌',
  forgetTokenHint: '从本机 DSH 凭证存放区删除已储存的 GitHub 令牌',
  tokenSaved: 'GitHub 令牌已储存',
  tokenForgotten: '已删除储存的 GitHub 令牌',
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
  diffRetry: '重試',
  bareBadge: '唯讀（bare）',
  bareReadonlyHint: '這是 bare 倉庫：沒有工作樹，不能暫存或提交；仍可 fetch 與瀏覽歷史。',
  moreActions: '更多操作（貯藏）',
  stashPush: '儲存貯藏…',
  stashPushHint: '把目前的工作區改動收進 stash（不含未追蹤檔）',
  stashPop: '取出貯藏',
  stashPopHint: '套用最新一筆 stash；衝突會落到衝突組',
  stashMessagePrompt: '貯藏說明（可留空）',
  pullMenuTitle: '拉取方式',
  pullFf: '快進合併',
  pullFfHint: 'git pull --ff-only：只做快進，分歧時失敗',
  pullMerge: '同步（合併）',
  pullMergeHint: 'git pull --no-rebase：產生合併提交，衝突落到衝突組',
  errorDetails: '詳情',
  errorHideDetails: '收起',
  errorCopy: '複製診斷',
  errorCopied: '已複製',
  errorCopyHint: '複製命令、退出碼與 stderr，貼到終端即可重現',
  errorExit: '退出碼 {code}',
  errNonFastForward: '已分歧：用 Pull 旁的「同步（合併）」，或在終端 git pull --rebase。',
  errOperation: '有其他 git 操作進行中：先在終端完成或中止，再回來。',
  errStaleHost: 'host 尚未重啟：新的動作還不存在，重啟外掛程序後再試。',
  errTimeout: '操作逾時：網路或磁碟太慢，可重試。',
  errLocked: '倉庫被鎖（index.lock）：確認沒有其他 git 程序後，刪掉該鎖檔再試。',
  errAuth: 'GitHub 認證失敗或額度用盡：檢查令牌與額度。',
  errArgument: '參數被拒絕：若你沒有改設定，這是面板的問題，請回報。',
  errDirtySwitch: '本機改動會被覆蓋：先提交或貯藏，再切換。',
  errHook: '提交被 git hook 拒絕：詳情裡有 hook 的 stderr。',
  diffPrev: '上一個檔案',
  diffNext: '下一個檔案',
  diffSplit: '並排',
  diffUnified: '統一',
  diffFullFile: '全文',
  diffOnlyChanges: '僅變更',
  diffContextHint: '切換顯示範圍（全文／僅變更）',
  diffShowStaged: '看已暫存',
  diffShowWorktree: '看工作區',
  diffStagedBadge: '已暫存',
  diffWorktreeBadge: '未暫存',
  diffNothingOpen: '從右側的變更清單點一個檔案。',
  diffTabTitle: '檔案差異',
  commitDiffTabTitle: '提交差異',
  commitDiffLoading: '正在讀取這次提交的變更…',
  commitDiffEmpty: '這次提交沒有檔案變更。',
  commitDiffBinaryBadge: '二進位',
  commitDiffBinary: '二進位檔，不顯示差異。',
  commitDiffNoText: '沒有文字差異。',
  commitDiffModeOnly: '只改了檔案權限（mode），內容沒有變。',
  commitDiffFileCount: '{files} 個檔案',
  commitDiffMergeBadge: '合併',
  commitDiffExpandAll: '展開全部',
  commitDiffCollapseAll: '收合全部',
  commitDiffTruncated: '共 {total} 個檔案，這裡只載入前 {shown} 個的差異。',
  commitDiffRetry: '重試',
  commitDiffStale: '宿主端還是舊版，沒有 commitDiff 這個動作。Ctrl+R 只重載頁面——請從選單／托盤「完全結束」DSH Desktop 再開。',
  hoverLoading: '讀取中…',
  hoverStatFiles: '{files} 個檔案變更',
  hoverStatAdditions: '{additions} 行插入(+)',
  hoverStatDeletions: '{deletions} 行刪除(-)',
  hoverStatSeparator: '，',
  hoverNoBranch: '這個分支還沒有提交。',
  refHead: '目前檢出（本機）',
  refLocal: '本機分支',
  refRemote: '遠端分支',
  refTag: '標籤',
  refDetached: '分離 HEAD',
  collapseGroup: '收合這一組',
  expandGroup: '展開這一組',
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
  history: 'Graph',
  showMore: 'Show all',
  showLess: 'Show fewer',
  showScopeHead: 'My branch',
  showScopeAll: 'All refs',
  scopeHeadHint: 'Your checked-out line only: branches a colleague pushed to the remote stay out of this view',
  scopeAllHint: 'Every local and remote branch and tag on one rail: after Fetch, a colleague’s pushed branch appears here to track and merge',
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
  amendPreview: 'Will rewrite {short} · {subject}',
  amendStageAllConfirm: 'This amend stages every change first and rewrites the last commit — the range may be wider than what you typed. Continue?',
  finishMergeHint: 'Merge in progress: press Commit to finish it, or Abort merge to back out.',
  rebaseInProgressHint: 'Rebase in progress: finish it in a terminal with git rebase --continue or --abort.',
  cherryPickInProgressHint: 'Cherry-pick in progress: finish it in a terminal with git cherry-pick --continue or --abort.',
  markResolved: 'Mark resolved',
  conflictBlockHint: 'Unresolved conflicts — resolve, then mark each file.',
  abortMerge: 'Abort merge',
  mergeAbortConfirm: 'Abort this merge? The working tree goes back to how it was before.',
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
  lastSynced: 'Updated {ago}',
  copySha: 'Copy commit id',
  copied: 'Copied',
  openCommitOnGithub: 'Open this commit on GitHub',
  loadingDiff: 'Reading the diff…',
  binaryDiff: 'Binary file; no textual diff.',
  diffUnmerged: 'This file still has unresolved conflicts — resolve them, then mark it resolved.',
  emptyDiff: 'No textual difference.',
  githubLoading: 'Looking for a GitHub remote…',
  retryGithub: 'Check again',
  loadReposFailed: 'Could not read the workspace list — the host may not be ready yet.',
  noGithubRemote: 'This repository has no GitHub remote (origin).',
  stars: 'Stars',
  forks: 'Forks',
  openIssues: 'Open issues',
  openOnGithub: 'Open on GitHub',
  newPull: 'New pull request',
  pullTitleDefault: 'Update',
  connectGithub: 'Connect GitHub',
  tokenHint: 'A GitHub personal access token (classic or fine-grained) is needed to read issues and open pull requests. It is stored in the local DSH credential store (the same protected store as model API keys), so it survives reloads and restarts; “Forget token” removes it at any time.',
  save: 'Save',
  createToken: 'Create token',
  forgetToken: 'Forget token',
  forgetTokenHint: 'Delete the stored GitHub token from the local DSH credential store',
  tokenSaved: 'GitHub token saved',
  tokenForgotten: 'Stored GitHub token removed',
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
  diffRetry: 'Retry',
  bareBadge: 'Read-only (bare)',
  bareReadonlyHint: 'This is a bare repository: no worktree, so nothing can be staged or committed. Fetch and history still work.',
  moreActions: 'More actions (stash)',
  stashPush: 'Stash changes…',
  stashPushHint: 'Put the current worktree changes into the stash (untracked files excluded)',
  stashPop: 'Pop stash',
  stashPopHint: 'Apply the newest stash entry; conflicts land in the conflicts group',
  stashMessagePrompt: 'Stash message (optional)',
  pullMenuTitle: 'Pull strategy',
  pullFf: 'Fast-forward',
  pullFfHint: 'git pull --ff-only: fast-forward only, and fails when diverged',
  pullMerge: 'Sync (merge)',
  pullMergeHint: 'git pull --no-rebase: creates a merge commit, conflicts land in the conflicts group',
  errorDetails: 'Details',
  errorHideDetails: 'Hide',
  errorCopy: 'Copy diagnostics',
  errorCopied: 'Copied',
  errorCopyHint: 'Copy the command, exit code and stderr so it can be replayed in a terminal',
  errorExit: 'exit {code}',
  errNonFastForward: 'Diverged: use Sync (merge) next to Pull, or git pull --rebase in a terminal.',
  errOperation: 'Another git operation is in progress: finish or abort it in a terminal first.',
  errStaleHost: 'The host process is older than this page: the action does not exist yet — restart the plugin process.',
  errTimeout: 'Timed out: the network or disk was too slow. Retry.',
  errLocked: 'The repository is locked (index.lock): make sure no other git process is running, then remove the lock file.',
  errAuth: 'GitHub authentication failed or the quota is spent: check the token and its rate limit.',
  errArgument: 'The host rejected an argument: if you changed nothing, this is a panel bug — please report it.',
  errDirtySwitch: 'Local changes would be overwritten: commit or stash them before switching.',
  errHook: 'A git hook refused the commit: the details hold its stderr.',
  diffPrev: 'Previous file',
  diffNext: 'Next file',
  diffSplit: 'Split',
  diffUnified: 'Unified',
  diffFullFile: 'Whole file',
  diffOnlyChanges: 'Changes only',
  diffContextHint: 'Toggle how much context the diff carries',
  diffShowStaged: 'Show staged',
  diffShowWorktree: 'Show working tree',
  diffStagedBadge: 'staged',
  diffWorktreeBadge: 'working tree',
  diffNothingOpen: 'Pick a file in the change list on the right.',
  diffTabTitle: 'File diff',
  commitDiffTabTitle: 'Commit diff',
  commitDiffLoading: 'Reading this commit’s changes…',
  commitDiffEmpty: 'This commit changed no files.',
  commitDiffBinaryBadge: 'binary',
  commitDiffBinary: 'Binary file; no textual diff.',
  commitDiffNoText: 'No textual difference.',
  commitDiffModeOnly: 'Only the file mode changed; the contents did not.',
  commitDiffFileCount: '{files} files',
  commitDiffMergeBadge: 'merge',
  commitDiffExpandAll: 'Expand all',
  commitDiffCollapseAll: 'Collapse all',
  commitDiffTruncated: '{total} files in all; the diffs for the first {shown} are shown here.',
  commitDiffRetry: 'Retry',
  commitDiffStale: 'The host is still the older build (no commitDiff action). Reloading the page cannot load it — fully quit DSH Desktop and relaunch.',
  hoverLoading: 'Reading…',
  hoverStatFiles: '{files} files changed',
  hoverStatAdditions: '{additions} insertions(+)',
  hoverStatDeletions: '{deletions} deletions(-)',
  hoverStatSeparator: ', ',
  hoverNoBranch: 'This branch has no commits yet.',
  refHead: 'checked out here',
  refLocal: 'local branch',
  refRemote: 'remote branch',
  refTag: 'tag',
  refDetached: 'detached HEAD',
  collapseGroup: 'Collapse this group',
  expandGroup: 'Expand this group',
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
  return h(PanelBoundary, { ...props, compact: true, seat: 'diff' })
}

/**
 * The diff seat inside the boundary: reads the tab's navigation parameters and
 * keeps the diff store pointed at them.
 *
 * Reading `useTabInfo` here rather than in `DiffTabBody` keeps a throw from the
 * column (a tab that is not committed yet) inside the crash boundary, where it
 * costs one error card instead of the whole tab strip.
 *
 * @param props - slot props plus `useTabInfo`, `actions` and `t`.
 * @returns the diff panel.
 */
function DiffPanelSeat(props) {
  const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
  const info = useInfo()
  const navigation = info?.tab?.navigation ?? null
  const params = navigation?.params ?? null
  const revision = navigation?.revision ?? 0

  useEffect(() => {
    if (params !== null && typeof params.file === 'string' && typeof params.path === 'string') openDiff(params)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the
    // signal that the opener asked for this file, even when it is the same one.
  }, [revision])

  const close = () => {
    if (typeof props.actions?.close === 'function') props.actions.close()
    else closeDiff()
  }

  return h(DiffPanel, { ...props, compact: true, onClose: close })
}

/**
 * The diff tab's chip: the file name, so a strip of tabs says which is which.
 * @param props - slot props plus `useTabNavigation` and `t`.
 * @returns the title element.
 */
function DiffTabTitle(props) {
  const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
  const info = useInfo()
  const params = info?.tab?.navigation?.params ?? null
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
 * The commit tab's body, inside the crash boundary.
 * @param props - slot props.
 * @returns the boundary element.
 */
function CommitTabBody(props) {
  return h(PanelBoundary, { ...props, compact: true, seat: 'commit' })
}

/**
 * The commit seat: reads the tab's own parameters and keeps its cached view
 * pointed at them.
 *
 * Each commit tab is an independent occurrence (`multiple: true`), so this hook
 * is what gives every tab its own commit: the params arrive per tab, the cache
 * is keyed by them, and a re-navigation of the same tab only bumps `revision`.
 *
 * @param props - slot props plus `useTabInfo`, `actions` and `t`.
 * @returns the commit panel.
 */
function CommitPanelSeat(props) {
  const useInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo : () => ({ tab: null })
  const info = useInfo()
  const navigation = info?.tab?.navigation ?? null
  const params = navigation?.params ?? null
  const revision = navigation?.revision ?? 0
  const path = typeof params?.path === 'string' ? params.path : null
  const sha = typeof params?.sha === 'string' ? params.sha : null
  const key = path === null || sha === null ? null : commitViewKey(path, sha)
  const view = useCommitView(key)

  // While this tab is on screen its entry is pinned, so the cache trim cannot
  // evict the commit a reader is looking at.
  useEffect(() => pinCommitView(key), [key])

  useEffect(() => {
    if (path !== null && sha !== null) loadCommitDiff({ path, sha })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the
    // signal that the opener asked for this commit, even when it is the same one.
  }, [revision, key])

  // A cache that dropped this entry (it was the oldest) is re-read rather than
  // leaving an empty tab behind.
  useEffect(() => {
    if (path !== null && sha !== null && view === null) loadCommitDiff({ path, sha })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view === null])

  const close = () => {
    if (typeof props.actions?.close === 'function') props.actions.close()
  }
  const retry = () => {
    if (path !== null && sha !== null) loadCommitDiff({ path, sha })
  }

  // A tab that is not the visible one in a split strip must not answer Escape.
  const active = info?.tab?.visible !== false
  return h(CommitDiffPanel, { ...props, params, view, active, onClose: close, onRetry: retry })
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
    const Comp = this.props.seat === 'diff' ? DiffPanelSeat : this.props.seat === 'commit' ? CommitPanelSeat : GitPanel
    return h(Comp, this.props)
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
      // page. It is not `multiple`, so the column dedupes it: a second click
      // re-navigates the same tab instead of piling up one tab per file.
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

      // The third type: one commit's whole change set. `multiple: true` is the
      // point — every history click is its own tab, so two commits can be read
      // side by side. The column gives each open its own occurrence id, which
      // is also why the body reads the commit from its own navigation params.
      scoped.effect(
        () =>
          scoped.sidebarRightTabs.register({
            id: COMMIT_TAB_ID,
            kind: COMMIT_TAB_KIND,
            priority: 'extension',
            multiple: true,
            title: () => t('commitDiffTabTitle'),
            guide: [],
          }),
        'dsh-git-management: commit diff tab type',
      )

      scoped.slots.inject('sidebar.right.pane.tab', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: COMMIT_TAB_ID,
            locale: NS,
            inject: () => ({ t, lang: scoped.locale.getLocale().active }),
          },
          CommitTabBody,
        ),
      )

      scoped.slots.inject('sidebar.right.pane.tab.title', () =>
        scoped.slots.register(
          {
            name: 'sidebar.right.pane.tab.title',
            key: COMMIT_TAB_ID,
            locale: NS,
            inject: () => ({ t }),
          },
          CommitTabTitle,
        ),
      )

      console.log('[dsh-git-management] tabs registered (source control + file diff + commit diff)')
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
      openCommit: (params) => {
        try {
          scoped.sidebarRight.openTab(COMMIT_TAB_KIND, { params })
        } catch (error) {
          console.error('[dsh-git-management] could not open the commit tab:', error)
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
