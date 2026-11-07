# 設計評審：DSH Git 面板（右側欄，約 320–420px）

## 總覽
設計系統遵循 `--dsw-alias-*` token 與 `--gmg-mono`，bg/layer/border/label/brand/state 用對了；`is-compact` 有對應覆寫。整體密度適合開發者工具，但鍵盤焦點與色彩透明度在深淺主題上有穿孔。

---

## 逐區稽核

### 頁首 / repo 選擇 / 刷新 — `30-style.js:40-67` + `40-panel.js:65-123`
- `.gmg-icon-btn` 28×28px，目標大小達標（≥24px）。但無 `:focus-visible`，鍵盤 Tab 過去看不見焦點（a11y 缺失）。建議補 `.gmg-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }`。**P0**
- `.gmg-select` 高 28px，下拉選單由 OS 繪製，深色主題下可能與 panel 違色，但屬宿主行為，暫不動。
- 刷新按鈕 `is-spinning` 僅作用於 svg，按鈕本體無 loading 狀態變化，忙碌時版面不跳動（好）。

### 分支列 / pill / 選單 — `30-style.js:74-121` + `40-panel.js:536-690`
- `.gmg-branch` 省略號處理長分支名（`text-overflow: ellipsis`），CJK 不換行，合適。
- `.gmg-branch:focus-visible` 已有品牌色外框（好），但選單項 `.gmg-branchitem` 無鍵盤游標焦點樣式（`is-active` 僅背景色，無外框），方向鍵游走時焦點不可见。**P0**
- `.gmg-branchmenu` 為 `position: fixed` portalled，不會被 panel 捲軸裁切（好）。`max-height: 300px` 且 `overflow: auto`，長分支清單可捲，但無捲軸樣式，深色主題下 OS 捲軸可能過粗。**P2**
- 選單鍵盤操作完整（Esc/Arrow/Enter/Space），有 `aria-haspopup`/`aria-expanded`（好）。

### 提交框 — `30-style.js:147-184` + `40-panel.js:797-869`
- `.gmg-textarea` min-height 62px / max-height 220px，可直向縮放，密度合適。
- `:focus` 用 `color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent)` 做 ring，22% 過淺，淺色主題下幾乎看不見，建議提高到 35% 或改用 solid 2px brand border。**P1**
- `.gmg-btn.is-primary` disabled 時僅 `opacity: .45`，無 cursor 區別問題已有 `cursor: default`（好）。
- 無 empty/error 狀態於提交框本身，錯誤靠上方 `.gmg-notice is-error` 呈現（好）。

### 變更清單（已暫存 / 更改 / 衝突）— `30-style.js:165-195` + `40-panel.js:876-1015`
- `.gmg-file` `tabIndex="0"` + `role="button"`，但無 `:focus-visible`，鍵盤無法看出哪一列被聚焦。**P0**
- 列內動作 `.gmg-actions` 預設 `opacity: 0`，hover 才顯示。對開發者工具可接受（密度優先），但發現性低（affordance 不足），建議改為 `opacity: .55` hover 到 1，或至少讓主要動作（stage/discard）常顯示。**P1**
- `.gmg-name` / `.gmg-dir` 省略號，長路徑不破壞列高（好）。`.gmg-status` 16px 固定寬，狀態字元居中（好）。
- 衝突組無行內動作（僅標示），符合「不做衝突解決器」的設計決定。

### 歷史卡 + SVG 分支軌道 — `30-style.js:212-261` + `16-graph.js`
- `.gmg-commit-row` 高度 26px 與 `GRAPH_ROW_HEIGHT = 26` 嚴格對齊，軌道不斷裂（好）。
- `.gmg-ref` 徽章最寬 108px，省略號；多於 2 個 ref 顯示 `+n`，標題於 `title`，長 ref 名不破壞列（好）。
- `.gmg-ref.is-head` 用 `color-mix(..., brand-primary 18%, transparent)` 做底色，在深色主題下若 brand-primary 本身較淡，18% 與 `bg-layer-2` 混合會糊掉，建議換成 `bg-layer-2` + brand-primary 文字，或提高到 28%。**P1**
- SVG 顏色前四個是 theme token（好），後三個是固定 hex（`#8b7cf6` 等），深色主題尚可，淺色主題 `#d0729e` 對比可能不足，建議全改用 token。**P2**
- 圖形為 `aria-hidden`，輔助技術跳過，資訊在列文字中已有（好）。

