# Cursor History Graph — 反編譯規格書

> 目標：把 Cursor 3.29.9（內嵌 VS Code 1.128.0）SCM History 的 commit graph 精確規格提取出來，供本專案 `graph-engine` / `panel-integrator` 對齊。
>
> 來源（所有數字均標明出處）：
> - **bundle**：`/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`（38.8 MB，UTF-8 字元索引）
> - **css**：`.../workbench.desktop.main.css`（1.27 MB）
> - **git-ext**：`/Applications/Cursor.app/Contents/Resources/app/extensions/git/dist/main.js`
> - **截圖**：`docs/research/refs/cursor-target.webp`（560×1138，亮色）與 `docs/research/refs/project-current.webp`（806×1428，暗色）

---

## 1. 常數與顏色表

### 1.1 幾何常數（bundle @char 23260976–23261001）

| 符號 | 值 | 意義 | 出處 |
|---|---|---|---|
| `fxr` | **22** | 列高（row height） | bundle |
| `q6` | **11** | 車道水平寬（lane width） | bundle |
| `jMt` | **5** | 車道關閉轉彎半徑 | bundle |
| `BQi` | **4** | 節點基準半徑 | bundle |
| `UQi` | **2** | 節點 stroke 寬度 | bundle |

衍伸值（bundle 推導）：
- 節點中心 `cy = fxr / 2 = 11`
- 車道 `i` 的 x = `q6 * (i + 1) = 11*(i+1)`
- 每列 svg 寬 = `q6 * (max(in, out, 1) + 1) = 11*(max+1)`

### 1.2 車道色票 `Fkf`（bundle @char 23261780 附近）

5 個註冊色（`Ht("scmGraph.foregroundN", <default>, …)`），深淺主題同值：

| 順序 | 色值 |
|---|---|
| foreground1 | `#FFB000` |
| foreground2 | `#DC267F` |
| foreground3 | `#994F00` |
| foreground4 | `#40B0A6` |
| foreground5 | `#B66DFF` |

### 1.3 ref 顏色（bundle @char 23261080–23261150）

| 符號 | 註冊鍵 | 預設值（dark / light） |
|---|---|---|
| `Y0a` | `scmGraph.historyItemRefColor`（head） | `charts.blue` = `editorInfo.foreground` → **dark `#3794FF` / light `#1a85ff`** |
| `GNb` | `scmGraph.historyItemRemoteRefColor`（remote） | `charts.purple` → **dark `#B180D7` / light `#652D90`** |
| `zNb` | `scmGraph.historyItemBaseRefColor`（base） | **`#EA5C00`**（固定，兩主題同值） |

### 1.4 ref → icon 對應（git-ext `toSourceControlHistoryItemRef` @174k）

| ref | icon（`ThemeIcon`） | 顏色 | 來源 |
|---|---|---|---|
| HEAD（`currentHistoryItemRef`） | **`target`** | `Y0a`（藍） | git-ext + bundle |
| remote branch（`currentHistoryItemRemoteRef`） | **`cloud`** | `GNb`（紫） | git-ext + bundle |
| tag（`refs/tags/*`） | **`tag`** | 無自帶色（見 §2.3） | git-ext |
| base（`currentHistoryItemBaseRef`，merge-base） | **`cloud`** | `zNb`（#EA5C00） | git-ext + bundle |

> ⚠️ 與 Lead 簡報差異：簡報寫「base→**target** #EA5C00」。實測 git-ext 中 base ref 的 icon 是 **`cloud`**（它是 remote merge-base），`target` 只用在 HEAD。詳見 §9。

---

## 2. `layoutHistory`：車道配置精確演算法

來源：bundle `JNb`（toHistoryItemViewModel，@char 23264606）+ `_getGraphColorMap`（@char 33527831）+ `X0a` + `VNb`（@char 23260800）。

### 2.1 資料流

