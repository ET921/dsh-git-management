# Graph 幾何/顏色 parity 檢查報告（T4）

- 角色：parity-qa｜taskId：task_mw8yz2bfq7v8d｜2026-11-09
- 基準：分支 `feat/graph-cursor-parity`（未 commit），基準規格 = `docs/research/cursor-graph-spec.md`（Cursor＝VS Code 1.128 SCM graph，bundle 反推）
- 範圍：`src/client/16-graph.js`（新逐列 SVG graph）、`40-panel.js`（HistoryCard/refBadges 整合）、`30-style.js`（列/badge 樣式）。QA 只擁有並修改 `scripts/render-test.mjs`、`scripts/qa/**`、`docs/qa/**`；**未改動任何 src/client 檔案**。
- **結論：四條指令全綠——build ✓、verify 213/213、render-test 308/308（舊 rail 斷言已換成逐列斷言）、graph-parity 35/35（exit 0）。未發現 src 缺陷；下表為存留的視覺差異（誠實清單）。**

## 一、規格值 vs 實測值對照表

「規格」出自 spec §1/§3/§4/§5（bundle 反推值），「實測」出自 `graph-parity.mjs` 對 `lib/client.js` 渲染 DOM 的量測。

| 項目 | Cursor/VS Code 1.128 規格 | 實測值 | 判定 |
| --- | --- | --- | --- |
| 列高 row height（fxr） | 22px | svg height=22、CSS `.gmg-commit-row{height:22px}`，13 列全中 | ✅ |
| 車道寬 lane width（q6） | 11px | 節點 cx 全為 11 的倍數；寬公式吻合（下項） | ✅ |
| svg 寬公式 | `11*(max(in,out,1)+1)` | 期望值由獨立 walker（自 spec 重寫，非 import 實作）算出，逐列比對 `width` 與 `viewBox="0 0 w 22"` 完全一致（22…55，4 車道列寬 55） | ✅ |
| 節點中心 | cx=11*(lane+1)，cy=11 | 全部命中 | ✅ |
| 普通節點 | r=5（BQi+1），strokeWidth 2，fill=節點色 | 每普通列恰 1 個 circle r5 | ✅ |
| merge 節點 | 外 r=6 + 內 r=3，同色 | 3 個 merge 列（m2/m4/b2）皆雙圈 r6+r3、fill 相同 | ✅ |
| current 節點 | 外 r=7（fill 節點色）+ 內 r=2、strokeWidth 4（BQi）、中心打穿 | 外 r7 sw2 ✓、內 r2 sw4 ✓、節點數=2 ✓；**內圈無 fill 屬性**（見差異 #1） | ✅* |
| 半徑全集 | {2,3,5,6,7} | 量測 radius set = `2,3,5,6,7`，無其它值 | ✅ |
| 弧線（車道交叉） | `A 11 11 0 0 1`（併入 (a)、額外父 (d)） | 7 條（3 fork + 4 converge），d-string 逐字元等於 spec walk | ✅ |
| 弧線（車道關閉彎道） | `A 5 5 0 0 1/0`（elbow (b)，jMt=5） | 1 條（b1 列，r2 車道左移 2→1），d 全等 | ✅ |
| 直線/端點 (c)(e)(f) | `M x 0 V 22`、節點上下 `V 11` 短樁 | 每列 path 集合與期望 **多集合完全相等**（含順序無關） | ✅ |
| 曲線 | 無 cubic | 0 條 `C` 指令 | ✅ |
| 車道色票 foreground1..5 | `#FFB000 #DC267F #994F00 #40B0A6 #B66DFF`（顺序即契約） | `LANE_COLORS` 同值同序；本 fixture 實際引出前兩色（#FFB000=f2 車道、#DC267F=hot 車道） | ✅ |
| ref 色 | head `#3794FF`、remote `#B180D7`、base/tag `#EA5C00` | 三者在 DOM 中皆有繪出；head 列下短樁 stroke=`#3794FF`；tag 列節點 fill=`#EA5C00` | ✅ |
| 節點色全集 | palette ∪ {head, remote, tag} | 所有 fill/stroke 均落在該 8 色集合內 | ✅ |
| edge 繪法 | fill=none、stroke-width 1、round caps、stroke=車道色 | 每條 path 屬性一致 | ✅ |
| badge 圓角/高度 | `.label` border-radius 10px、line-height 18px | `.gmg-ref{height:18px; border-radius:10px}` | ✅ |
| badge 規則 | 第一個 ref 顯示名稱，其餘依色族收斂成 icon-only | 每個有 ref 列恰 1 個具名 lead、其餘 `is-cluster` 無 `.gmg-ref-name`；順序＝head→remote→branch/tag（REF_RANK） | ✅ |
| 當前列字重 | label-name `font-weight:600` | `.gmg-commit-row.is-current .gmg-subject{font-weight:600}` + 恰 1 列 `is-current` | ✅ |
| 字級 | 列 13px | `.gmg-commit-row{font-size:13px}` | ✅ |
| hover 節點描邊 | circle stroke=sideBar 底、hover 外圈轉透明 | `.gmg-graph-node{stroke:var(--gmg-row-bg)}`、`:hover .gmg-graph-node{stroke:transparent}` | ✅（CSS 規則面） |
| 舊 rail 殘留 | — | 無 `--gmg-graph-w`（CSS 與 inline 皆無）、無 `.gmg-graph-dot`、`lib/client.js` 內 `GRAPH_ROW_HEIGHT = 22` | ✅ |

