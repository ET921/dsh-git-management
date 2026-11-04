# 設計：側邊欄的工作樹（worktree）可視化

狀態：草案 → 已實作（`feat/worktree-visualiser`）
範圍：Git 分頁新增一個「工作樹」區塊，列出這份 repo 的所有 worktree，並能以它為起點做事。

---

## 1. 為什麼要做

DSH 自己就會建 worktree：`ctx.worktrees`（`@deepseek-ai/dsh-experimental-worktree`）把新的 checkout 放在 `<repo>/.agents/worktrees/<name>`，分支叫 `worktree-<name>`，然後把 session 的 cwd 切過去。也就是說，一次委派之後，使用者的檔案散在幾個目錄裡，**而目前的面板只看得到其中一個**——它只知道 `state.path`。

所以這個功能的價值不是「多一個列表」，而是：讓 N 個 checkout 跟它們的分支、髒污狀態、路徑一起出現在同一個視野裡，並且能手動接手（切換／開成工作區／清掉）。

## 2. 資料從哪來

唯一來源是 Git 自己：

```
git worktree list --porcelain
```

一個 block 長這樣（空行分隔）：

```
worktree C:/repo
HEAD 8544e77...
branch refs/heads/main

worktree C:/repo/.agents/worktrees/fix-ui
HEAD 1a2b3c4...
branch refs/heads/worktree-fix-ui
```

`bare`、`detached`、`locked <reason>`、`prunable <reason>` 是額外標記。

**不用 `ctx.worktrees` 的理由**：那個服務是給 Agent 用的，簽名是 `create(agent, request)`——需要一個 Agent 才能建立，而且它只會「建立」，不會列出既有的。面板要的是唯讀視圖，還要能看到不是 DSH 建的 worktree（使用者自己 `git worktree add` 的那些）。所以：讀用 `git worktree list`，寫用 `git worktree add/remove/prune`，兩者都不經過 Agent。

## 3. 被 grill 的問題（與答案）

**Q：骯髒狀態怎麼算？每個 worktree 都跑一次 status，成本可接受嗎？**
A：走 `git -C <path> status --porcelain --untracked-files=no -z`，只數已追蹤的變更（不算 untracked——那是最貴的一段掃描）。上限 8 個 worktree、並行 4 個，超過的顯示 `—`。實測一個 5 萬檔的 repo，單次 `-uno` status 在 20ms 級別；真正貴的是 untracked。

**Q：會不會把使用者的目錄刪掉？**
A：`removeWorktree` 只接受「剛剛由 `git worktree list` 列出來的 path」，而且是主工作樹以外的。刪除前 UI 要確認（`window.confirm`）。不用 `--force`：髒的工作樹會失敗並把 git 的錯誤原樣顯示，這比默默丟掉未提交內容好。

**Q：主工作樹能被「切換」嗎？**
A：切換＝把面板的 `path` 指到那個 worktree，主工作樹當然也可以。但「移除」對主工作樹是禁用的（git 也會拒絕）。

**Q：建立時用什麼慣例？**
A：跟 DSH 的 `ctx.worktrees` 一致：目錄 `<repo>/.agents/worktrees/<name>`，分支 `worktree-<name>`，起點是目前 HEAD。好處是面板建出來的工作樹，Agent 之後用同一個工具也認得；反過來，Agent 建的也會出現在面板。名稱只允許 `[A-Za-z0-9._-]`，避免路徑逃逸。

**Q：`git worktree add` 在空 repo（沒有 commit）上會怎樣？**
A：會失敗（`fatal: invalid reference: HEAD`）。面板要把這個訊息原樣顯示，而不是假裝成功。

**Q：需要 realpath 比較嗎？**
A：需要。`git worktree list` 印出的路徑是 Git 的正規化結果（`C:/repo`），而面板的 `path` 可能來自 workspace registry 的 `C:\repo`。用 `path.replace(/\\/g,'/')` + 大小寫不敏感比較來判定「哪一個是當前」。

**Q：工作樹可以「開成 DSH 工作區」嗎？**
A：可以，走 `ctx.workspaces.create({ path })`（host 端對 canonical path 是 idempotent）再 `ctx.uiWorkspace.openWorkspace(id)`。這是把「看到」變成「用得到」的關鍵一步——否則使用者只能自己去加資料夾。

**Q：為什麼不放在左側邊欄？**
A：左側是 session 清單，右側才是「跟當前 session 有關的工具」（檔案、終端、瀏覽器）。工作樹是同一個 repo 的多個 checkout，屬於右側。

**Q：跟 `git status` 的 `# branch.ab` 有什麼關係？**
A：工作樹列自己的分支與 HEAD 短 sha；ahead/behind 只對「當前」那個顯示（面板上方分支列已經有了），列表不重複算，避免每個 worktree 再多兩次 rev-list。

**Q：`prunable` 是什麼？**
A：Git 發現「記錄還在、目錄已消失」的 worktree 時會標它。面板標一個灰字 `prunable`，並提供 `git worktree prune` 按鈕清掉這些記錄。

## 4. 介面

```
工作樹 (2)                                   ＋   ⟳
⎇ main              主      ● 3    C:\repo
⎇ worktree-fix-ui          clean  .agents/worktrees/fix-ui   [切換] [開啟] [移除]
```

- 標題列：數量、建立（＋）、重新讀取（⟳）
- 每一列：分支圖示＋分支名、`主` 或髒污計數、路徑（相對 repo 根優先）、hover 動作
- 建立表單：名稱輸入 → 顯示將會建立的 `分支 / 路徑` 預覽

## 5. 失敗模式

| 情況 | 行為 |
| --- | --- |
| 不在 git repo | 整個區塊不出現 |
| `worktree list` 失敗 | 顯示錯誤列，不影響其他區塊 |
| 某個 worktree 的 status 失敗（權限／已刪除） | 該列顯示 `—`，其餘照常 |
| 建立時目錄已存在 | Git 的錯誤原文顯示在 notice |
| 移除髒的工作樹 | 失敗並顯示 git 的 `contains modified or untracked files` |
| 移除當前 worktree | UI 禁用 |

## 6. 這個版本不做

- 不搬移／重新命名 worktree
- 不合併、不 rebase（那是另一個尺度的事）
- 不在面板裡開 PR from worktree（先用既有流程）
- 不做 `--force` 移除

## 7. 驗收

- `npm run verify`：`worktree add/list/remove/prune` 對真 repo 的斷言
- `npm run test:render`：區塊渲染、`主` 標記、骯髒計數、動作按鈕存在
- 手動：在面板建立一個工作樹 → 出現在列表 → 切換 → 移除
