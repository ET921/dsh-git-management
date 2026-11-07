# Git/GitHub 正確性與邊界評審（gitexpert）

範圍：`src/git.js`、`src/actions.js`（github 段）、`src/index.js`（exec 縫）、`src/client/{10-store,15-diff}.js`。
所有「會壞」斷言除標【需驗證】外，皆已在暫存 repo 用 git 2.53 實測。

## 一、最嚴重：pathspec 萬用字元污染（P0）

`git.js` 的 `stage/unstage/discard/removeUntracked`、`isTracked`、`diff` 都以 `-- <path>` 裸路徑傳參。git 把 `--` 後的字串仍視為 pathspec，`[`、`?`、`*` 會做 glob 展開（`[` 與 `*` 在 Windows 檔名雖受部分限制、`[` 完全合法，POSIX 上三者皆常見）。

- **實測**：repo 同時有 `bracket.txt` 與 `b[br]acket.txt` 時，`git add -- 'b[br]acket.txt'` 把**兩個檔案都 staged**；`q[1].md`（_literal 檔存在）靠 git 的「literal 也比對」剛好正確，但這不可依賴——glob 展開撞到別的檔案時就是指令錯。
- 觸發路徑：面板任何單檔 stage／discard／deleteUntracked；`stageAll` 是一整批路徑塞進同一個 `git add -A`→ 不過 `-A` 無 pathspec；但逐檔操作與 `unstageAll`/`stageAll`（把 changes 列的路徑逐一傳）每一步都受影響。`isTracked` 用 `ls-files --error-unmatch -- file` → glob 不中 → 誤判 tracked=false，接著對含括號的新檔走 `--no-index` 分支（尚無資料損害，但行為錯）。
- **修法**：所有以路徑為參數的位置改傳 `:(literal)${path}`（實測 `git add -- ':(literal)b[br]acket.txt'` 只動 literal 檔）。逐字串包裝即可，追蹤端 `diff`、`worktree add/remove` 的 path 參數同樣受用。

## 二、逐命令稽核

### probe / rev-parse
- `git.js:83` 三旗標併用：bare repo 上 `--show-toplevel` 直接送 `fatal`，整個指令 exit 128（實測），`probe` 回 isRepo:false → bare repo 在面板完全看不到（分支列、history、worktrees 全消失；選單還會提供「初始化倉庫」）。**修法**：`--is-inside-work-tree` 單獨跑（bare 回 false），bare/`.git` 目錄下改以 `--absolute-git-dir` 判定，UI 顯示 `bare（唯讀）` 並擋寫操作。P1。

### status（porcelain v2 -z）
- 解析正確性過關：`1`/`2`/`u`/`?` 欄位數守衛、rename 的第二段 NUL 記錄都對；路徑含空白、tab、`-z` 保真無毒化（`-z` 下不做 quotepath 轉義）。UTF-8 路徑若破，不在解析而在 harness 的 stdout 解碼【需驗證】。
- 衝突（unmerged）時 `diff --numstat -z --no-renames` 對同一路徑吐**兩筆**記錄（實測 `0\t0` 與 `4\t0`），`parseNumstat` 的 Map 後者蓋前者；目前 conflicts 不查 numstat（0/0 顯示）故無害，但若未來把 counts 接進衝突列就會錯。P2 註記。

### diff
- 退出碼 `allowExit:[0,1]` 正確；`--no-index -- /dev/null file` 在 Windows Git 實測可用（git 內建映射 /dev/null），無 NUL 的二進位會被 git 當文字（`-/-` 誤判風險存在但 heuristic 本身如此）；整行 `/^GIT binary patch$/m` 的修正本身是對的。
- **衝突檔 diff 沒處理 `--cc`**（P1）：unmerged 路徑的 `git diff -- path`（實測）改吐 combined 格式：`diff --cc a.txt` + `@@@ -1,1 -1,1 +1,5 @@@`。`15-diff.js:parsePatch` 的 meta 清單不認 `diff --cc` → 字首 `d` 走 context 分支，面板把「iff --cc a.txt」渲染成內文；`@@@` 不匹配行號 regex → 計數器不重置，後續行號錯亂。觸發：衝突群組可點（`45-diff-panel.js:140`、`40-panel.js:918`）。**修法**：搜 `/^diff --(cc|combined) \S/` 時改回 `{ note: 'unmerged' }`（或 `isBinary` 同款降級）。
- `--unified=999999` 的 full 模式：>6MB 輸出會被 `MAX_OUTPUT_BYTES` 截斷，尾巴 hunk 殘缺但解析不炸（meta/guard 兜底）——可接受，建議 note 提示截斷。P2。