```
_getGraphColorMap(filterRefs) → Map<refId, color|undefined>
  └─ 依序塞入：
       head.id   → Y0a（藍）
       remote.id → GNb（紫）
       base.id   → zNb（#EA5C00）
       其餘 filter refs → key 存在、value = undefined（代表「無自帶色」）

JNb(commits, colorMap, headRef) → rows[]
```

### 2.2 精確 pseudocode

```
function layoutHistory(commits, options):
  # options = { currentSha, refColor(ref) }   ← 等價於上面的 colorMap
  s = -1                 # 全域色票計數器（只在新開 lane 時 +1）
  rows = []

  for commit in commits:                       # newest first（--topo-order）
    isCurrent = (commit.id == options.currentSha)

    # input swimlanes = 上一列 output swimlanes 的 clone
    input  = clone(prev.outputSwimlanes)       # 每個元素 {id, color}

    output = []
    firstInherited = false

    # 1) 已存在且 id == 本 commit 的 lane：由第一父沿用
    for lane in input:
      if lane.id == commit.id:
        if not firstInherited:
          output.push({ id: commit.parents[0],
                        color: refColor(commit) ?? lane.color })  # 有 ref 色優先，否則沿用原 lane 色
          firstInherited = true
        # 其餘同 id lane：直接消失（合併進本節點）
        continue
      output.push(clone(lane))                 # 其餘 lane 原樣延續

    # 2) 額外 parent：新開 lane
    for p in (firstInherited ? parents[1:] : parents):
      color = (p == parents[0]) ? refColor(commit)
            : (p == 其他parent) ? refColor(找到的 parent commit)
            : undefined
      if color == undefined:
        s = (s + 1) % 5                        # 只在真正新建時進位，非 lane index
        color = Fkf[s]
      output.push({ id: p, color: color })

    # 3) references 著色
    refs = commit.references.map(ref => {
      c = colorMap.get(ref.id)
      if (colorMap.has(ref.id) && c == undefined):
        # 該 ref 在 filter 中但無自帶色 → 用對應 swimlane 色
        laneIdx = input.findIndex(l => l.id == commit.id)
        S = (laneIdx != -1) ? laneIdx : input.length
        c = (S < output.length) ? output[S].color
          : (S < input.length)  ? input[S].color
          : Y0a
      return { ...ref, color: c }
    })
    refs.sort(byRefPriority)                   # 見 §2.4

    rows.push({ historyItem: {...commit, references: refs},
                isCurrent,
                inputSwimlanes: input,
                outputSwimlanes: output })
  return rows
```

### 2.3 顏色分配規則（重點）

1. **inputSwimlanes = 上一列 outputSwimlanes 的 clone**（`map(v => clone(v))`），保證不共享物件。
2. **第一父沿用既有 lane**：保留該 lane 顏色；若該 commit 有自帶 ref 色（`refColor`）則用它，否則沿用原 lane 色。
3. **新開 lane 的顏色**：優先該 parent commit 的 ref 色；否則用**全域色票計數器 `Fkf[s]`**，且 `s` **只在每次真正新建時 +1**（`(s+1) % 5`），**不是** lane index。因此同一分支的多次開岔會吃到不同色票。
4. **references 顏色**：ref 自帶色（head 藍 / remote 紫 / base 橙）優先；否則取**對應 swimlane 色**（找到本 commit 所在 lane 的 index，取 output/input 該 index 的顏色）；再否則回退 `Y0a`。
5. **node 顏色**（render 時，`XNb`）：`output[l].color → input[l].color → 預設 Y0a`。

### 2.4 ref 排序（`VNb` @char 23260800）

優先級（越小越前）：

```
1  id == headRef.id        （當前列 / HEAD）
2  id == remoteRef.id      （remote）   ← 實際呼叫只傳了 headRef，故 2/3 恆不觸發
3  id == baseRef.id        （base）
4  color != undefined      （有自帶色）
99 其餘（無色）
```

> 實測呼叫：`JNb(commits, colorMap, historyItemRef.get())` 只傳 3 參，故 remote/base 不參與排序優先級，只靠「有無色」分先後。

