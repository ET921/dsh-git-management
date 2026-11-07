# dsh-git-management — 側邊欄 Git 原始碼管理

在 DeepSeek Harness 的**右側邊欄**加一個 **Source Control**（原始碼管理）分頁：暫存、提交、分支、同步、歷史，以及 GitHub 的 PR／Issue 互動。位置就在「工作區文件」「新建終端」那兩張卡片的下面，目標是「Cursor 的 Source Control 那個樣子」。

> 入口：右側邊欄 →「開始」頁 → 第三張卡片「源代码管理」。點下去會在該欄開一個 Git 分頁，分頁晶片會顯示目前有幾個檔案待處理。
> 注意：右側邊欄是 session 範圍的，所以要先開著一個 session（有工作區）才會看到。

---

## 一、可行性結論：可以，而且路徑和 Cursor 幾乎一樣

**Cursor 就是 VS Code 的分支。** 官方〈VS Code Migration〉寫得很直接：「Cursor is based upon the VS Code codebase… We regularly rebase Cursor onto the latest VS Code version」（<https://cursor.com/docs/configuration/migrations/vscode>）。所以 Cursor 的 Source Control 面板 == VS Code 內建的 `vscode.git` 擴充功能。

它實際的運作方式（都可以在原始碼裡查到）：

| 問題 | 事實 | 出處 |
| --- | --- | --- |
| Git 怎麼實作？ | **呼叫系統的 `git` 執行檔**，不是 libgit2、也不是內嵌 Git。`cp.spawn(this.path, args)` | <https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts> |
| 用哪些指令？ | `git status -z -uall`、`git diff`、`git diff --cached`、`git log --oneline`、`git for-each-ref`、`git rev-parse --show-toplevel`、`git stash`… | 同上 |
| 面板是擴充功能做的嗎？ | **不是**。SCM 檢視是 workbench 核心靜態註冊的（`workbench.view.scm`、`workbench.scm`、`workbench.scm.repositories`），擴充功能只透過 `vscode.scm` API 餵資料 | <https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scm.contribution.ts> |
| GitHub 互動怎麼做？ | `github-authentication` 擴充提供 session，`vscode-pull-request-github` 用 Octokit 呼叫 REST/GraphQL | <https://github.com/microsoft/vscode-pull-request-github> |
| 有沒有限制？ | 超大 repo 的 status 在 10000 筆會截斷；packed refs 會讓 ahead/behind 暫時過期；子模組只做基本處理；沒有內建 LFS | `git.ts` / `repository.ts` |

**DSH 有對應的每一塊**，所以這個外掛不是硬闖，而是照同一個模型落地：

| VS Code / Cursor | DSH 對應 |
| --- | --- |
| SCM 檢視容器（靜態） | 右側欄的分頁系統：`ctx.sidebarRightTabs.register(...)` 宣告型別＋開始頁卡片，`sidebar.right.pane.tab`／`sidebar.right.pane.tab.title` 兩個 slot 提供內容與晶片 |
| `vscode.git` 擴充（spawn git） | Host 外掛 + `ctx.subprocess.spawn(['git', ...])` |
| 擴充功能 ↔ workbench 的 RPC | `ctx.webServer.register({ kind: 'exact', path: '/dsh-git/api' })` + 同源 fetch |
| GitHub 認證 session | 瀏覽器端 Personal Access Token（可選） |
| 工作區／資料夾 | `ctx.workspaceRegistry.list()` |

---

## 二、它做得到什麼

面板在**右側邊欄**，跟「工作區文件」「新建終端」是同一組卡片（右側邊欄的開始頁），點卡片就開一個 Git 分頁。

