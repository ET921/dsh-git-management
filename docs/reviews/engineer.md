# DSH Git 管理外掛 — 工程評審（程式碼品質與穩健性）

> 範圍：`src/`、`scripts/build.mjs`。唯讀評審：未執行 `npm test`、未改動任何原始碼。
> 方法：逐檔閱讀；對可疑的 git 行為只做唯讀實驗（`git check-ref-format`、`for-each-ref --format` 分隔符），其餘以程式碼路徑推論，不確定處標「需要驗證」。

## 摘要

架構本身是乾淨的：命令只在 `actions.js` 組裝、git 引擎可注入 exec、宿主有同源檢查與輸出上限、測試覆蓋主要 happy path（含路徑空白）。真正的風險集中在三處：**HTTP 信任邊界**、**client store 的錯誤／併發生命週期**、**解析器的邊界字元**。以下 9 個發現依嚴重度排序，最後附測試盲區與「不建議做」。

---

## 發現

### 1. [P0/P1] `Origin: null` 被當同源，且不檢查 Content-Type → 外部頁面可驅動本機 git
- 位置：`src/index.js:95-105`（`isCrossOrigin` 對 `origin === 'null'` 直接放行）、`src/index.js:232-249`（handler 與 `readJson` 都不看 `content-type`）。
- 問題：瀏覽器對跨站「簡單請求」不送 preflight。沙箱 iframe 或 `data:` 頁面可用 `Content-Type: text/plain` POST 一段 JSON 到 loopback 的 `/dsh-git/api`；其 `Origin` 是 `null`，被視為同源；伺服器照樣 `JSON.parse` 並執行 `discard`／`deleteUntracked`（`git clean -f`）。等於任意網頁可刪改使用者 repo 的未提交內容。
- 建議：最低成本且不依賴 Origin 的補法——handler 要求 `content-type` 以 `application/json` 開頭，否則回 415。這會強制 preflight，而本路由不回 CORS，瀏覽器端即被擋。更徹底是每次啟動發 per-boot token 注入頁面。**不要**在確認 Desktop app protocol 的實際 Origin 前直接封鎖 `null`（可能把 Desktop 鎖死）。
- 註：Chrome 的 Private Network Access 可能已部分緩解；不同宿主瀏覽器與 DSH web（LAN）情境需要驗證。若宿主不強制 PNA，此項即為 P0。

### 2. [P1] `path` 只驗「存在且是目錄」，未限制在已註冊工作區內
- 位置：`src/index.js:112-125`（`requireDirectory`）、`src/index.js:245`。
- 問題：任何同源請求都能把 `path` 指向磁碟上任何 git repo，執行 `discard`、`deleteUntracked`、`commit`、`init`。第 1 點讓同源這道門可被繞過，兩者疊加才是完整風險。
- 建議：在路由層或 `actions.handle` 用 `workspaceRegistry.list()` 的 path 做 `normalizePath` 前綴比對；或要求 `git rev-parse --show-toplevel` 等於某個已註冊 repo root。

### 3. [P1] `task()` 讓 8 秒輪詢清掉錯誤訊息；`busy` 是可被覆蓋的單一標籤
- 位置：`src/client/10-store.js:94-104`（開頭 `set({error:null})`、`finally` 無條件 `busy:null`）、`src/client/40-panel.js:44-57`（8 秒輪詢）。
- 影響：commit／push 失敗的紅字最多活 8 秒就被背景 refresh 清掉；兩個 task 重疊時（輪詢 refresh 與 GitHub 自動載入）先結束者把 `busy` 設回 null，按鈕在另一個操作還在跑時就解鎖、spinner 消失。`refresh` 的 catch 也沒看 `epoch`，切換 repo 後舊 repo 的錯誤會顯示在新 repo。
- 建議：`busy` 改成計數或 token（只清自己那筆）；`error` 加 `errorSeq`/epoch，背景輪詢不清 error；`refresh` 只在 `mine === epoch` 時寫入錯誤。

### 4. [P1] `loadRepos()` 不在 `task()` 內，失敗會變未處理 rejection 並永久卡在「正在讀取…」
- 位置：`src/client/10-store.js:107-118`；呼叫點 `src/client/40-panel.js:39,106,118` 均無 `.catch`。
- 影響：宿主路由不存在／舊版宿主／網路錯誤時，`ready` 永遠 false，面板停在 loading，沒有可操作的錯誤訊息（worktree 有 `worktreeStale` 提示，repos 反而沒有）。
- 建議：包進 `task('repos', ...)`，失敗時 `set({ready:true, error})`，並沿用 stale-host 的判斷。