---

## 3. `renderHistoryItemGraph`：逐列 SVG 繪製

來源：bundle `XNb`（@char 23262704–23264410）。

每列產出一個 `<svg class="graph">`：

- `height = 22`（`o = t ?? fxr`）
- `width = 11 * (max(input.length, output.length, 1) + 1)`
- 車道 `i` 的 x 中心 = `11*(i+1)`；節點中心 y = `11`（`o/2`）
- 所有 `path`：`fill=none`、`stroke-width=1px`、`stroke-linecap=round`、`stroke=該 lane 色`（helper `mxr` @char 23262053）

記號：`l` = 本 commit 的 lane（`input.findIndex(id==commit.id)`，找不到時 = `input.length`）；`u` = 該 input lane 對應的 output lane index。

### 3.1 六種 path（全部以 `q6=11, jMt=5, o=22` 展開）

**(a) 上方 lane 併入本列節點**（`input[d].id == commit.id` 且 `d != l`）：

```
M 11*(d+1) 0  A 11 11 0 0 1 11*d 11  H 11*(l+1)
```

**(b) lane 關閉移到另一 lane**（`input[d].id == output[u].id` 且 `d != u`）：

```
M 11*(d+1) 0  V 6  A 5 5 0 0 1 (11*(d+1)-5) 11  H (11*(u+1)+5)  A 5 5 0 0 0 11*(u+1) 16  V 22
```

**(c) 同 lane 直線**（`d == u`，走 helper `gxr`）：

```
M 11*(d+1) 0  V 22
```

**(d) 額外父**（`for d in 1..parents.length-1`，`p = 找到該 parent 的 output lane index`，找不到跳過）：

```
M 11*p 11  A 11 11 0 0 1 11*(p+1) 22  M 11*p 11  H 11*(l+1)
```

**(e) 節點上方**（本 commit 在 input 中 `a != -1`）：

```
M 11*(l+1) 0  V 11
```

**(f) 節點下方**（`parents.length > 0`）：

```
M 11*(l+1) 11  V 22
```

### 3.2 繪製順序（`XNb` 迴圈）

1. `for d in 0..input.length-1`：先畫 (a)/(b)/(c)；若 `input[d].id == commit.id` 且 `d == l` 則 `u++`（標記本 lane 已消費）。
2. `for d in 1..parents.length-1`：畫 (d)。
3. 若 `a != -1` 畫 (e)；若 `parents.length > 0` 畫 (f)。
4. 畫節點（§4）。
5. 設 `svg.style.height/width` 並回傳。

---

## 4. 節點規格（三型態）

來源：bundle `HQi`（@char 23262330）+ `XNb` 節點段 + css `.graph > circle`。

helper `HQi(lane, r, strokeWidth, fill, rowHeight=22)`：

```
circle:
  cx        = 11 * (lane + 1)
  cy        = rowHeight / 2 = 11
  r         = r
  strokeWidth = strokeWidth px（style）
  fill      = fill 若給，否則不設（由 CSS 補 stroke）
```

CSS（css @char 898700 附近）：

```css
.history-item>.graph-container>.graph>circle        { stroke: var(--vscode-sideBar-background); }
.monaco-list-row:hover ... .graph>circle:first-of-type { stroke: transparent; }
.graph-container.current>.graph>circle:last-child     { fill: var(--vscode-sideBar-background); }
```

### 4.1 三型態（`BQi=4, UQi=2`）

| 型態 | 外層 | 內層 | 視覺 |
|---|---|---|---|
| **普通**（`parents.length ≤ 1` 且非 current） | `r = BQi+1 = 5`，strokeWidth `UQi=2`，fill=node 色 | 無 | 實心圓（邊緣 2px 被背景色 stroke 吃掉 → 空心感） |
| **merge**（`parents.length > 1`） | `r = BQi+2 = 6`，strokeWidth `2`，fill=node 色 | `r = BQi-1 = 3`，strokeWidth `2`，fill=node 色 | 大圓包小圓（同色，中間形成環 + 中心點） |
| **current**（`isCurrent`） | `r = BQi+3 = 7`，strokeWidth `2`，fill=node 色 | `r = UQi = 2`，strokeWidth `BQi = 4`，fill=`var(--vscode-editor-background)` | 大色環 + 中心背景色圓點 |

