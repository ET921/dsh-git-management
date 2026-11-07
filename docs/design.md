# 設計背景：為什麼是「系統 git ＋ 右側欄分頁」

這份文件保留專案開始時的技術判斷，給想改底層的人看；日常使用看根目錄的 README 就好。

## 跟 Cursor／VS Code 的對照

Cursor 是 VS Code 的分支，它的 Source Control 面板就是 VS Code 內建的 `vscode.git` 擴充：用系統 `git`、用 workbench 靜態註冊的 SCM 檢視，擴充只透過 API 餵資料。這個外掛照同一個模型落地：

| 問題 | VS Code／Cursor 的事實 | 這個外掛的對應 |
| --- | --- | --- |
| Git 怎麼實作 | 呼叫系統 `git`（`cp.spawn`），不是 libgit2 | `ctx.subprocess.spawn(['git', ...])`，argv 陣列、不經 shell |
| 用哪些指令 | `status -z -uall`、`diff`、`log`、`for-each-ref`、`rev-parse`… | 同一組，加上 `worktree list --porcelain`、`commitDiff` |
| 面板誰畫 | workbench 核心的 SCM 檢視；擴充只餵資料 | 右側欄分頁型別＋ slot；面板自己畫 |
| 擴充↔workbench 的 RPC | extension host RPC | `ctx.webServer.register('/dsh-git/api')` ＋同源 fetch |
| GitHub | GitHub 認證 session＋Octokit | 瀏覽器端 PAT＋REST |
| 工作區 | VS Code workspace | `ctx.workspaceRegistry.list()` |

## 三個關鍵決定

- **用系統 `git`，不內嵌**：行為跟終端完全一致（credential、hooks、`diff.external` 的處理都一致），也讓「面板說的和終端不一樣」這種 bug 不可能發生。代價是使用者必須自己裝 Git。
- **住在右側欄，用 tab 而不是蓋住對話**：清單與對話留在原位；檔案差異、提交差異各自是一個分頁，`sidebarRightTabs` 的 `multiple` 讓每次點提交都是獨立分頁。
- **每個動作都是「讀 git → 回 JSON → 重畫」**：Host 不保存狀態，`status` 是唯一真相；面板在可見時每 8 秒只重讀 `status`，所以終端裡的 commit、fetch 也會立刻反映。

## 差異的兩個尺度

- **檔案差異**：`git diff`（或 `--cached`），可切全文／僅變更、統一／並排；patch 解析集中在 `src/client/15-diff.js`。
- **提交差異**：`git show --numstat -z` 取檔案清單，再逐檔用 `:(literal)` pathspec 讀 patch；改名同時給舊、新路徑；merge 以第一父提交為基準。細節見 [commit-diff.md](commit-diff.md)。

## 更多

- 工作樹：見 [worktrees.md](worktrees.md)
- 提交差異：見 [commit-diff.md](commit-diff.md)
- 五份專家評審與交叉評審：見 [reviews/](reviews/)