- **右側邊欄卡片與分頁**：`sidebarRightTabs` 註冊一個 `git` 型別 → 開始頁多一張卡片；分頁晶片顯示分支圖示、標題與待處理檔案數。
- **分支列**：目前分支（點擊可切換）、上游、`↑ahead ↓behind`、Fetch／Pull（`--ff-only`）／Push（首次自動 `-u origin`）、新建分支。detached HEAD 下推送會直接說明原因，不會組出 `origin null`。
- **提交框**：訊息、`Ctrl+Enter` 提交、全部暫存、amend（勾選時把上次提交的訊息帶進輸入框預覽）、已暫存/未暫存計數。**有未解決的衝突時提交鍵停用**，並在下方式說明。
- **變更清單**：已暫存 / 更改 / 衝突三組，每組標頭左側有**收合箭頭**（收起來後仍看得到該組檔數），逐檔 `+12 -3`，hover 出現暫存、取消暫存、放棄、刪除未追蹤檔（有確認）。衝突檔多一顆「標記為已解決」。
- **點檔案 → 在側邊欄新開一個「檔案差異」分頁**：變更清單與對話都留在原位，diff 自己是一個分頁（晶片顯示檔名）：雙欄行號、統一／並排切換、上一個／下一個檔案、已暫存⇄工作區切換、`Esc`／返回關閉分頁。分頁標頭直接有「暫存」與「放棄／刪除」，review 完不必回到清單；衝突檔會顯示「有未解決的衝突」而不是畫錯行號。
- **hover 詳情卡**：滑鼠停在提交上顯示 sha、作者、相對時間、訊息、`N 個檔案 +X −Y` 與「在 GitHub 開啟」；停在分支上顯示上游、領先/落後與最後一次提交。作者一律先找 GitHub 帳號，**不必等推送**：已推送的提交由 GitHub 直接回答；還在本機的提交則用它的作者信箱換帳號（自己的信箱＝你授權的帳號，別人的信箱＝GitHub commit 搜尋），兩者都查不到才回退 git 名稱。卡片一律開在欄的**左側**、右緣距欄 12px，寧可蓋住對話也不壓住你正在指的那一行；高度跟著內容不設上限（長內文不截斷），只有高過視窗時才在最上緣固定並捲動。停留約 280ms 才出現，且不可點，不影響原本的點擊行為。
- **歷史＋分支軌道**：左邊是提交列（主旨＋ref 徽章，不再顯示 sha——sha 在 hover 卡裡），右邊是 SVG 畫的分支軌道（lane）：每條未合併的線一欄，merge 畫成彎出去的邊，有 ref 的提交是實心點。資料來自 `git log --all --topo-order`（含 `%P` 父提交與 `%D` ref），所以**所有分支的活動**都在同一張圖上，不只是當前分支（含 fetch 下來、只存在 `origin/*` 上的提交）。預設顯示 10 筆，可展開到 40 筆。見 [src/client/16-graph.js](src/client/16-graph.js)。
- **點一列提交 → 側邊欄新開一個「提交差異」分頁**：跟 Cursor 的歷史一樣，列本身就是入口。每個檔案是一個區塊、**竪著排列**，標頭是路徑、狀態與 `+N −N`（改名顯示 `← 舊路徑`），標頭在捲動時**吸頂**，所以滑到哪裡都知道自己在看哪個檔；點標頭可單獨收合，另有一鍵的「展開全部／收合全部」。內容**只畫變更的 hunk**（前後三行上下文），不載入全文——這正是「僅變更」的意思。merge 依**第一父提交**畫，和二進位檔的統計口徑一致；二進位檔只標一個「二進位」而不是畫錯行號。每次點擊都是**獨立分頁**（`multiple: true`），兩個提交可以並排看，清單與對話都不會被換掉。單一提交最多讀 60 個檔案的 patch，超過時列表仍會說明總數；資料按 `repo#sha` 快取，重開同一個提交不會再問 git。
- **本機 vs 遠端，用顏色分**：ref 徽章依「在哪台機器」上色，並各配一個圖示（色盲也分得出來）——你目前的檢出是**實心藍底＋實心點**、其他本機分支是**淡藍底＋分支圖示**、遠端分支（`origin/*`）是**飽和紫＋雲**、標籤是**琥珀＋標籤圖示**。分支列的 upstream 也依關係上色：同步✓綠、領先↑藍、落後↓琥珀、分叉↑↓紅。色票（`--gmg-*`）是面板自帶的飽和色，因為主題 accent 對 10px 徽章太淡；淺色主題另有一組較深的同色相，兩邊對比都 ≥4.8:1，車道線則用固定的高飽和八色。
- **GitHub**：遠端解析（ssh/https 皆可）、星標/復刻/issue 數、在瀏覽器開啟、PR 清單、Issue 清單、從目前分支建立 PR。GHES（非 github.com 的 origin）會自動走 `<host>/api/v3`，也可用 `GITHUB_API_URL` 覆蓋。
- **工作樹**：列出這份 repo 的所有 checkout（含 DSH 自己的 `.agents/worktrees/*` 與你手動加的），每列顯示分支、相對路徑、髒污計數與 `主` 標記；可以一鍵把面板切過去、開成 DSH 工作區、或在確認後移除。見 [docs/worktrees.md](docs/worktrees.md)。
- **多工作區**：下拉切換 DSH 工作區（自動記住上次選擇；非 Git 目錄提供「初始化倉庫」）。
- **回饋與狀態**：錯誤與成功提示 sticky 在頂端，捲動也看得見；背景輪詢只在沒有其他操作時跑，而且只重讀 `status`，不會清掉你剛看到的錯誤；每個操作有自己的 token，重疊時 spinner 不會提早消失；讀不到工作區列表時給的是「重新讀取」而不是假裝沒有倉庫。