### 4.2 視覺成因

- **普通節點**：外圈 2px 是背景色 stroke，疊在 r=5 的實心圓上，只露出內徑約 4 的色盤 → 看起來比 r=5 小一號，且與車道線粗細（1px）形成對比。
- **merge**：外 r=6 環 + 內 r=3 環同色，兩環之間與中心各自留出背景色縫隙 → 「同心雙環」讀作「兩線合一」。
- **current**：外 r=7 色環 + 內 r=2、strokeWidth=4 的背景色圓點，中心被打穿成背景色 → 一個明顯的「靶心/光環」，標記 HEAD。hover 時 `circle:first-of-type` stroke 變透明（外環融入），current 列 `circle:last-child`（內點）fill 變 sideBar 背景，讓整列 hover 時仍讀作一個乾淨的碟。

---

## 5. DOM 結構與 CSS 度量

來源：bundle `Bui` renderer（@char 33516000）+ css `.history-item`（@char 898700）。

### 5.1 列 DOM

```
div.monaco-list-row
 └─ div.history-item
     ├─ div.graph-container [.current 若 isCurrent]   ← flex-shrink:0; height:22px
     │    └─ svg.graph                                ← 本列切片（§3）
     ├─ .monaco-icon-label  (subject + author)        ← [.history-item-current 若 HEAD]
     └─ div.label-container                           ← gap:4px; flex-shrink:0
          └─ div.label                                ← 每個 ref/badge，border-radius:10px; line-height:18px
               ├─ div.count@count     (font-size:12px；>1 個才顯示)
               ├─ div.icon@icon       (codicon)
               └─ div.description@description (font-size:12px；只有第一個 ref 顯示)
```

### 5.2 CSS 度量總表

| 屬性 | 值 | 出處 |
|---|---|---|
| 列高 / line-height | **22px**（`getHeight(){return 22}`） | bundle + css |
| `.history-item` | `display:flex; align-items:center` | css |
| `.graph-container` | `flex-shrink:0; height:22px` | css |
| current 列 label-name | `font-weight:600`（description 500） | css |
| `.label-container` | `gap:4px` | css |
| `.label`（badge） | `border-radius:10px; line-height:18px; display:flex; align-items:center` | css |
| `.label .description` | `max-width:100px; font-size:12px; overflow:hidden; text-overflow:ellipsis; padding-right:4px` | css |
| `.label .count` | `font-size:12px; padding-left:4px` | css |
| `.label .codicon` | `font-size:14px; padding:2px`；`codicon-git-branch` 特例 `font-size:12px; padding:3px` | css |
| 列內字級 | 主標籤（subject/author）13px（`.monaco-list` 預設，無覆寫）；label 描述 12px、count 12px、icon 14px（git-branch 12px）；hover 卡片內 tag/target/cloud 圖示 14px | css |

### 5.3 badge 分組規則（bundle `_renderBadges` + `_renderBadge` @char 33517000）

1. `r = references.slice()`。
2. 若 `r[0].color` 存在 → 第一個 badge **顯示名稱**（`description` 有文字），並 `splice(0,1)`。
3. 其餘 ref 依 `color` 分組（`color ?? ""`）；`color==""` 的組在配置非 `"all"` 時**跳過**（預設 `scm.graph.badges = "filter"`）。
4. 每個色組內再依 `icon.id` 分組；每個 (色, icon) 組渲染一個 badge（**只顯示 icon**，無名稱）。
5. 組內 `length > 1` 時顯示 `count`。

**badge 著色**（`_renderBadge`）：`background = ref.color`（有色）或 `Nkf`（無色）；文字色 = `Okf`（有色）或 `Rd`（無色）。

