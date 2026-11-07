# 實作 Agent B：client 端（面板 / diff / store / CSS）

你是專業的 DeepSeek 軟體開發工程師＋Claude Design 團隊的 UI 實作。倉庫在目前工作目錄。**先讀 `docs/reviews/plan.md`（約定書）與 `docs/reviews/poweruser.md`、`docs/reviews/design.md`、`docs/reviews/engineer.md`**，再動手。

## 你的檔案（只能改這些）

- `src/client/**`（10-store、15-diff、30-style、40-panel、45-diff-panel、50-plugin…；16-graph/46-hover 若任務需要可小改）
- `scripts/render-test.mjs`

**嚴禁**可到 `src/git.js`、`src/actions.js`、`src/index.js`、`scripts/verify.mjs`、`lib/**`、`README.md`。不可 commit、不可 push、不可 `npm install`。結束前跑 `node scripts/build.mjs && node scripts/render-test.mjs`，RENDER 測試必須全綠（**只跑一次收尾**，中途別反覆 build，host 的 lib 由監督者最後統一重建）。

## 瀏覽器端硬限制（不可違反）

- 無 ESM import/export、無 npm 依賴（僅 `require('react')`/`require('react-dom')`）。
- CSS 只用 `--dsw-alias-*` token＋面板級 `--gmg-mono`；`lib/client.js` 是按檔名排序串接的（16 在 15 後、40 前），新檔如需落在正確位置就命名好序號。

## 任務清單（依 plan.md 第一節 #3–#6、#10–#13、#16）

### T1 busy token ＋ error 生命週期（`10-store.js`）
- `task()` 改為 token 制：每次呼叫取遞增 token，`finally` 只有 token 是「最新」時才寫 `busy: null`；之前的 spinner 不消失、錯誤不被後到的 background task 洗掉。
- `error` 加 epoch/seq 保護：8 秒輪詢的 `refresh` **不清**既有 error（成功也不清、錯誤蓋錯誤）；`selectRepo` 開新 repo 時才清。
- `loadRepos()` 包進 task：失敗時 `set({ ready: true, error, loadFailed: true })`——照 engineer #4 的路線，不再永久卡「正在讀取…」；`loadGithub` 失敗同樣落一個可見的錯誤列（含「重新檢查」的重試按鈕），卡不再停在 loading 文案。
- `refresh` 的 catch 加 epoch 守衛（切換 repo 後舊 repo 的錯誤不得顯示在新 repo）。

### T2 檔案動作只重讀 status（`10-store.js`＋`40-panel.js`）
- 加 `refreshStatus()`：只呼 status、只寫 status（不碰 log/branches）。
- `fileAction`（stage/unstage/discard/delete）與 `stageAll/unstageAll` 改用 `refreshStatus()`；8 秒輪詢同樣只刷 status，`log`/`branches` 只在 selectRepo/手動刷新（`refreshAll`）/分頁動作（commit/switch/remote）後重讀。

### T3 sticky notice（`30-style.js`）
- `.gmg-notice.is-error`（與帶互動按鈕的 notice）`position: sticky; top: 8px; z-index: 5;`——開發者工具密度不變、錯誤不再隨捲動消失。
- 檢查 `.gmg-page`/`.gmg-root` 的滾動容器關係（sticky 相對最近 scroll 祖先），render-test 加一條 CSS 斷言（樣式字串含該規則）。

### T4 `parsePatch` hunk 內容行（`15-diff.js`）
- 進入第一個 hunk 後，`--- `/`+++ ` 開頭的行是內容（本文以 `-`/`-- ` 開頭）不是檔頭 meta——加 `seenHunk` 狀態機守卫，meta 判定只發生在 hunk 之前。
- 衝突降級：`openDiff` 拿到 patch 後檢測 `/^diff --(cc|combined) /m`，命中即 `note: 'unmerged'`，並新增字典 `diffUnmerged`（zh：`該檔案有未合併的衝突，先解決後再標記。`；en 對應）。
- render-test：fixture patch 含本文行 `--- foo`／`+++ bar`（hunk 內），斷言行號/種類正確；另含 `diff --cc` 情境斷言 note 命中。