### numstat / commitDetail
- `commitDetail` 的 `show --numstat` 無 `-z`：(a) merge commit 預設沒有 diff 輸出 → hover 恆為 0 檔 0 行（git 不報錯，code 0）。**修法**：merge（看 `%P` 雙父）時改執行 `show --numstat -m/--first-parent` 或標示 merge。(b) 非 ASCII 檔名被 quotepath C-轉義，只有計數、無識別需求，P2。P2。

### log
- `--all --topo-order` 在現代 git 有 commit-graph 世代加速，但 repo 缺 commit-graph 且 >10 萬 commit 時 topo-order 會走整張圖【需驗證】，面板 8 秒輪詢不做這件事（值得確認）。
- `%D` 以 `', '` 切分：tag 名含 ", "（refname 規則允許）會破徽章列表。P2。
- format 以 `%x1f/%x1e` 分隔是穩的；subject 含自由文字也不撞 `\x1f`。

### branches / branchDetail（`|` 分隔）
- 註解聲稱「git 禁止 branch 名含 `|`」——只有 Windows 的 loose-ref 檔案層面成立（實測無法建立）；**Linux/macOS 上 `a|b` 是合法分支**，屆時欄位就位錯亂。修法可改用 `%(refname:short)` 配 `-z`？`for-each-ref` 沒有 `-z`；實務上給 `!` 或 `%x00`→ 改 format 以 `%(if)%(upstream:short)…` 不夠——最低成本：偵測欄數 >5 時丟錯／改用 `git branch --format`（其實同源）。P2 但值得把註解谎言改掉。

### stage/unstage/discard
- `unstage` 對 unborn HEAD 分流 `rm --cached` 正確；**但 rename 列只 `restore --staged -- newPath`**：staged rename（X= Shr R）unstage 後舊路徑的刪除仍留 index，呈半截 rename。修法：rename 列把 `origPath` 一併傳入。P2。
- `discard` 對衝突列被 UI 禁用、untracked 走 `clean -f` 且有確認——決策正確。`clean -f -- <paths>` 同受 pathspec 污染（見 P0）。

### commit
- sha 提取 regex `\[[^\]]*?([0-9a-f]{7,40})\]` 只對 commit 摘要行、first `]` 之前解析，分支或訊息含 7+ hex 會偶爾取錯／取空（只影響 notice 顯示）。P2。

### worktree
- `dirtyCount` 用 v1 porcelain `-z`：rename 佔兩段 NUL 記錄 → 徽章多計 1。P2。
- `normalizePath` 無條件 lowercase：Linux 上 `Fix`/`fix` 兩個真實 worktree 會互撞（誤標「主」或擋錯移除）。加 `process.platform === 'win32'` 條件再 fold。P2。
- 決策層（上限 8×並行 4、reject main worktree、不用 `--force`）都對。

## 三、狀態機稽核

| 狀態 | 實情 |
| --- | --- |
| detached HEAD | `branch:null`；history/branches 正常；**push 會帶出 `push --set-upstream origin null`**（`actions.js:310` 分支為 rail，refspec 非法錯誤難讀）。修法：push 前先擋 detached。P1。 |
| bare repo | 見上，整體誤判 isRepo:false。P1。 |
| 空 repo | `log` 回 []（exit≠0）、`diff --cached` 在 unborn HEAD 下 git 自動對空 tree（實測可用）、unstage 的 `rm --cached` 分流正確——這條鏈處理得完整。 |
| 衝突中 | 衝突列正常分組；diff 壞（P1 見上）；**此時 `commit` 會直接 commit 合併**（`-m` 對妝 merge 狀態成功建立 merge commit），面板沒有「還有衝突未解」的擋除——建議 conflicts 非空時擋 commit。P1。 |
| 進行中 rebase/cherry-pick | git 自身在 status/log 正常；`discard`/`switch` 會撞上 git 的提示訊息並顯示原文——可接受的降級；若要加分可讀 `.git/rebase-merge` 顯示「（進行中）」。P2。 |
| submodule | porcelain v2 只給 gitlink 的 XY；numstat 對 gitlink 給 `- -`→ 0/0；點開 diff 會拿到 `Subproject commit` 行被當 +/- 渲染——難看但無害。P2。 |
| sparse-checkout | skip-worktree 檔不出現在 status；`restore --worktree` 對 skip-worktree 檔會「成功但無作用」——誤導很小。P2。 |