---

## 6. 對使用者截圖的像素量測

> 量測用 Pillow 12.3（`office-runtime` 內建 python3.12）。所有數值為**裝置像素**；換算 CSS 像素用「列高比」反推的縮放係數（見下）。工具只能做數值取樣（當前模型無影像輸入），色票採節點/色塊中心。

### 6.1 cursor-target.webp（560×1138，亮色主題，圖形在**左**）

縮放係數：列高實測 36–37 裝置 px ↔ 22 CSS px → **≈ 1.66×**（車道 18.5 ↔ 11 亦吻合 1.68×）。

| 量測項 | 裝置 px | 換算 CSS | 規格值 | 一致 |
|---|---|---|---|---|
| 列高（DC267F 連續節點 205/241/278） | 36–37 | 22 | 22 | ✅ |
| 車道水平間距（x=55/73.5/92/110.5/128.5） | 18.5 | 11 | 11 | ✅ |
| 節點直徑（普通節點色塊 w/h） | 13–16 | 8–10 | r=5（直徑10，含2px stroke 露出~8） | ✅ |
| 節點中心色採樣 | FFB000→(255,176,8)、DC267F→(219,38,127)、994F00→(155,80,0)、40B0A6→(64,174,169)、B66DFF→(179,111,246) | — | Fkf 五色 | ✅ 精確吻合 |
| badge 高度 | 30 | 18 | line-height 18 | ✅ |
| badge 圓角 | 膠囊狀（兩端半圓，高18 半徑9） | — | border-radius 10 | ✅（近似） |
| badge 色（亮色渲染值） | 藍 `#267AC2`、紫 `#7665CC` | — | charts.blue/purple（亮色 `#1a85ff`/`#652D90`） | ⚠️ 見下 |

> ⚠️ badge 色差異：截圖中 badge 實測為藍 `#267AC2`、紫 `#7665CC`，比規格預設值（亮色 `#1a85ff` / `#652D90`，暗色 `#3794FF` / `#B180D7`）更「灰」。這不是反編譯錯誤——`Fkf` 車道色在截圖中**精確吻合**，唯獨 badge 色偏移，最可能是**當前 Cursor 主題覆寫了 `charts.blue`/`charts.purple` 或 `editorInfo.foreground`**（`Ht` 的預設值可被主題覆寫），並非 alpha 混色（對白/灰底反算 alpha 不自洽）。規格以 bundle 預設值為準，標注「主題可覆寫」。

### 6.2 project-current.webp（806×1428，暗色主題，圖形在**右**）

| 量測項 | 裝置 px | 備註 |
|---|---|---|
| 圖形位置 | x ∈ [674, 752]（右軌寬 ~78） | 本專案圖形在**右**側，Cursor 在左 |
| 車道水平間距 | 26 | 車道線 x≈680/706/732；↔ 本專案 `GRAPH_LANE_WIDTH=13`×2=26（2× DPR） |
| 車道/節點色採樣 | 40B0A6（teal）、994F00（棕）、FFB000（黃）、3794FF（藍） | 前三個是 Cursor `Fkf` 子集；3794FF 是 Cursor head 藍（暗色） |
| 主題背景 | (20,19,22) | 暗色 |

> ⚠️ 截圖與現有程式碼不一致（見 §9）：截圖顯示「右軌 + Cursor 色票 + 藍 head」，但 `src/client/16-graph.js` 現狀是「左軌（註解）+ 自有 8 色 + `GRAPH_LANE_WIDTH=13`」。推測截圖是**較早版本**（已用 Cursor 色票、但軌道仍在右），而程式碼正處於另一次重構中。列高在截圖中因車道線連續、節點小而無法乾淨量得，故以程式碼為準。

---

## 7. 與本專案現況的差異清單

> 現況來源：`src/client/16-graph.js`（全檔）、`src/client/30-style.js`（L350–423）、`src/client/40-panel.js`（L594–778）。