### 5. [P1] GitHub 載入失敗會卡在「正在檢查 GitHub 遠端…」，且無法就地換 token
- 位置：`src/client/10-store.js:361-377`（失敗時 `github` 維持 null）、`src/client/40-panel.js:1039-1055`（effect 依賴不變，不會重試）、`src/client/40-panel.js:1113-1138`（token 表單只在 `github.authorized === false` 時渲染）。
- 影響：貼上過期／錯誤的 PAT → `github()` 丟 401 → `task` 顯示紅字但 `github` 仍是 null → 卡片永遠顯示 loading，畫面上沒有輸入框；只能切走分頁再回來（元件重掛載）才會重試。
- 建議：失敗時寫入 `{connected:true, authorized:false, reason:'error', error:message}`，並在 `reason !== 'no-token'` 時也顯示 token 表單與「重試」。

### 6. [P1] GitHub REST 呼叫沒有逾時／AbortSignal
- 位置：`src/actions.js:45-56`（`fetch` 未傳 `signal`）。
- 影響：DNS／連線黑洞時，請求與 store 的 `busy` 一直掛著（宿主路由也一直 await），使用者看到永久 spinner，只能重啟。
- 建議：`fetch(..., { signal: AbortSignal.timeout(15000) })`，把 abort 轉成可讀錯誤。

