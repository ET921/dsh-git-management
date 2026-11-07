# 多專家評審彙整 → 實作計畫（v1）

依據：`docs/reviews/{engineer,product,design,poweruser,gitexpert}.md`（含各方的交叉評審回應）。
本檔是最終約定：兩個實作 agent（host / client）檔案分界**互不重疊**，介面以本檔為準。

## 一、共識裁決（監督者判）

| # | 項目 | 出處 | 裁決 | 歸屬 |
| --- | --- | --- | --- | --- |
| 1 | pathspec 一律 `:(literal)` | gitexpert P0；engineer/design/poweruser/product 背書 | **本輪必做**，host 側最優先 | A |
| 2 | `/dsh-git/api` 信任邊界：Content-Type 白名單＋工作區路徑白名單 | engineer #1+#2；gitexpert 背書 | **本輪必做**；**先寫測試**（正常路徑不被鎖死）再寫實作；**不封鎖 `Origin: null`** | A |
| 3 | 衝突收尾鏈：`diff --cc` 降級提示＋衝突中擋 commit＋衝突列「標記為已解決」＋「中止合併」 | gitexpert＋product G2/G3＋poweruser F7＋design | **本輪必做**（先不做 rebase-continue/pull-rebase） | A(擋/中止)＋B(按鈕/提示) |
| 4 | busy token＋error 不被輪詢清掉＋epoch 守衛＋loadRepos/loadGithub 失敗可見 | engineer #3–#6；poweruser F2/F3；product Top1 | **本輪必做** | B（需 host 無配合項） |
| 5 | `parsePatch` hunk 內容行（`--- `/`+++ ` 開頭的本文）誤判 | engineer #7；design/gitexpert 背書 | **本輪必做**（seenHunk 狀態機） | B |
| 6 | 差異頁 action bar：暫存此檔／放棄更改（有確認） | poweruser F1；product Top3 | **本輪必做**（hunk 級**不做**） | B |
| 7 | branch `for-each-ref` 分隔符 `|` → `%00` | engineer %00 實測；gitexpert 撤回折衷案 | **本輪必做**（兩行改動） | A |
| 8 | bare repo probe 誤判 | gitexpert P1；engineer 背書 | **本輪必做**（拆分 rev-parse 旗標） | A |
| 9 | detached HEAD 的 push 組出 `origin null` | gitexpert P1 | **本輪必做**（狀態前置檢查＋GitError） | A |
| 10 | `:focus-visible` 全套 | design P0；engineer 同意；product 反對優先級 | **本輪做**（純 CSS、成本≈0；不宣稱 P0） | B |
| 11 | sticky notice（錯誤捲動後仍在視線） | poweruser F2；design/engineer 背書 | **本輪做**（一段 CSS） | B |
| 12 | 檔案動作只重讀 status（不重讀 log/branches） | poweruser F3；engineer 背書 | **本輪做**（儲存庫加 `refreshStatus()`） | B |
| 13 | amend 預覽＋stageAll 之後不自動殘留 | poweruser F4；gitexpert 認定資料正確性 | **本輪做**（勾 amend 自動帶入 HEAD 訊息；提交後重設勾選） | B |
| 14 | commitDetail 對 merge commit numstat 空輸出 | gitexpert P1 | **本輪做**（`--diff-merges=first-parent`） | A |
| 15 | GHES apiBase fallback（非 github.com host → `/api/v3`） | gitexpert P1；engineer P2 | **本輪做**（成本极低） | A |
| 16 | selectRepo 重設 diff store | engineer 次要；poweruser F1 邊界 | **本輪做** | B |

## 二、明確**不做**（本輪，附理由）

- **右鍵選單**（poweruser F12 vs design 反對）→ 不做；可見按鈕已覆蓋。
- **stash**（product P1 vs design 反對固定位置）→ 不做；等「衝突/錯誤生命週期」落地後第二輪再議。
- **undo commit**（product G4）→ engineer 證明它不是一顆按鈕（upstream 判斷＋merge 語意），第二輪。
- **pull --rebase 路徑**（product G1 後半）→ 第二輪；本輪只保證錯誤可見（#4）。
- **hover 卡加連結/複製 sha**（poweruser F9 vs design 保卡面純淨）→ 第二輪再議。
- **樂觀更新、fs.watch、hunk 級暫存、歷史列點擊開檔** → 第二輪以後。
- **不封鎖 `Origin: null`、不引入 bundler/依賴、不動已完成的 hover 卡/軌道/選單**。

## 三、檔案分界（嚴格互斥）

**Agent A（host）**：`src/git.js`、`src/actions.js`、`src/index.js`、`scripts/verify.mjs`
**Agent B（client）**：`src/client/*.js` 全部、`scripts/render-test.mjs`
**共用測試契約**：衝突降級由 client 自行從 patch 判定（`/^diff --(cc|combined) /m`），不依賴 host 新旗標；「中止合併」動作名 `abortMerge`，回傳 `{ summary }`，由 A 在 `actions.js` 註冊、B 在 store 呼叫，動作名以本檔為準。
**都不得 commit**；A 最後只跑 `node scripts/verify.mjs`（不需 build）；B 最後跑 `node scripts/build.mjs && node scripts/render-test.mjs`。lib/ 由監督者最終統一重建並提交。

## 四、驗收（監督者）

1. 兩 agent 完成後：`git diff --stat` 人工抽查；越界檔案＝退回。
2. `npm test`（host＋render 全綠）。
3. 針對 #1/#2/#5 新增的測案例行核對斷言內容（不是只看 pass 數）。
4. 以 `dev : ` 前綴提交（可拆 host/client 兩筆）。