### 7.1 常數與幾何

| 面向 | Cursor 規格 | 本專案現況（16-graph.js） | 應改成 |
|---|---|---|---|
| 列高 | **22**（`fxr`，CSS 亦 22） | `GRAPH_ROW_HEIGHT = 26`，但 CSS `.gmg-commit-row` 是 `height:22px`（**內部矛盾**） | 統一為 **22**，刪除 26 |
| 車道寬 | **11**（`q6`） | `GRAPH_LANE_WIDTH = 13` | 改 **11** |
| 內邊距 | 無（車道 x = 11*(i+1)，含自帶左 inset） | `GRAPH_PAD = 7` | 移除 `GRAPH_PAD`，用 Cursor 的 `11*(i+1)` |
| 寬度預算 | 無（寬 = 11*(max+1)） | `GRAPH_WIDTH_BUDGET = 104`、`max(6, min(13, 104/lanes))` 壓縮 | 移除預算壓縮，寬恆等 `11*(max(in,out,1)+1)` |
| 車道中心 y | 11（列高一半） | `cy = top + 26/2 = 13` | 改 11 |

### 7.2 車道顏色

| 面向 | Cursor | 本專案 | 應改成 |
|---|---|---|---|
| 色票 | 5 色 `Fkf` = [#FFB000,#DC267F,#994F00,#40B0A6,#B66DFF] | 8 色 `GRAPH_COLORS` = [#3b82f6,#22c55e,#f59e0b,#ef4444,#a855f7,#06b6d4,#ec4899,#84cc16] | 換成 5 色 `Fkf` |
| 取色規則 | **全域計數器**，新開 lane 才 `(s+1)%5`，與 lane index 無關 | `graphColor(lane) = GRAPH_COLORS[lane % 8]`（**依 lane index**） | 改成「新開才進位」的計數器 |
| 第一父沿用 | 沿用既有 lane 色，或 ref 色 | 第一父沿用 lane（但顏色仍 `lane % 8`） | 沿用**該 lane 已帶的顏色**，非重算 |

### 7.3 節點

| 面向 | Cursor | 本專案 | 應改成 |
|---|---|---|---|
| 型態 | 三型態：普通 r=5 / merge r=6+內r=3 / current r=7+內r=2 | 兩型態：`r = labelled ? 3.7 : 2.9`，無 current 特型 | 實作三型態（§4），且 current/merge 有內層圓 |
| stroke | `stroke-width=2`（`UQi`），色由 CSS `.graph>circle` 給背景色 | `.gmg-graph-node { stroke: var(--gmg-row-bg) }`，但圓實際用 `gmg-graph-dot` class + inline `stroke=graphColor`，**CSS 沒接上** | 對齊 Cursor：`stroke-width=2` + 背景色 stroke |
| current 內點 | `r=2, strokeWidth=4, fill=editor-background` | 無 | 新增 |

### 7.4 邊（edge）

| 面向 | Cursor | 本專案 | 應改成 |
|---|---|---|---|
| 幾何 | **圓弧 `A`**（r=11 併入、r=5 關閉）+ 直線 `V`/`H` | **三次貝茲 `C`**（bend=0.2/0.45） | 換成 §3 的 `A` 弧線語法 |
| 每列切片 | 每列一個 `<svg class="graph">`，只畫該列 | 單一 `<svg>` 畫全部列（`HistoryGraph({rows})`）——但 panel 註解說「已改每列切片」且呼叫 `HistoryGraph({row})`（**簽名不符**） | 拆成 `renderRowGraph(row)`，每列一 svg |

### 7.5 ref / badge

| 面向 | Cursor | 本專案 | 應改成 |
|---|---|---|---|
| ref 色語意 | head=藍、remote=紫、base=#EA5C00、tag=無（回退 swimlane 色） | head/branch=local、remote=remote、tag/detached=tag（主題 token） | 對齊 Cursor 語意（head 藍 / remote 紫 / base 橙） |
| badge 幾何 | `.label` border-radius 10、line-height 18、codicon 14、count 12 | `.gmg-ref` height 18、radius 10、font 11、`--gmg-head-ink` | 幾何接近；字級 icon 改 14（git-branch 12）、count 12 |
| 分組 | 第一個 ref 顯示名稱，其餘「同色+同 icon」一組、>1 顯示 count | 第一個顯示名稱，其餘**依 color** 分組（`refFamilyColor`）、>1 顯示 count | 加「同色內再依 icon 分組」一層 |

### 7.6 DOM 結構

| 面向 | Cursor | 本專案 | 應改成 |
|---|---|---|---|
| 圖形位置 | 列內**最左**（`.graph-container` → label → `.label-container`） | 40-panel.js 順序為 graph → subject → spacer → refs（**已左**），但截圖顯示右 | 確認以程式碼為準：graph 在左 |
| 節點 stroke 接線 | `.graph>circle` CSS | `.gmg-graph-node` 未接到圓（圓用 `gmg-graph-dot`） | 修正 class 或改用 inline |

---

## 8. 介面契約（給 graph-engine / panel-integrator）

### 8.1 常數

```js
const GRAPH_ROW_HEIGHT = 22   // fxr
const GRAPH_LANE_WIDTH = 11   // q6
const NODE_R = 4              // BQi（基準）；UQi = 2（stroke）、jMt = 5（轉彎）
const LANE_PALETTE = ['#FFB000','#DC267F','#994F00','#40B0A6','#B66DFF']  // Fkf
const REF_COLORS = {
  head:   { dark:'#3794FF', light:'#1a85ff' },  // charts.blue
  remote: { dark:'#B180D7', light:'#652D90' },  // charts.purple
  base:   '#EA5C00',
}
```

### 8.2 `layoutHistory(commits, options) → rows[]`

```js
// commits（newest first）：
//   { sha, parents: string[], refs?: {kind,name}[],
//     subject, author, date, references?: {kind,name}[] }
// options：
//   { currentSha?: string, refColor?: (ref) => string | undefined }
// 回傳 rows：
//   [{
//     commit,                    // 原 commit
//     isCurrent: boolean,
//     inputSwimlanes:  {id,color}[],   // = 上一列 output 的 clone
//     outputSwimlanes: {id,color}[],
//     references: {kind,name,color}[]  // 已排序、已著色
//   }]
//   每個 row 由 panel 決定 height = GRAPH_ROW_HEIGHT = 22
```

lane 顏色規則（§2.3）：
1. input = clone(prev.output)。
2. 第一父沿用既有 lane（色 = refColor ?? 原 lane 色）。
3. 額外父新開 lane（色 = parent refColor ?? `Fkf[(++counter) % 5]`，counter 只在新建時進位）。
4. reference 色 = 自帶色，否則取對應 swimlane 色，否則 `REF_COLORS.head`。

### 8.3 `graphRowWidth(row) → number`

```js
return GRAPH_LANE_WIDTH * (Math.max(
  row.inputSwimlanes.length,
  row.outputSwimlanes.length,
  1
) + 1)   // = 11*(max+1)
```

### 8.4 `HistoryGraph({ row }) → svg.gmg-graph`

- `<svg class="gmg-graph" width={graphRowWidth(row)} height={22}>`
- 每條 edge 用 §3 的 path 語法，`class="gmg-graph-edge"`、`stroke=該 lane 色`、`stroke-width=1`、`fill=none`、`stroke-linecap=round`。
- 節點用 `class="gmg-graph-node"`，三型態半徑/stroke/fill 見 §4。

### 8.5 class 命名（對齊專案既有）

| 角色 | class |
|---|---|
| svg | `gmg-graph` |
| path | `gmg-graph-edge` |
| circle | `gmg-graph-node`（普通/merge/current 皆用，靠 CSS 補背景 stroke） |

### 8.6 範例輸入/輸出

輸入（3 個 commit，含一個 merge）：

```js
const commits = [
  { sha:'a1', parents:['b1'], refs:[{kind:'head', name:'main'}] },
  { sha:'b1', parents:['c1','c2'] },                       // merge
  { sha:'c1', parents:['d1'] },
  { sha:'c2', parents:['d1'] },
  { sha:'d1', parents:[] },
]
layoutHistory(commits, { currentSha:'a1', refColor: r => r.kind==='head' ? '#3794FF' : undefined })
```

輸出（示意，lane 著色略）：

```
row a1 (current): input=[], output=[{id:'b1',color:C0}]
                  node = current（r7 + 內 r2 背景點）
row b1 (merge):   input=[{id:'b1',color:C0}], output=[{id:'c1',color:C0},{id:'c2',color:C1}]
                  node = merge（r6 + 內 r3）
row c1:           input=[{id:'c1',C0},{id:'c2',C1}], output=[{id:'d1',C0},{id:'c2',C1}]
row c2:           input=[{id:'d1',C0},{id:'c2',C1}], output=[{id:'d1',C0},{id:'d1',C1}]  ← 兩 lane 併到 d1
row d1:           input=[{id:'d1',C0},{id:'d1',C1}], output=[]
                  node = 普通（r5）
```

---

## 9. 與 Lead 簡報不一致處（供 Lead 覆核）

1. **base ref 的 icon**：簡報寫「base→**target** #EA5C00」，反編譯 git-ext 實測 base（merge-base）icon = **`cloud`**（它是 remote 的 merge-base）；`target` 只用在 **HEAD**。顏色 #EA5C00 正確。
2. **ref 排序優先級**：`VNb` 定義了 head/remote/base 三級優先級，但實際呼叫 `JNb(commits, colorMap, headRef)` 只傳了 headRef，remote/base 不參與優先級排序，只靠「有無色」分先後。
3. **截圖 vs 程式碼**：`project-current.webp`（暗色、右軌、Cursor 色票子集 + 藍 head）與現有 `16-graph.js`（左軌、8 色、`GRAPH_LANE_WIDTH=13`、`GRAPH_ROW_HEIGHT=26`）不一致，疑似截圖為較早版本或另一分支；且 16-graph.js 內部已有 `GRAPH_ROW_HEIGHT=26` 與 CSS `height:22px` 矛盾、`HistoryGraph({rows})` 與 panel 呼叫 `HistoryGraph({row})` 簽名不符、`.gmg-graph-node` CSS 未接到圓（圓用 `gmg-graph-dot`）。這些「現況本身未對齊」需 Lead 先確認基線版本。
4. **badge 色**：截圖中 badge 藍/紫比預設值偏灰（`#267AC2`/`#7665CC`），推測為主題覆寫 `charts.blue`/`charts.purple`（`Ht` 註冊色可被主題覆寫）；車道 `Fkf` 五色在截圖中精確吻合，不受影響。

---

## 附錄：反編譯片段索引（供覆核）

| 片段 | 字元偏移（bundle） |
|---|---|
| `fxr=22,q6=11,jMt=5,BQi=4,UQi=2` | 23260976–23261001 |
| `Y0a/GNb/zNb`（ref 色註冊） | 23261080–23261150 |
| `Fkf`（5 色票） | 23261688 起 |
| `mxr`（path helper） | 23262053 |
| `HQi`（circle helper） | 23262330 |
| `gxr`（垂直線 helper） | 23262536 |
| `YNb`（lane index 搜尋） | 23262623 |
| `XNb`（renderHistoryItemGraph） | 23262704–23264410 |
| `JNb`（toHistoryItemViewModel / layout） | 23264606–23266300 |
| `VNb`（ref 排序） | 23260800 |
| `_getGraphColorMap` | 33527831 |
| `Bui` renderer / `_renderBadges` / `_renderBadge` | 33516000–33519500 |
| css `.history-item` 規則 | css @898702–901000 |
| git-ext `toSourceControlHistoryItemRef`（icon） | git-ext @173872 |
