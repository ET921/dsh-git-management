# 設計：提交差異分頁（history row → commit diff tab）

狀態：已實作（`worktree-commit-diff`）
範圍：歷史提交的每一列都可以點；點下去在右側邊欄**新開一個分頁**，把該提交的每個檔案竪著排，只畫變更。

---

## 1. 為什麼要做

歷史卡目前只回答「有哪些提交」，不回答「這次改了什麼」。要看內容，得離開面板去終端跑 `git show`。Cursor / VS Code 的 Source Control 是：**點一列 → 在編輯器開一個 diff 分頁**，多個檔案以分頁或分段呈現。

DSH 的右側邊欄有完整的 tab 系統，所以照同一個模型落地：清單留在原位，diff 自己是一個分頁，而且**每次點擊都是獨立分頁**（像 Cursor 開多個 diff），不是一直覆蓋同一個。

## 2. 資料從哪來

只用 git 自己，全部在既有 `/dsh-git/api` 的 `commitDiff` 動作後面：

```
git rev-parse --verify --quiet <sha>^{commit}          # 確認物件、拿完整 sha
git show -s --pretty=... <sha>                         # 作者、時間、訊息、父提交
git show --numstat -z --format= --find-renames --no-ext-diff [--diff-merges=first-parent] <sha>
git show --format= --patch --unified=3 --find-renames --no-ext-diff ... <sha> -- :(literal)<path>
```

- `--numstat -z` 一次拿到每個檔案的 `+N −N` 與改名配對（`0\t0\t\0old\0new\0`），檔名不會被引號包住、也不會被截斷。
- 每個檔案的 patch **單獨問一次**，用該檔自己的 literal pathspec。改名時同時給舊、新兩個路徑，git 才報得出 `rename from/to`；只給新路徑會被視為「新檔案、全部是新增」。
- 不用「跑一次大 patch 再按 `diff --git` 切」：檔名含空白時那行本來就有歧義，而 `--numstat` 的順序與大 patch 的段落順序沒有契約。多花幾十毫秒換取正確性。
- 上限 60 個檔案（並行 4 個 `git show`）。更大的提交是產生檔或 vendored 變更，側欄也讀不完；超過的部分仍會回報總數，UI 說明只畫了前 60 個。

## 3. 被 grill 的問題（與答案）

**Q：merge 要跟哪個父提交 diff？**
A：第一個父提交，和 hover 卡的 `--numstat` 統計同一口徑（`--diff-merges=first-parent`）。否則 merge 會顯示「兩邊各自改過的全部內容」。

**Q：要不要顯示全文？**
A：不要。使用者要的是「僅變更」。`--unified=3` 就是 git 的預設 hunk，前後各三行上下文；不提供全文切換，避免在側欄重讀一次檔案。

**Q：為什麼是 `multiple: true`？**
A：側欄的 tab 型別預設在同一格內去重（第二次開只會 re-navigate）。宣告 `multiple: true` 後每次 `openTab` 都拿到獨立的 occurrence 位址，於是兩個提交可以並排；代價是資料不能放在「唯一當前目標」的 store 裡，所以改成按 `repo#sha` 快取的 Map（見 `17-commit-diff.js`），LRU 保留 12 筆。

**Q：兩個分頁開同一個提交，會不會問兩次 git？**
A：不會。快取以 `repo#sha` 為鍵，兩個分頁共用同一筆；過期（被 LRU 丟掉）時分頁會自己重讀，不會留下空白。**開著的分頁會把它的 key「釘住」**，LRU 只淘汰沒人顯示的條目——否則第 13 個分頁一開，就會把第 1 個的資料擠掉，它再重讀又擠掉下一個，十三個分頁會互相重讀個不停。釘住的條目超過上限時就讓它超出，上限只約束關掉的分頁。

**Q：Escape 會不會把別的分頁一起關掉？**
A：單欄時只會有關鍵中分頁的 handler 存在。分欄（兩個 pane）同時顯示兩個分頁時，handler 會看 `tab.visible`，並在鍵盤焦點落在另一個 diff／提交面板時讓位，只關掉自己。

**Q：二進位檔、改名、刪除、空提交？**
A：二進位標一個「二進位」徽章（不畫假的行號）；改名顯示 `← 舊路徑`，狀態 `R`；刪除 `D`；空提交顯示「這次提交沒有檔案變更」。

**Q：sha 可以隨便傳嗎？**
A：host 只接受 4–64 位十六進位（頁面只會傳 `log` 裡讀到的完整 sha）。這同時擋掉以 `-` 開頭、會被 git 當成選項的值，也讓 `rev-parse` 之外的命令都拿到同一個完整 sha。

**Q：檔案標頭為什麽要吸頂？**
A：一個提交可能幾十個檔，捲到中間時最需要知道「現在是哪個檔」。每個檔案區塊的標頭 `position: sticky; top: 0`，區塊結束就自然讓位給下一個。

## 4. 介面

```
← 返回  deadbee  主旨…
Ada · 3 分鐘前                     2 個檔案  +3  −1   [收合全部]
────────────────────────────────────────────────
▾ M src/App.tsx                                  +3  −1
   @@ -1,4 +1,6 @@
    import x
   -old line
   +new line
▾ A assets/logo.png                     [二進位]
   二進位檔，不顯示差異。
```

- 分頁晶片：主旨（沒有主旨時顯示短 sha），hover 顯示 `sha · 主旨`。
- 檔案標頭：折疊箭頭、狀態字、檔名（目錄淡色）、改名來源、`+N −N`、二進位徽章。
- 收合是每個檔案自己的；標頭列另有「展開全部／收合全部」。
- `Esc` 關閉分頁（沿用檔案 diff 的習慣），返回鍵走 tab 自己的 `actions.close`。

## 5. 失敗模式

| 情況 | 行為 |
| --- | --- |
| 提交不存在／sha 不是十六進位 | 動作回錯，分頁顯示 git／驗證的訊息與「重試」 |
| 某個檔案的 patch 讀取失敗 | 整個動作失敗（不吞掉單檔錯誤），分頁可重試 |
| 提交沒有檔案變更 | 「這次提交沒有檔案變更。」 |
| 超過 60 個檔案 | 畫前 60 個，底部說明「共 N 個檔案，這裡只載入前 60 個的差異」 |
| 二進位檔 | 標「二進位」，不畫行號 |
| 只改檔案權限（mode） | 「只改了檔案權限（mode），內容沒有變。」 |

## 6. 這個版本不做

- 不做行內字元級 diff（Cursor 的 word-level highlight）
- 不做「上一個／下一個檔案」的鍵盤巡覽（用捲動與折疊即可）
- 不支援在提交分頁上直接 revert / cherry-pick
- 不做全文模式切換（見上）

## 7. 驗收

- `npm run verify`：root commit、單行修改只有一個 hunk、改名（舊路徑＋`rename from`）、改名後又改內容、刪除、二進位、只改 mode、merge 的第一父提交、空提交、超過 60 檔的上限、非十六進位 sha 被拒。
- `npm run test:render`：歷史列是 `role=button`；點擊開啟 `git-commit` 分頁並帶 `{ path, sha, short, subject }`；分頁請 host 讀 `commitDiff`；檔案竪著畫、加入／刪除行上色、檔頭雜訊不重畫、改名來源、二進位說明、截斷說明；單檔折疊、全部展開／收合、`Esc` 關閉、隱藏分頁不理會 `Esc`；兩個分頁開同一提交只讀一次；晶片顯示主旨。
- 手動：在面板點一列 → 新分頁出現 → 再點另一列 → 兩個分頁並存 → 切換不重讀。