### 差異面板（中心欄）— `30-style.js:327-371` + `45-diff-panel.js`
- 雙欄行號 `grid-template-columns: 54px 54px 1fr`，行號右對齊、邊框分隔，可讀（好）。
- 紅綠底用 `color-mix(..., 12%, transparent)`，對比較低，適合 diff 補色（好）。
- 單欄模式 `min-width: max-content`，長行不換行，橫向捲動，符合 diff 慣例（好）。
- `gmg-diff-cell` `title` 僅在 `clip` 時才給，長行 hover 才見全文，可接受。
- loading / error / binary / empty 均用 `.gmg-empty` 呈現，狀態完整（好）。

### GitHub 卡 — `30-style.js:272-287` + `40-panel.js:1024-1263`
- `.gmg-gh-tabs` 內混雜 tab 與刷新按鈕（`IconRefresh` 外觀同 tab），功能與導航混在一起，affordance 模糊。建議將刷新移出 tab strip，或給不同樣式（`is-ghost` + 較小）。**P2**
- 建立 PR 表單 `.gmg-form` 內輸入欄寬度不一（title 寬、base 固定 140px），版面略散。建議統一為 flex 1 與 max-width 限制。**P2**
- Tab 切換會重新 `loadGithub`，無 loading 反饋，空白期間 `gmg-gh-row` 區塊為空，建議在 `.gmg-scroll-cap` 內出現 `.gmg-empty` loading。**P1**

### hover 詳情卡 — `30-style.js:375-431` + `46-hover.js`
- 280ms dwell 才出現，不可點，不阻斷原始點擊，時機合適（好）。
- 卡片開於欄左、右緣距欄 12px，寧可蓋住對話不壓行，符合設計意圖（好）。
- 高度不設上限，超過視窗時 `position: sticky` 頭部固定並自行捲動，`overscroll-behavior: contain` 不會連帶捲動背景（好）。
- `.gmg-hover` `max-width: 400px` 與右欄寬度 320–420px 幾乎等寬，在窄欄下會幾乎佔滿整欄且蓋住對話，有壓迫感；建議上限降到 320px，或依可用空間縮比例。**P1**
- `useGithubAuthor` 錯誤靜默吞掉（`.catch(() => {})`），卡片不顯示錯誤狀態，符合「讀取失敗不應打斷」原則（好）。

---

## 互動稽核

1. **hover 卡出現時機**：280ms dwell + `onMouseDown: closeNow`，滑快略過不誤觸，滑鼠移入卡片會 `keepOpen`，不會在滑入卡片瞬間消失（好）。
2. **選單鍵盤**：BranchMenu 有完整方向鍵/Enter/Space/Esc，且 `scrollIntoView({block:'nearest'})` 讓游標保持可見（好）。
3. **捲軸巢狀**：panel root `.gmg-root { overflow: auto }`，分支選單與 hover card 皆 portalled 到 body，不會被 panel 捲軸裁切（好）。`.gmg-diff` / `.gmg-scroll-cap` 內部自行捲動，巢狀捲軸由 OS 處理，無樣式干預（可接受）。
4. **loading 版面跳動**：提交框 / 歷史 / GitHub 均用 `.gmg-empty` 佔位，高度固定約一行，不會造成版面位移（好）。

---

## 最值得做的三件（依優先級）

1. **補缺 `:focus-visible`**（P0）：`.gmg-icon-btn`、`.gmg-btn`、`.gmg-file`（`tabIndex=0`）、`.gmg-branchitem` 鍵盤游標皆無焦點指示，開發者工具鍵盤操作頻繁，這是最礙用的缺口。建議統一 `outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px;`。
2. **提交框 focus ring 加強**（P1）：`.gmg-textarea:focus` 的 `color-mix(..., 22%, transparent)` 在淺色主題幾乎看不見，改為 35% 或 solid brand border。
3. **hover 卡寬度下限**（P1）：`.gmg-hover` `max-width: 400px` 與 320–420px 欄位幾乎等寬，窄欄下壓迫感強，建議改為 `max-width: 320px`，或依 `edge` 可用空間按比例縮小。

## 不建議動的地方