## 二、自動檢查項與結果

| 套件 | 命令 | 結果 |
| --- | --- | --- |
| 建置 | `node scripts/build.mjs` | ✓ lib/index.js, lib/actions.js, lib/git.js, lib/client.js（`lib/client.js` 為最新，含 `gmg-graph-edge`×2、無 legacy token） |
| Host 引擎 | `node scripts/verify.mjs` | **213/213 passed** |
| Client 渲染 | `node scripts/render-test.mjs` | **308/308 passed**（本輪把 563–601 行舊 rail 區塊換成逐列斷言：每列首子＝svg.gmg-graph、height 22、寬 22,33,33,33,33、cx 11 倍數、節點數 2,2,1,1,1、A 11 11 弧、is-current 類與 600 字重規則、22px/13px 樣式、badge 具名 lead＋icon-only cluster、無 `--gmg-graph-w`；其餘檢查全部保留） |
| QA parity | `node scripts/qa/graph-parity.mjs` | **35/35 passed，exit 0**（新檔；13 列 fixture：3 merge、5 分支、最寬 4 車道、elbow/併入/分叉弧各≥1） |
| 一鍵回歸（旁證） | `node scripts/qa/run.mjs` | 既有 runner 未受本輪影響（其斷言在 host 語意層） |

`graph-parity.mjs` 的特點：期望值来自**獨立重寫**的 swimlane walker（依 spec §1.1/§3.1/§4.1），逐列比對 path d-字串多集、circle 座標/半徑/描邊/填色與 svg 尺寸；實作一旦偏離 spec（含顏色順序、弧參數、寬公式）即轉 FAIL。

## 三、仍存的視覺差異（誠實清單）

| # | 差異 | 影響 | 備註 |
| --- | --- | --- | --- |
| 1 | current 內圈無 `fill` 屬性：VS Code 顯式 `fill=sideBar-background`，且 hover 時經 CSS `circle:last-child{fill:…}` 維持碟感；本實作內圈落到 SVG 預設黑。暗色主題下黑色≈列底色、視覺接近；**亮色主題中心點會是可見黑點** | 小（亮主題可察） | 30-style.js 目前無 `.is-current-inner` 規則；是否補 CSS 由 Lead/graph-engine 決定，QA 未動 src |
| 2 | svg 尺寸與 strokeWidth 以 **attribute** 呈現；VS Code 用 `style=`（spec §3.2 step 5）。渲染結果相同，DOM 形態不同 | 無（僅內部契約形態） | 兩套測試因此斷言 getAttribute |
| 3 | badge 字級 11px（VS Code `.description`/`.count` 12px）、glyph 10px（codicon 14px）、具名膠囊 max-width 108px（spec 100px）、字體 mono | 細微排版差 | 屬面板既有排印体系 |
| 4 | badge 配色用面板語義色（`--gmg-local #4d82ff`/`--gmg-remote #b06bff`/`--gmg-tag #f59e0b`），與 graph 的 charts 色不同；VS Code badge 與車道同色 | 有意為之 | `40-panel.js:585` 註解明示「lane colour belongs to the line, not the label」 |
| 5 | graph 三 ref 色常駐 dark 值（#3794FF/#B180D7/#EA5C00）；VS Code light 主題為 #1a85ff/#652D90 | 小（亮主題色值偏深） | 五車道色兩主題本就同值，無此問題 |
| 6 | 車道色身份僅在单次 re-layout 內穩定（palette cursor），非持久化；VS Code 依 lane index 穩定取色 | 列表重繪時颜色可能移 | 順序契約（foreground1 先開）已滿足 |
| 7 | SVG 抗鋸齒、字體 hinting、monaco 虛擬列表捲動行為無法在 jsdom 斷言 | 需實機 | 建議隨後續截圖波在真 Cursor/DSH 對比 |

## 四、重跑指令

```bash
node scripts/build.mjs && node scripts/verify.mjs && node scripts/render-test.mjs && node scripts/qa/graph-parity.mjs
```

## 五、收尾全鏈 tail（2026-11-09，S7）

```
build  ✓ lib/index.js, lib/actions.js, lib/git.js, lib/client.js (id dsh-git-management)
verify 213/213 checks passed                     (exit 0)
render 308/308 checks passed                     (exit 0)
parity fixture: 13 rows, 3 merges, lanes up to 4, 7 lane-cross arcs, 1 elbows
parity radii seen: 2,3,5,6,7
parity 35/35 parity checks passed                (exit 0)
git status --short lib →  M lib/client.js（已是剛重建的最新產物）
```
