# GitHub token 持久化回歸報告

- 版本：`dsh-git-management` 0.1.1（工作區 `dsh-git-management`）
- 日期：2026-11-09
- 範圍：GitHub PAT 由「本次分頁記憶體」改為「Host 端 DSH 憑證存放區」的變更回歸（plan-v2 S24 / K1）
- 執行者：parity-qa（T8）
- 結論：**通過**。四條指令全綠，新增 21 項斷言（verify 13、render-test 淨 +8），未發現 `src/**` 缺陷。

---

## 1. 變更摘要

### 1.1 Host 半（`src/actions.js`、`src/index.js`）

| 變更 | 位置 | 說明 |
| --- | --- | --- |
| `createActions` 新增 `credentials` 依賴 | `src/actions.js:233` | 簽名改為 `createActions({ git, workspaces, credentials = () => undefined })`；傳入的是 **getter**，不是服務本身，因為 `credentials` 服務可能在插件掛載之後才掛上。 |
| `saveToken` 動作 | `src/actions.js:554-567` | `params.token` 去頭尾空白後寫入 `store.set('GITHUB_TOKEN', token)`；空字串／純空白 → `invalid-argument`（400）；超過 1000 字元 → `invalid-argument`；沒有憑證服務（或沒有 `set`）→ `credential-unavailable`（501）。回 `{ saved: true }`。 |
| `clearToken` 動作 | `src/actions.js:568-575` | `store.unset('GITHUB_TOKEN')`，回 `{ cleared: true }`；沒有服務時回 `{ cleared: false }`（不拋錯，讓舊 Host 的 UI 仍可收尾）。 |
| `resolveToken(supplied)` | `src/actions.js:687-706` | 每次 `github` 動作重算，**不快取**：`params.token` → 憑證存放區（`GITHUB_TOKEN`、`GH_TOKEN`）→ `process.env`（同名兩個）→ `null`。憑證服務拋錯時吞掉並落到 env。 |
| `githubAction` 改為 `await resolveToken(...)` | `src/actions.js:714-729` | 先判定 remote 是否為可收 token 的 GitHub 目標（`githubTarget`），再解析 token；`null` → `{ connected: true, authorized: false, reason: 'no-token' }`，不發任何請求。 |
| 路由接上 `ctx.get('credentials')` | `src/index.js:418-427` | `credentials: () => { const service = ctx.get('credentials'); return service && typeof service === 'object' ? service : undefined }` — 惰性讀取，服務晚掛載也能被下一次請求看到。 |
| 請求參數 | `src/index.js:470-473` | 仍接受 body 頂層或 `params` 的 `token`（向後相容／per-request 覆寫），但 client 已不再送。 |

`GITHUB_TOKEN` 這個 ref 名同時是環境變數名（`CredentialRef` 就是環境變數名），所以存放區寫入的名稱和 `git` 自己讀的名稱是同一個，不需要改名或同步兩份。

### 1.2 Client 半（`src/client/**`）

| 變更 | 位置 | 說明 |
| --- | --- | --- |
| 不再持久化 token | `src/client/00-util.js:48-94` | `TOKEN_STORAGE_KEY` 只剩遷移用途：bundle 載入時 `localStorage.removeItem` 清掉舊版殘留；`callHost` 的註解與行為都表明請求不帶憑證。 |
| `saveToken` / `clearToken` | `src/client/10-store.js:667-705` | 經 `callHost('saveToken', { token })`、`callHost('clearToken', {})` 走 Host；成功後 `set({ editingToken: false, github: null })` 並重讀 `github` 卡。空字串的「儲存」等於忘記（`clearToken`）。 |
| token 表單與忘記按鈕 | `src/client/40-panel.js:1964-2029` | `authorized: false` 且 `reason: 'no-token'` 時顯示密碼輸入框＋「保存」；`authorized: true` 時顯示 `aria-label="忘记令牌"` 的 forget 按鈕，按下即 `clearToken`（真正刪除，而不是清空欄位）。 |
| 文案 | `src/client/50-plugin.js:125-132, 317-324` | `tokenHint` 三語改為「存於本機 DSH 憑證存放區、重載/重啟仍有效、可隨時忘記」，不再有「僅本次 session 記憶體」字樣。 |

---

## 2. 檢查項與結果

### 2.1 四條指令