- **列內動作預設隱藏（`.gmg-actions opacity: 0`）**：不要改成常顯示。右欄寬度有限，常顯示三個圖示按鈕會嚴重擠壓路徑與統計資訊，違反「密度比留白重要」。
- **SVG 分支軌道固定 hex 色不要換成全 token**：目前前四個已是 token，固定色僅作為 lane 五號之後的備用，改動收益低，且 token 數量不足夠給多 lane 區分。
- **hover card 不可點、不可操作**：保持唯讀放大，不要加連結或按鈕，否則會與原始列的點擊行為產生競爭，違反「不影響原本的點擊行為」原則。

---

**檔案對照**：`src/client/30-style.js`（CSS token 與元件樣式）、`40-panel.js`（分支列、提交框、變更清單、GitHub）、`45-diff-panel.js`（中心差異）、`46-hover.js`（hover 卡）、`16-graph.js`（歷史軌道）。

## 交叉評審回應

### 同意並借用
1. **同意 gitexpert P0 pathspec 萬用字元污染**：清單完全漏了；含 `[` `*` 檔名的單檔 stage/discard 會動錯檔案，動搖我對 `.gmg-actions` 可靠性的假設，併入後列內動作 P1 優先級提高。
2. **同意 product G2/G3、poweruser F7**：衝突列需行內動作。原文「符合不做衝突解決器（好）」太寬鬆；標記為已解決（git add）是收尾非解決器。撤回「好」，列 P1 缺口。
3. **同意 engineer 發現 7（parsePatch hunk 邊界）**：diff 面板標「狀態完整（好）」過於寬鬆；`---`/`+++` 內容行誤判為檔頭，行號與 +/- 統計錯亂。降級為「視覺完整、邏輯待修」。
4. **同意 poweruser F9、product G7**：歷史提交列點擊無反應，缺開檔案清單／複製 sha／在 GitHub 開啟。我完全沒觸及，補 P2 發現。
5. **同意 engineer gmgDetailCache 無 TTL、poweruser F2**：hover 卡顯示舊資料不標過期；`.gmg-notice` 隨頁面捲動離開視線，錯誤可能完全看不見。兩者皆補上。

### 不同意
1. **不同意 poweruser F12 右鍵選單**：右鍵對鍵盤與觸控不可發現，360px 欄位誤觸成本高；可見動作按鈕比隱藏選單更符合 a11y 與發現性。右鍵只能補充，不應列優先修項。
2. **不同意 product G9 固定位置放入 stash**：stash 低頻且風險高，360px 常駐位值錢；丟進「⋯」選單又違反「常用必須露在外面」。保留終端操作，或僅在髒檔擋切換時以一次性 toast 建議，不佔永久 UI。
3. **不同意 product「沒 GitHub 遠端整卡收起」**：空卡本身是發現性，告知「這裡能連 GitHub」；收起後能力隱形。保留空卡，降低視覺重量（灰色、縮短高度）即可。

### 修正自己
1. 撤回「衝突組無行內動作……好」→ P1：給衝突列「標記為已解決」（git add），與不做衝突解決器不衝突。
2. 降級 diff 面板「狀態完整（好）」→ hunk 邊界 bug 會弄錯行號與統計，標「視覺完整、邏輯待修」。
3. 加強 hover card 判斷：錯誤靜默吞掉不該全然稱好，並補 `gmgDetailCache` 無 TTL 資料過時問題；建議加 stale 標記或 TTL。
4. 新增發現：歷史提交列點擊無反應，缺開檔案清單／複製 sha／在 GitHub 開啟入口（product G7, poweruser F9）。
5. 新增發現：`.gmg-notice` 隨頁面捲動離開視線，錯誤/成功回饋可能完全看不見（poweruser F2）。

### 最終 Top 3（設計／UI 視角）
1. **統一 `:focus-visible` 與鍵盤游標**：`.gmg-icon-btn`、`.gmg-file`、`.gmg-branchitem` 缺焦點指示，鍵盤是開發者工具第一操作方式，最礙用缺口（P0）。
2. **衝突列與同步失敗給出可執行下一步**（product G2/G3, poweruser F7/F5）：「看得到卻做不下去」是最大體驗斷點，優先補「標記為已解決」與 rebase 路徑，非只顯示錯誤。
3. **訊息與錯誤必須跟隨視窗且可復原**（poweruser F2/F10）：`.gmg-notice` 捲動後消失、成功提示不自動消失，使用者無法確認操作結果，違反回饋可見原則（P0/P1）。