### T5 差異頁 action bar（`45-diff-panel.js`）
- header 增加兩顆按鈕（僅對單檔 diff，未追蹤檔也算）：
  - **暫存**（僅 staged=false 顯示）：`gitStore.fileAction('stage', [target.file], null)` 後重新 openDiff（同一 target，待 status 刷新後自然切換）；
  - **放棄更改**：未追蹤→delete、追蹤→discard，走 `40-panel.js` 現有的 confirm 文案；確認後重讀並關閉 diff（檔案已不存在）。
- 按鈕吃 `busy`（busy token 化後 A 端不變）與 `disabled` 樣式沿用 `.gmg-btn`。
- render-test：按下暫存能送出 `stage` action call，含 confirm 拒絕不送 `discard`。

### T6 衝突收尾 UI（`40-panel.js`＋`50-plugin.js`）
- 衝突列（`ChangeGroup` 的 conflicts 群組）加「標記為已解決」行內動作＝對該檔 `fileAction('stage', …)`；hover 樣式與既有 `.gmg-actions` 一致。
- 衝突存在時**擋提交**：`CommitBox` 在 `snapshot.conflicts.length > 0` 時 disable 提交（與 textarea 同一列），提示文案新字典 `conflictBlockHint`（zh：`有未解決的衝突——解決後逐檔標記。`；en 對應）。html/css 不用彈窗。
- 衝突卡（衝突行數 > 0 時顯示一張小卡或列首狀態列）提供「中止合併」按鈕：呼 `gitStore.abortMerge()` → 呼 host 動作 `abortMerge`（此動作由 A 端註冊；你喘上後呼叫即可，名字就是 `abortMerge`，回 `{ summary }`）。確認对话沿用 worktreeRemoveConfirm 的 confirm() 模式，文案 `mergeAbortConfirm`。
- render-test：fixture STATUS 含一個 conflict row → 斷言衝突列有動作、提交按鈕 disabled、中止按鈕存在。

### T7 `:focus-visible` 全套（`30-style.js`）
- `.gmg-icon-btn`、`.gmg-file`、`.gmg-branchitem`、`.gmg-btn`（僅 focus-visible，保留 `.gmg-branch` 現有規則）補 `outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px;`（誤觸面最小的統一值）。`touch`/滑鼠不顯示 ring。

### T8 amend 預覽＋stageAll 重設（`40-panel.js`）
- `amend` 勾選時自動把 textarea 值填入 `state.log[0].subject`（若 textarea 為空才填；使用者在改字不覆蓋）。暫存 checkbox（`stageAll`）提交成功後重設為不勾選（找 CommitBox 的 state 重設邏輯）。

### T9 selectRepo 重設 diff（`10-store.js`）
- `selectRepo` 除現有欄位外加 `setDiffState({ target: null, rows: [], pairs: [] })`（poweruser F1 的 ↑↓ 邊界）。

## 收尾

1. `node scripts/build.mjs && node scripts/render-test.mjs` 全綠；新增斷言預期 >/= 8 條。
2. Dictionary 統一 zh＋en、繁簡體照現有 zh 詞表簡體慣例（現有 zh 詞表是**簡體**——注意！沿用既有 zh 詞表的字體；en 新增）。
3. `git status` 檢查：只有你那批檔案有變更。
4. 回報：每個任務一行的完成說明＋新增測試數＋render結果。
5. 你**不提交**。卡住就明說，不要硬改。

## 風格

- 沿用現有風格：`h()`、JSDoc、`gmg-*` CSS 命名、english console.log 慣例，純度與 40-panel 現有結構一致，不要重排現有代碼。
- 改動最小化：版面門診不做，只修計畫內行為與樣式。