## 三、故意沒做的事（以及原因）

- **不內嵌 Git**、不引入 libgit2：跟 VS Code 一樣用系統 `git`。好處是行為與終端機完全一致，壞處是使用者必須自己裝 Git（本機已裝 2.53）。
- **不做檔案監看**：面板可見時每 8 秒輪詢一次 `status`，加上視窗 focus 時刷新。VS Code 用檔案事件 + `.git` watcher，那需要 Host 端的 fs.watch 橋接，屬於下一步。
- **不做衝突解決器**：只標示衝突檔。
- **Token 只存在這個瀏覽器**（localStorage），推送本身走你本機 git 的憑證（SSH / credential manager），與 token 無關。

---

## 四、安裝

外掛已以「本地開發版」安裝到 DSH Desktop 的 `web` profile：

```
C:\Users\user\AppData\Roaming\dsh-desktop\harness\profiles\web\
  cordis.patch.yml                     # 末尾插入一列 git-management
  node_modules\dsh-git-management      # junction → 這個資料夾
```

安裝步驟（可重做）：

1. `node scripts/build.mjs`（把 `src/` 產出 `lib/index.js`、`lib/actions.js`、`lib/git.js`、`lib/client.js`）。
2. 在 profile 的 `cordis.patch.yml` 追加：

   ```yaml
   - insert:
       - id: git-management
         name: dsh-git-management
   ```

3. 在 profile 的 `node_modules` 建立連結：`mklink /J node_modules\dsh-git-management <這個資料夾>`。
4. **重新載入 GUI**（主視窗 `Ctrl+R`；若宿主沒熱載入新的 row，就重啟 DSH Desktop）。

解除安裝：刪掉 `cordis.patch.yml` 裡那三行（備份在 `cordis.patch.yml.bak-git-management`）與 `node_modules\dsh-git-management` 連結。

---

## 五、驗證

```bash
npm run build        # 產出 lib/
npm run verify       # 135 項：Git 引擎 + 動作表 + 邊界狀態（bare／detached／merge／衝突）+ 提交差異 + HTTP 路由守衛 + 打包檢查
npm run test:render  # 159 項：jsdom + 真的 React，掛起 lib/client.js 渲染面板、檔案 diff 與提交 diff 分頁
```