| # | 指令 | 結果 | 計數 |
| --- | --- | --- | --- |
| 1 | `node scripts/build.mjs` | 通過 | 產出 `lib/index.js`、`lib/actions.js`、`lib/git.js`、`lib/client.js`（id `dsh-git-management`） |
| 2 | `node scripts/verify.mjs` | 通過（exit 0） | **226/226** checks（基線 213 → 新增 13） |
| 3 | `node scripts/render-test.mjs` | 通過（exit 0） | **316/316** checks（基線 308 → 淨 +8；該卡斷言由 4 項擴為 12 項） |
| 4 | `node scripts/qa/graph-parity.mjs` | 通過（exit 0） | **35/35** parity checks（fixture 13 rows、3 merges、lanes 4、7 條跨道弧、1 個 elbow） |

基線分類：改動前 `verify` 已是 213/213 全綠；`render-test` 只有 1 項失敗——`saving sends the token to the github action`，原因是測試仍在期待 client 把 token 掛在 `github` 請求上（測試期望過期，不是 `src` 缺陷）。該項已由 S4 的卡片斷言整組取代。

### 2.2 verify.mjs 新增的 Host 斷言（13 項）

新增 `# GitHub token persistence (host credential store)` 區段：自建一個帶 GitHub remote 的暫存 repo，配上會記錄呼叫的 fake credentials store（`{ resolve, set, unset }`）。

| # | 斷言 | 驗證的行為 |
| --- | --- | --- |
| 1 | `saveToken` 回 `{ saved: true }` | 動作回傳形狀 |
| 2 | store 收到 `('GITHUB_TOKEN', 'ghp_x')` | 去頭尾空白、寫入的名稱 |
| 3 | 純空白 token → `code: invalid-argument` | 空值被拒 |
| 4 | 純空白 token 不寫入 store | 拒絕發生在寫入之前 |
| 5 | `clearToken` 回 `{ cleared: true }` | 動作回傳形狀 |
| 6 | `clearToken` 呼叫 `unset('GITHUB_TOKEN')` | 真的刪除，不是清空欄位 |
| 7 | 無 credentials 時 `saveToken` → `credential-unavailable` + status 501 | Host 沒有存放區時明確失敗 |
| 8 | `github` 動作在 store 有值時 `authorized: true` | Host 端解析成功 |
| 9 | 請求沒帶 token 時 `Authorization: Bearer stored-token` | fetch stub 檢查實際標頭 |
| 10 | 連續兩次 `github` 各讀 store 一次 | resolve 每次重讀、不快取 |
| 11 | `params.token: 'request-token'` 時標頭用 `request-token` | 請求自帶的 token 優先 |
| 12 | 同時有 env `GITHUB_TOKEN` 時仍用 store 的值 | store 優先於 env |
| 13 | 沒有 store 時用 env `GITHUB_TOKEN` | env 是最後備援 |

### 2.3 render-test.mjs 的假宿主與卡片斷言（12 項）

假宿主 `respond()` 新增 `saveToken`（記錄 `params.token`、把 `githubAuthorized` 設為 true）與 `clearToken`（記錄次數、設回 false）兩個 case，讓「儲存 → 重讀已授權 → 忘記 → 回到未授權」是一條由 Host 狀態驅動的真實迴圈。

| # | 斷言 | 驗證的行為 |
| --- | --- | --- |
| 1 | 未授權卡開啟 token 欄位 | `authorized: false` + `reason: 'no-token'` 顯示密碼輸入 |
| 2 | `tokenHint` 不再承諾「僅記憶體」 | 文案已改 |
| 3 | `tokenHint` 指名 DSH 憑證存放區 | 文案與安全模型一致 |
| 4 | 按「保存」送出 `saveToken`，`params.token` 正確 | 儲存走 Host 動作 |
| 5 | 假宿主收到同一個 token | Host 端確實拿到值 |
| 6 | 任何請求都不帶頂層 `token` | client 不再把 token 掛在 wire 上 |
| 7 | token 不進 `localStorage` | 瀏覽器端不落盤 |
| 8 | Host 接受後 token 表單消失 | 成功後 UI 換面 |
| 9 | 已授權卡有 forget 按鈕（`aria-label="忘记令牌"`） | 有清除入口 |
| 10 | 按 forget 呼叫 `clearToken` | 清除走 Host 動作 |
| 11 | 假宿主記錄到一次 clear | 刪除真的發生 |
| 12 | 清除後卡片回到 token 欄位 | 狀態機閉環 |

既有 308 項其餘斷言全數保留、無退化（含載入時清掉 legacy `localStorage` key 那一項）。

---

## 3. 安全模型