### 7. [P1] `parsePatch` 把 hunk 內的 `--- xxx` / `+++ xxx` 內容行誤判為檔頭，行號與 +/- 統計全歪
- 位置：`src/client/15-diff.js:105`（`--- `/`+++ ` 判斷沒有「只在第一個 hunk 之前」的限制）。
- 影響：刪除一行內容為 `-- foo` 時，patch 行是 `--- foo`，被當 META 丟掉：不計入 `oldNo`，之後同 hunk 的刪除與 context 行全部錯位，`+/-` 也少算；新增 `++ foo` 同理。YAML／Markdown／SQL 註解都可能踩到。
- 建議：加 `seenHunk` 狀態，進入 hunk 後一律以首字元判 `+`/`-`/` `/`\`。順帶：衝突檔的 `diff --cc` 是雙欄 prefix（`@@@`），目前完全沒處理，點衝突檔會畫錯；至少要在 `diff()` 或 UI 明確標示「衝突差異不支援」。

### 8. [P2] 分支資料用 `|` 當分隔符，但 git 允許分支名含 `|`
- 位置：`src/git.js:436-453`（`branches`）、`src/git.js:672-690`（`branchDetail`）；`src/git.js:430-431,676-677` 的註解「git 禁止 `|`」是錯的。
- 事實：本機實測 `git check-ref-format --branch 'a|b'` 回 0；Linux/macOS 可建立此 branch（Windows 因 NTFS 檔名限制才建不出來）。一旦 repo 有這種分支，`split('|')` 欄位錯位，`current`／`upstream`／`sha` 全錯。
- 建議：改用 tab（ref 名禁止控制字元）或 `for-each-ref --format='%(refname:short)%00...'`（本機 git 2.53 實測 `%00` 會輸出 NUL）；`branchDetail` 用同一規則。

### 9. [P2] 任何 origin host 都被當成 GitHub
- 位置：`src/git.js:504-513`（`remote()` 只找 origin，不看 host）、`src/actions.js:343-349`。
- 影響：origin 指向 GitLab／Bitbucket／自架時，面板仍會打 `api.github.com/repos/<owner>/<repo>`，使用者看到 404 紅字而不是「不是 GitHub 遠端」。
- 建議：`githubAction` 在 host 不是 `github.com`（或 `GITHUB_API_URL` 對應的 GHES host）時回 `{connected:true, reason:'not-github'}`，UI 顯示對應文案。

---

## 其他次要（P2）

- `dirtyCount`（`src/git.js:578-585`）用 porcelain v1 `-z` 數 record；rename 會產生 old/new 兩筆，badge 把一個改名算成 2。改用 `--no-renames` 或 v2 只數 entry。
- `actions.repos()`（`src/actions.js:145-162`）對每個 workspace 跑一次完整 `git.status`（含 `--untracked-files=all` 與兩次 numstat），只為了拿 branch；改用 `git branch --show-current`。
- `46-hover.js:16-39` 的 `gmgDetailCache` 永不過期：branch hover 在後續 commit 後仍顯示舊的 last commit／upstream，且 session 內無上限成長。加 TTL 或在 `selectRepo`／`refresh` 清 branch 類 key。
- `selectRepo`（`src/client/10-store.js:124-142`）沒重設 diff store（`15-diff.js:19-36`）：切 repo 後若 diff 分頁還開著，會保留舊 repo 的檔案，`上一個/下一個` 會用舊 `target.path` 搭配新 repo 的清單。
- Fetch 按鈕在 `upstream === null` 時被 disabled（`src/client/40-panel.js:727`），但 fetch 本來不需要 upstream，沒有追蹤分支時反而無法 fetch。
- `fetch`／`pull`／首次 `push` 硬編 `origin`（`src/git.js:470-490`），主遠端不叫 origin 時功能等於失效。

---

## 測試盲區（`scripts/verify.mjs` / `render-test.mjs`）

- 已測：路徑空白、untracked diff、二進位誤判、worktree traversal、worktree 移除保護、GitHub email 身分快取、hover／branch menu／split diff 渲染。
- 沒測：rename（status v2 kind 2、dirtyCount 雙計）、含 `|` 的分支名、conflict 的 combined diff、`parsePatch` 遇到 `--- `/`+++ ` 內容、GitHub 401/403/timeout、`Origin: null` 與 `text/plain` 請求、store 的 busy/error/epoch 競態、detached HEAD 的 push、超過 6 MB 輸出上限時 `maxBytes` 是截斷還是讓 spawn 失敗（需要驗證）。

---

## 最值得做的三件事

1. **收緊 `/dsh-git/api` 的信任邊界**（發現 1、2）：Content-Type 白名單 + 工作區路徑白名單。這是唯一可能導致「使用者資料被外部網頁刪改」的等級。
2. **重做 store 的錯誤與併發生命週期**（發現 3、4、5、6）：busy token、error 不被背景輪詢清掉、epoch 守衛、GitHub 失敗可重試且可換 token、所有外部請求有逾時。這是「面板看起來壞掉、只能重開」的主要來源。
3. **修解析器的邊界字元**（發現 7、8）：hunk 狀態機與 ref 分隔符。兩者都是小改動、低風險，卻能消掉一整類「行號錯、分支顯示錯」的幽靈 bug。

## 明確不建議做（含理由）

- **不要引入 bundler、npm 依賴、libgit2 或內嵌 git**：違反硬限制；現有「argv 陣列 + 可注入 exec」是最大的安全與可測試性資產。
- **不要為 CSRF 直接全面封鎖 `Origin: null`**（在確認 Desktop app protocol 的 Origin 之前）：可能讓 Desktop 整個不能用；先加 Content-Type 檢查或 per-boot token。
- **不要為 `|` 分支名重寫整個分支 UI 或改成 JSON 序列化管線**：換分隔符（tab／`%00`）即可，兩行改動。
- **不要加入 `fs.watch`／WebSocket 推送**：README 已列為下一步；跨平台、跨宿主成本高，先修好錯誤生命週期。
- **不要重做已完成的功能**：hover 詳情卡、lane 軌道、並排紅綠底、未追蹤檔 diff、二進位判定、主題化分支選單——不在本次範圍。
- **不要在前端組 git 命令或改用 shell 字串**：`actions.js` 是唯一命令組裝處，這個邊界要守住。
- **不要用「提高輪詢頻率」解決同步延遲**：大型 repo 的 `status --untracked-files=all` + `log --all` 才是成本；必要時降低 `log` limit 或分開輪詢。

---

## 交叉評審回應

> 讀完其他四份後的取捨。第一輪正文不動（除下方明列的優先級修正），本區段 supersede 前面的排序。

### 1. 同意並借用（會併入我的推薦）

- **gitexpert 的 pathspec 萬用字元污染（P0）**：這在我清單裡完全漏了，而且是唯一「不需要攻擊者、只要檔名有 `[`」就會靜默改錯檔的錯誤。我第 2 點只談「path 指向哪個 repo」，沒談「path 在該 repo 內匹配到哪些檔」——兩者正交，我漏了後者。`:(literal)` 全域包裝升為第 1 名。
- **gitexpert 的 `--cc` combined diff**：補足我第 7 點只有一句「衝突差異不支援」的空白——`diff --cc` 首字 `d` 走 context 分支、`@@@` 不重置行號，是可重現的錯字＋錯行，不只是「未支援」。併入第 7 點並升級為必修（一行偵測退到 note 即可）。
- **gitexpert 的 bare repo probe**：`--show-toplevel` 讓整個面板對 bare repo 回 isRepo:false，這是事實錯誤不是取捨，我漏了。
- **gitexpert 的 detached HEAD push**（`--set-upstream origin null`）：屬於我第 3 類「命令組裝缺狀態前置檢查」的具體實例，比我原本的抽象描述更可修。
- **gitexpert 的衝突中可直接 commit**：我完全沒想到。這與 pathspec 同級——面板擋不住「帶著衝突標記建 merge commit」。
- **poweruser F2（notice 隨捲軸捲出視線）**：我評的是狀態機，他抓到的是「錯誤根本不在視野內」，比我第 3 點更直接命中「按了沒反應」的體感，且修法只是一個 sticky。
- **poweruser F3 的檔案列 `+`/`↩` 無 disabled**：獨立佐證我第 3 點的 busy 覆蓋；他的「檔案動作只重讀 status」也是我第一輪漏掉的成本修法，接受。
- **design 的 `:focus-visible`**：便宜且與我的清單不衝突，照收，但優先級見下。

### 2. 不同意

- **gitexpert 對 `|` 分支名的修法「欄數 >5 就丟錯」**：事實我完全同意（與我第 8 點同結論），但丟錯會讓整個分支清單失效，比現況更糟。換分隔符（`%00`／tab）只影響解析、失敗面為零，才是正解。
- **design 把 `:focus-visible` 列 P0**：以我的尺度 P0 是資料錯／刪錯檔。焦點不可見是必修，但應排在 pathspec、CSRF、`--cc` 之後。另外 design 檔內自相矛盾：P2 建議 lane 色「全改用 token」，末尾「不建議動」又寫「不要換成全 token」——二選一即可，別留雙向指示。
- **product G4「撤銷上次提交」標為 P1／小**：低估了。要判斷「未推送」得靠 `@{u}..HEAD`，沒有 upstream 的分支此判斷無效；merge commit 的 `reset --soft HEAD~1` 語意又不同。不是一顆按鈕，是一個狀態機。
- **product 的 stash／undo／pull --rebase 一次全上**：功能方向都對，但每個都是新的命令組裝與失敗路徑（stash pop 衝突、rebase 中斷、abort 半途）。工程上應排在 store 生命週期與狀態前置檢查之後，否則只是讓使用者撞上更多「只有一行錯誤、沒有下一步」。

### 3. 修正自己

- **升級（五項新發現／重新排序）**：pathspec（新第 1）、`--cc`、bare repo、detached push、衝突中 commit。第一輪把「信任邊界」排第 1 是因為風險上限最高；但 pathspec 的觸發不需要敵人，且 `:` 前綴在 diff／clean／worktree 全受影響，故改排第 1。
- **降級**：第 9 點（非 GitHub origin）維持 P2；`dirtyCount` 與 `actions.repos()` 維持次要，gitexpert 對 `dirtyCount` 的獨立確認不改變其優先級。
- **維持原有判斷**：仍不建議在確認 Desktop Origin 前封鎖 `Origin: null`，Content-Type 檢查依然是成本最低的第一步。
- **補測試盲區**：`[`／`?`／`*` 檔名、`diff --cc`、bare repo、detached push、衝突中 commit、notice 在捲動後是否仍可見。

### 4. 最終 Top 3（工程視角）

1. **pathspec `:(literal)` 全域掃描**：唯一「按一下暫存就改到另一個檔」的靜默資料錯誤，且不需攻擊者；改動是純字串包裝，投報率最高。
2. **`/dsh-git/api` 信任邊界**（Content-Type 白名單＋工作區路徑白名單）：外部頁面能刪改本機 repo 是風險上限最高的一項，即使觸發條件比 pathspec 苛刻。
3. **錯誤與狀態的守門**（busy token／epoch、錯誤不被輪詢清掉、`--cc` 降級、bare／detached／衝突中擋寫）：一次收掉「面板看起來壞掉只能重開」與「命令根本不該送出」兩個來源。