## 四、GitHub 稽核

- **email→login 的準確性**：`own` 路徑用 `/user`：commit 作者信箱若是公司信（不在 GitHub 帳號上），歸屬會掛到「授權者帳號」——這是文件明定的語意，可接受但要 keep。`/search/commits` 路徑：同信箱被多帳號使用→可能搜錯人；**`id+login@users.noreply.github.com` 直接 parse 出 login 就夠**，少一次 search 呼叫（P2，兼順頻率）。
- **失敗的去退**：search 沒中不快取（每次 hover 重試；search 限每分鐘 30 次、每 12 秒窗可能吃 403）。7×40 commit 列全 hover 的 worst case 過得去，但 403/401 沒有降級訊號都以 raw message 塞進 error 列；建議 403 標「權限不足」、429 標「rate limit」。P2。
- **GHES**：`apiBase()` 只吃 `GITHUB_API_URL` env；webUrl 卻用 remote host 推出——結果：GHES remote + 未設 env 時 API 撞 github.com 得 404 "Not Found"。**修法**：remote.host 非 github.com 且無 env 時 fallback `https://<host>/api/v3`。P1（GHES 場景一碰就破）。
- 分頁：pulls/issues 只取第一頁 20 筆無截斷提示；merge/createPull 的 base fallback 硬寫 `'main'`（GitHub 回 422 原文）。P2。
- token 走請求 body／localStorage、路由有同源拒絕＋gate——傳輸面設計正確。

## 五、效能稽核

- **8 秒輪詢每輪 6 個 git 程序**（probe＋status＋2×numstat＋log＋branches）；`-uall` 是大 repo 主要成本且無快取。低成本修法：(1) probe 結果快取到 repo 切換為止（rev-parse 幾乎不變）；(2) porcelain 列表非空才跑兩個 numstat；(3) `git -c core.untrackedCache=true status ...`。（fsmonitor 需要設定才算數，不急）P1。
- `worktrees` 的 dirty 上限 8/並行 4，`-o` 豋峰掃描避開未追蹤——實測提到的 20ms 級別成立，節流層面不需動。
- `branches()`/`log()` 已有 `-n` 上限 200 與 20s timeout，輪詢限制在內。

## 六、最值得修的三件事

1. **P0：全部路徑參數加 `:(literal)`**——一個字串包裝改掉 stage/unstage/discard/clean/isTracked/diff 六個入口的錯誤匹配；任何含 `[` 的檔名都能誤命令到別的檔案，資料影響不等。
2. **P1：衝突 diff 的 `--cc` 降級**——衝突是面板三大群組之一，目前點開是錯字＋錯行號的殘骸；一行偵測即可退到 note。
3. **P1：bare repo 判定**——probe 拆開 rev-parse，別讓 20 年老旗標 `--show-toplevel` 拖累整個判斷；目前整個面板 surface 對 bare 是「不存在」。

## 七、做得對、不要動

- **argv 陣列、無 shell**：所有命令走 array + exec 縫，注入面已縮到最小——設計核心，保持。
- **退出碼語意**：diff 取 1 為「有差異」、`--no-index` 同樣允許 1、`ls-files --error-unmatch` 的非零即未追蹤——全部依 git 約定而非 stderr 謠測。
- **unborn HEAD 的 unstage 分流**與 `diff --cached` 對空 tree 的依賴：實測都是正路。
- **二進位整行 regex 修正**（host 與 client 相同）與 `-z` porcelain v2 解析的欄位數守衛——近期修正都到位。
- **無人值守 env 套組**（`GIT_TERMINAL_PROMPT=0`／`GIT_PAGER`／`GIT_EDITOR`／`GIT_ASKPASS`／`GIT_OPTIONAL_LOCKS=0`）與 `pull --ff-only`、不用 `--force` 的 worktree 移除——都是同類「正確而不炫技」的決策。
- **numstat 一律 `--no-renames`**：避開 rename 的路徑配對歧義，讓 Map lookup 以路徑為鍵即可——深刻的前提假設，別拆。

（驗證用暫存 repo 已刪除；本倉庫未動。）

## 交叉評審回應（第二輪）

