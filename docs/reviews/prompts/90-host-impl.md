# 實作 Agent A：host 端（Git 引擎 / actions / 路由守衛）

你是專業的 DeepSeek 軟體開發工程師，負責落地多專家評審彙整後的計畫。倉庫在目前工作目錄。**先讀 `docs/reviews/plan.md`（約定書）與 `docs/reviews/gitexpert.md`、`docs/reviews/engineer.md`**，再動手。

## 你的檔案（只能改這些）

- `src/git.js`
- `src/actions.js`
- `src/index.js`
- `scripts/verify.mjs`

**嚴禁**可到 `src/client/**`、`scripts/render-test.mjs`、`lib/**`、`README.md`。不可 commit、不可 push、不可 `npm install`。結束前跑 `node scripts/verify.mjs`，HOST 測試必須全綠（不需要 `npm run build`）。

## 任務清單（依 plan.md 第一節 #1–#2、#7–#9、#14–#15）

### T1 [最高優先] pathspec 一律 `:(literal)`
- `src/git.js` 內**所有**以檔案路徑 `/` 目錄路徑作為 pathspec 傳給 git 的位置：`stage`、`unstage`、`discard`、`removeUntracked`、`isTracked`、`diff`（含未追蹤的 `--no-index` 分支）、以及你 grep 到的其他位置（注意 `stagedPatch` 沒有路徑不用動；`worktree` 的 `-C` 與 worktree path 是目錄參數，**不是** pathspec，不要加前綴；`addWorktree` 的 name 已有驗證不動）。
- 包裝方式：`:(literal)` + 原路徑。加一個小 helper（如 `pathspec(p)`）統一處理，別在六處各自寫字串。
- 空字串/`Array` 防衛維持現狀；`requireFiles` 不動。
- `scripts/verify.mjs` 增加測試：fixture 建立同時存在 `bracket.txt` 與 `b[br]acket.txt` 的 repo——
  1. `stage(dir, ['b[br]acket.txt'])` 後 `git ls-files` 只含 `b[br]acket.txt`，不含 `bracket.txt`；
  2. `discard` 同樣只還原那一個；`removeUntracked` 對未追蹤的 `b[r]acket` 同理；
  3. `isTracked(dir, 'b[br]acket.txt')` 回 true。
  測試要涵蓋「誤配的另一檔存在」的前提，否則斷言不成立。

### T2 API 信任邊界（`src/index.js`）
- **先加測試再加實作**（或同時——但 verify 裡先有斷言）：
  1. 帶 `content-type: application/json` 的請求照常通過（現有 fetch-based verify 場景不能因此壞）；
  2. `content-type: text/plain` → 回 `415`，不執行任何 action；
  3. `path` 指向未註冊工作區（例如系統暫存目錄下的假 repo）→ 回 403（或 4xx），不執行；註冊 repo 本體與其 worktree 子路徑（`root/...`）都放行。
- 工作區白名單：在 handler 層用 `workspaces()` 的清單 + `normalizePath` 做相等或邊界前綴比對（`candidate === root || candidate.startsWith(root + '/')`，大小寫如 normalizePath 的既有規則）。`workspaces()` 不可用十年的 host 也別整個鎖死——拿不到清單時**放行**並保持現狀行為（保守降級，別給自己上鎖）。
- Content-Type 檢查只對「有 body 的請求」要求；若實作過程中發現某正值場景（例如 GET）無 body，不強制。
- **不要**動 `Origin` 檢查邏輯。

### T3 branch 分隔符
- `branches()` 與 `branchDetail()` 內 `for-each-ref --format` 的 `|` 改 `%00`（engineer 已實測可行），解析端同步改 `\0` split。verify 補一條：分支名含 `|`（在本地可行的話）或至少含空白/特殊字元的分支並不會解析錯位——若 Windows 建不出 `a|b` 分支，改成以 `a b`（合法）驗證不炸即可，並在註解標明。

### T4 bare repo probe
- `probe()` 拆開 rev-parse：`--is-inside-work-tree` 單獨跑（bare → exit 非 0）；bare/`.git` 內以 `--absolute-git-dir` 判定。`probe` 的回傳 shape 現有呼叫端依賴 `isRepo`，保持相容：bare 也回 `isRepo: true`（加 `bare: true` 欄位留給 client 未來用）。verify 補：`git init --bare` 的目錄 probe 出 isRepo true。

### T5 detached HEAD push 擋
- `push()`：branch 為 null/detached 時丟 GitError（訊息明確「detached HEAD 無法推送，請先切換或建立分支」），不得組出 `origin null` refspec。verify 補一條 detached 狀態下 push 拒絕的斷言。

### T6 merge commit 的 numstat
- `commitDetail()`：偵測 `%P` 多父（你已在 log 加 parents；commitDetail 的 format 也可加 %P，或用 `rev-list --parents -1` 判斷），多父時改加 `--diff-merges=first-parent` 取得對第一父的統計。verify 補：建真 merge commit，detail.files/additions 非零且 subject 正確。

### T7 GHES fallback
- `apiBase()` 改成接受 `host` 參數：env `GITHUB_API_URL` 優先；否則 host 不是 github.com 時回 `https://<host>/api/v3`。github 呼叫鏈把 `remote.host` 傳進去。僅在 actions.js 呼叫處傳 host，不需新測試也可加一條 GHES path 的單元式測試（fetch stub 檢查 URL 開頭）。

### T8 `abortMerge`
- `src/git.js` 加 `abortMerge(cwd)`：`git merge --abort`（若目前不在 merge 中，git 會報錯——原樣丟 GitError）；`actions.js` 註冊動作名 `abortMerge`，回 `{ summary }`。verify 補：無衝突時呼叫得到適當錯誤（不炸 process、有訊息）。

## 收尾

1. `node scripts/verify.mjs` 全綠；新增斷言總數## 預期 >/= 10 條。
2. `git status` 檢查：只有你那四個檔案有變更。
3. 回報：每個任務一行的完成說明＋新增測試數＋verify 結果行數。
4. 你**不提交**。惡劣情況（無法達成某 T）就明說哪條卡住、為什麼，不要硬改不相干的東西。

## 風格

- 沿用現有風格：無 bundler ESM、英文註解、每個函式保留 JSDoc、錯誤訊息附中文對照（現有 GitError 慣例）。
- 改動最小化：審美不改、命名不重建，只修計畫內的行為。