- `scripts/verify.mjs`：對真的 `git` 二進位驗證 status/stage/commit/diff/log/branches/remote 與錯誤處理，含路徑有空白、含 `[` 的檔名，以及 bare repo、detached HEAD、merge 統計、`merge --abort`；提交差異另有自己的 repo，驗 root commit、單行修改只帶 hunk、改名（舊路徑）、刪除、二進位、merge 的第一父提交與空提交；另有一段直接驅動 `/dsh-git/api` 的 handler，驗證 Content-Type 與工作區白名單。
- `scripts/render-test.mjs`：載入真正的 `lib/client.js`、呼叫 `apply(ctx)`、檢查兩個 slot 註冊、渲染面板、點一個檔案確認 diff 被請求並上色；點一列提交確認開的是 `git-commit` 分頁、參數是該提交、分頁把兩個檔案竪著畫出來、可折疊、可返回；另有衝突狀態（擋提交、標記解決、中止合併）與差異頁動作列的斷言。

## 六、安全邊界

- `/dsh-git/api` 只接受 `content-type: application/json`——其他型別回 415，這會強制瀏覽器先送 preflight，於是外部頁面無法用「簡單請求」驅動本機 git。
- 請求裡的 `path` 必須落在已註冊的工作區內（或其子目錄），否則回 403；宿主沒有工作區清單時維持舊行為，不把面板鎖死。
- 所有檔案路徑都以 `:(literal)` pathspec 傳給 git，檔名含 `[ ] ? *` 時也只會動到那一個檔（見 `scripts/verify.mjs` 的 bracket 測試）。

## 六、程式結構

```
src/
  index.js          Host 外掛：/dsh-git/api 路由、同源檢查、subprocess 執行 git
  actions.js        動作表：action 名稱 → argv／GitHub REST，唯一的命令組裝處
  git.js            Git 引擎（可注入 exec，無 DSH 依賴）＋ status/diff 解析
  client/
    00-util.js      React、host 呼叫、格式化、layout/workspace 橋
    10-store.js     面板狀態（跨掛載保存）與所有操作
    15-diff.js      中央 diff 的目標狀態＋patch 解析（行號、並排配對）
    16-graph.js     歷史卡右側的分支軌道（lane 配置＋SVG）
    17-commit-diff.js 提交分頁的資料（按 repo#sha 快取、LRU、patch 解析）
    20-icons.js     手繪 SVG 圖示
    30-style.js     主題 token 驅動的 CSS
    40-panel.js     面板 UI（分支列、提交框、檔案列、工作樹、歷史卡、GitHub；`compact` 為右欄窄版）
    45-diff-panel.js 中央欄的 diff 面板（統一／並排、上一個／下一個）
    46-hover.js     提交／分支的 hover 詳情卡（portal、延遲、快取）
    47-commit-panel.js 提交分頁的面板（標頭、每檔一區塊、折疊、吸頂）
    50-plugin.js    字典 + 分頁型別（`sidebarRightTabs`，含 `multiple` 的提交分頁）+ slot 註冊
scripts/
  build.mjs         無 bundler：ESM 直送 + ModuleLoader 包裝
  verify.mjs        Git 引擎驗證
  render-test.mjs   jsdom 渲染驗證
docs/
  worktrees.md      工作樹功能的設計與取捨（含被 grill 的問題）
  commit-diff.md    提交差異分頁的設計與取捨（含被 grill 的問題）
```

## 七、已知邊界

- 主機路由掛在 `/dsh-git/api`（在核心 `/api` 認證圍籬之外），因此自己做了同源檢查，並在 `connection` 服務存在時請它做一次 `requestRejection`。只監聽 loopback 時風險與其他本機工具相同。
- 沒有 `gh` CLI 也能用：GitHub 走 REST + PAT。若之後裝了 `gh`，可以改走 `gh auth token` 免手動貼 token。
- 大型 repo 的第一次 `status --untracked-files=all` 會慢；與 VS Code 一樣有輸出上限（6 MB）。