### 一、同意並借用
- **同意 engineer 發現 1＋2（`Origin: null` 放行＋path 不限工作區）**：這就是「邊界」問題，本該在我的雷達上。Content-Type 白名單與 workspace 路徑白名單都收進我的清單；補一句：path 守衛用已註冊 repo root 做 `rev-parse --show-toplevel` 比對即可，不必另造機制。
- **同意 engineer 發現 7（hunk 內容行 `--- `／`+++ ` 誤判）**：我審了 `parsePatch` 的 `diff --cc` 卻漏了 `seenHunk` 狀態機——同一個函式、同一批觸發（衝突＋YAML/SQL 註解），應一次修完。
- **同意 engineer 發現 8 的實測**：`for-each-ref --format` 吃 `%00`（我第一輪只敢寫「`!` 或 `%x00`」的存疑版）；分隔符方案就此定案，兩份共同背書。
- **同意 product G2＋G3／poweruser F7（衝突可 stage、merge/rebase 狀態列）**：git 層面無風險（解完 `git add` 本是正路）；但一旦提供「標記解決」，我 P1 的「衝突未清時擋 commit」從建議升級為必要，否則面板多出一條「沒解完也照樣 commit 成 merge」的捷徑。
- **同意 poweruser F4（amend 預覽＋stageAll 重設）**：stageAll 跨提交存留＋amend 靜默覆寫，在我眼中是資料正確性問題，能把新丟進資料夾的任意檔案帶進 commit——嚴重度應視同 P1。
- **同意 product G7（點提交看變更）**：資料已在 `commitDetail`；但需先修我指出的 merge commit numstat 空輸出，否則 merge 提交點開是 0 檔 0 行空卡。

### 二、不同意
- **反對 poweruser F3-①（樂觀更新）作為第一刀**：git 無事務性，樂觀搬列碰上 `index.lock` 或輪詢 race 還要寫對帳邏輯；F3-②③（檔案動作只重讀 status＋單一 in-flight token＋鎖對的一組按鈕）已消掉大部分痛點，樂觀更新留作二階段。
- **對 product G5（移除工作樹一併刪分支）有條件反對**：`--merged` 只對 HEAD，合併進其他分支時會誤判；我接受這功能，但只能走 `git branch -d`（永不 `--force`），未合併時只提示不刪——「刪錯 ref」的失敗模式不可逆。
- **design（hover 卡不加可點元素）撞 poweruser F9（卡上加外開連結／複製 sha）**：我站 poweruser——`webUrl` 與 sha 都在手，加唯讀連結不違反「不競爭原列點擊」；若 design 堅持卡面純淨，退到歷史列右鍵選單也行，但「複製 sha」不應省。

### 三、修正自己
- **撤回**：branch 分隔符我原本的折衷修法（欄數 >5 丟錯／沿用 `|` 加註解）作廢——engineer 的 `%00` 實測讓它變成兩行改動的具體方案。
- **降級**：我把「輪詢效能（probe 快取、porcelain 非空才跑 numstat、untrackedCache）」從 P1 降到 P2——poweruser F3-②③ 已消掉檔案動作路徑的大部分命令量，我的三招留給「純輪詢成本」作補充，不必重複拉高。
- **加強**：`:(literal)` P0 讀完 engineer 測試盲區後更嚴重——現有驗證完全不含特殊字元檔名，等於這條帶著綠燈在跑；且 product G2 要給衝突列加 `+`，P0 的修法必須趕在**任何**新增 pathspec 入口之前落地。
- **保留但收窄**：我對 `diff --no-index` 二進位誤判的保留態度不變；poweruser 的 F11 主張 compact 預設 hunks，與此無關，不改我的原判斷。

### 四、最終 Top 3（gitexpert 視角）
1. **全路徑參數包 `:(literal)`（我的 P0）**：唯一會把指令錯配到別的檔案的缺陷，修法是純字串包裝——成本最低、破壞半徑最大，任何入口變更前先落地。
2. **API 信任邊界（engineer 發現 1＋2）**：Content-Type 檢查＋workspace 白名單的疊加補丁，否則外部頁面可驅動 `git clean -f`；邊界職責不能只看 git 參數、不看 exec 的收口。
3. **衝突鏈一次補完（我的 `--cc` 降級＋未解決擋 commit＋product/poweruser 的衝突列可 stage）**：三件事命中同一群組，分開修會互相回歸（有 stage 按鈕就必須擋 commit、可點衝突就必須修 `--cc`）；一起修面板才從「看得到衝突」變成「走得完衝突」。