1. **存放位置**：Host 的 DSH 憑證存放區，與模型 API key 同一個受保護的 store，以 ref `GITHUB_TOKEN` 存放。這個 store 由 Host 的 `credentials` 服務擁有，檔案權限為 `0600`（服務自身以 `chmod 600` 收緊）；本插件只透過 `set/resolve/unset` 介面操作，**不直接讀寫該檔案**，也不自行決定路徑。
2. **不落瀏覽器**：client 不再寫 `localStorage`（也不再寫 `desktop-storage`）；舊版留下的 `dsh-git-management/github-token` key 會在 bundle 載入時刪除，並有斷言守住。token 只以 React state 形式存在於輸入框草稿中，存檔成功即清空。
3. **不進請求／回應／日誌**：client 的每個 `callHost` 只送 `{ action, params }`，沒有任何頂層 token（斷言 #6）；`github` 動作的回傳是 repo/pull/issue 事實，不含 token；Host 的掛載日誌只列動作名稱；錯誤封裝 `detailsForError` 只帶 argv/exitCode/stderr 這類機器可讀欄位，不含 token。
4. **只送往 GitHub 目標**：`githubTarget(remote)` 在任何 fetch 之前判定目的地。沒有 `GITHUB_API_URL` 時只有 `github.com`／`www.github.com` 能收到 token；設定時 API base 的 host 必須與 remote 一致，HTTP(S) remote 還要比對 port。其他 host（GitLab、Gitea、公司內網、攻擊者網域）一律回 `unsupported-host` 且**零請求**（既有斷言續綠）。
5. **每次重讀**：`resolveToken` 每個 `github` 動作都問一次存放區，不快取；因此改動憑證後的下一個請求立即生效，不需要重啟 Host。
6. **優先序**：請求自帶 `params.token`（per-request 覆寫）→ 憑證存放區（`GITHUB_TOKEN` → `GH_TOKEN`）→ 環境變數（`GITHUB_TOKEN` → `GH_TOKEN`，相容 CI／終端機既有設定）→ `null`（卡片顯示「需要 token」）。存放區贏過 env，因此面板存的 token 不會被 shell 裡的舊值蓋掉。

---

## 4. 未驗證項（需使用者實機確認）

1. **真實 GitHub API**：所有 GitHub 呼叫都在 `global.fetch` stub 下跑，未對 `api.github.com` 發過一次真請求。實際 scope 是否足夠（classic `repo`；fine-grained 的 Contents / Pull requests 讀寫）需以真 token 驗證。
2. **重啟後的持久化**：斷言用的是 in-memory fake store；「存檔 → 重啟 DSH → 卡片仍授權」這條端到端流程需要在實機上跑一次，並確認憑證檔確實是 `0600`。
3. **`0600` 與檔案位置**：由 Host 的 `credentials` 服務決定，本回歸只驗證插件沒有繞過它；不同平台（Windows 無 POSIX mode）需另確認。
4. **`GITHUB_API_URL` 的 GHES 實例**：host/port 比對有既有斷言，但未對真實 GHES 端點驗證。
5. **併發**：同時按「保存」與「忘記」、或在 `task` 鎖定期間重複點擊，只有 UI 的 `busy` 防護，未做壓測。
6. **401/403 的卡片回饋**：token 失效時的錯誤面（`reason: 'error'` + retry）沿用既有行為，未新增斷言。

---

## 5. 重跑指令

```bash
# 由 repo 根目錄
node scripts/build.mjs \
  && node scripts/verify.mjs \
  && node scripts/render-test.mjs \
  && node scripts/qa/graph-parity.mjs
```

單獨看本回歸：

```bash
node scripts/verify.mjs      | sed -n '/GitHub token persistence/,/commit diff/p'
node scripts/render-test.mjs | grep -E 'token|forget'
```

## 6. 驗收對照

| 驗收項 | 狀態 |
| --- | --- |
| `node scripts/build.mjs` 成功、`lib` 最新 | ✅ |
| verify 全綠且新增 ≥6 項 Host 斷言（trim 寫入、空值被拒、clear 呼叫 unset、無 store → 501、fetch stub 驗 Authorization、request token 優先） | ✅ 13 項 |
| render-test 全綠，假宿主支援 saveToken/clearToken，且具備 token 送出／表單消失／forget 出現／forget 呼叫 clearToken 四類斷言 | ✅ 12 項 |
| `node scripts/qa/graph-parity.mjs` exit 0 | ✅ 35/35 |
| 本文件記錄檢查項、結果、安全模型、未驗證項、重跑指令 | ✅ |
| 未修改 `src/**` | ✅ 只改 `scripts/verify.mjs`、`scripts/render-test.mjs` 與本文件 |
