# GitHub Sync - Zev

作者：**Zev** · MIT 授權 · 最低 Obsidian：**1.11.4**

喺 Obsidian 直接接駁 GitHub 已經有嘅 folder，用原生編輯器開 Markdown，離線照寫，重新連線後再同步。唔需要安裝 Git。1.1.0 加入獨立 Vault 快照同科幻風格 workspace 控制台。

## 獨立儲存成個 Vault，保留前後連結

1. 喺 **GitHub workspaces** 按 **Save full vault**。
2. 揀一個可寫入嘅已連接 repo，再按 **Preview full vault**。
3. 核對全 Vault 文件清單同目的 repo，勾選已檢閱，再按 **Save vault to repository**。

每次會喺 `Obsidian-Vaults/snapshot-<id>/` 建立新快照：

- **vault/**：原始筆記同附件，保留資料夾、`[[連結]]`、alias、embed、heading 同 block ID。另產生三份全新核心設定，啟用 Backlinks、Outgoing links 同 Graph。
- **browse/**：GitHub 閱讀版，將已解析連結轉成可點 Markdown，每篇附前向連結同 backlinks。
- **README.md／link-map.json**：還原說明、筆記目錄同完整已解析連結圖。

還原時下載及解壓 repo，喺 Obsidian 用 **Open folder as vault** 開快照入面嘅 **vault/**，保留入面自動產生嘅 `.obsidian`。等 Obsidian 建立索引後，就可以用返原生前後連結同 Graph。GitHub 網頁可以點閱讀版嘅前後連結；互動 Graph 同即時 note embed 要喺 Obsidian 用。

原本嘅 plugin 設定、token、workspace 紀錄同快取唔會複製。`Obsidian-Vaults` 會被普通同步同下次備份排除，避免循環備份。快照包含所連接 folder 以外嘅筆記，儲存去 public repo 前要核對全 Vault 清單。詳見 [Vault 快照說明](docs/VAULT-SNAPSHOTS.md)。

## 安裝

呢個專案準備好手動安裝；Obsidian 社群商店收錄仍然要另外提交審核。

1. 下載 release 嘅 `github-sync-zev-1.1.2.zip`。
2. 將入面嘅 `github-sync-zev` folder 放入 `<vault>/.obsidian/plugins/`。如果有自訂設定目錄，就改用該目錄。
3. 重新開 Obsidian，到「設定 → 第三方外掛」啟用 **GitHub Sync - Zev**。

## 開 GitHub folder

1. 私人 repo 或需要上傳嘅話，按連接畫面嘅 **Set GitHub token**，或喺 plugin 設定儲存 GitHub fine-grained token，只授權所需 repo。需要 **Contents: Read and write**；純閱讀只需 Read。Token 欄會遮罩，唔需要將 token 交畀作者或放入 URL。
2. 按側邊 GitHub 圖示，再按 **Connect folder**。
3. 貼入 repo 或 folder 網址，例如 `https://github.com/example/notes/tree/main/docs`。
4. 按 **Load repository**，揀 branch、遠端 folder 同 vault 入面嘅本機 folder。
5. 按 **Preview connection** 核對，再按 **Connect and download**。
6. 完成下載後就可以原生編輯、搜尋、用 backlinks 同 Graph。按 **Sync** 上傳；自動上傳要另外開啟。

首次接駁只會下載，唔會直接上傳你本機現有嘅文件。同一路徑兩邊內容唔同會要求處理衝突。本機獨有文件會保留。

## 日常使用

- 直接用 Obsidian 檔案總管新增、改名、移動或刪除筆記；plugin browser 亦有 **New note**。
- 預設每 60 秒檢查遠端更新；啟用自動上傳後，修改停低約 15 秒會批次 commit。
- 支援多個互不重疊嘅 folder、不同 branch、唯讀連接同暫停同步。
- 所選 folder 內支援嘅筆記同附件會下載至本機，方便離線用；唔會 clone 成個 repo。
- 每個裝置要獨立接駁。手機背景同步受系統限制，返到 Obsidian 或按 Sync 就會再檢查。

## 衝突同刪檔

兩邊改咗唔同行數，可自動三方合併；改到同一段、圖片衝突、刪除對修改，就會保留兩邊版本畀你揀。唔會將衝突標記寫入筆記。

按 **Resolve** 比較共同版本、本機同 GitHub 版本，揀一份或手動合併，儲存後再 Sync。有未處理衝突時，該連接會暫停上傳。

本機刪檔要按 **Review deletions** 核對清單，先會刪除 GitHub 對應文件。遠端刪除本機未修改嘅文件時，會放入 Obsidian 本機垃圾桶。整個本機 root 或遠端 folder 唔見咗會停止同步。

## 私隱處理

- 公開署名只用 **Zev**。Commit 用通用名稱同 noreply email，唔會讀取電腦名稱、系統帳號或私人 email。
- Token 只經 Obsidian SecretStorage 儲存；plugin 唔會將佢放入設定檔、IndexedDB、diagnostics 或 release。
- Repo／branch／路徑、同步基準、衝突內容同上傳 journal 留喺裝置 IndexedDB，唔會建立 plugin `data.json`。
- 筆記本身仍然係 vault 入面嘅普通文件，其他已安裝外掛或其他同步服務仍可能讀取。
- 只連接 GitHub API，冇作者伺服器、analytics 或 telemetry。GitHub 仍然知道 token 所屬帳號。
- 隱藏路徑、`.env`、`.obsidian`、`.git`、常見憑證檔、script 同 private key 會被排除。普通筆記入面嘅敏感文字唔會自動遮蓋。
- 回報問題可以用 **Show private-data-free diagnostics**，只包含版本同數量。

刪除 plugin 連接會保留本機同 GitHub 文件，但會刪除該連接嘅裝置同步基準及衝突快照。清除 Obsidian app storage 亦會失去呢啲紀錄，所以重要衝突要先複製保存。

## 支援範圍

Markdown、文字、CSV、Canvas、Bases，以及常用圖片、PDF、影音附件。預設單檔 10 MB，可設定 1–25 MB。大型文件會停止同步，唔會被當成刪除；每個連接最多 100 MB 支援內容及 20,000 份文件。純文字必須用 UTF-8。

呢個版本用定期更新，唔係多人同時打字協作；唔會自動建立 branch 或 PR。受保護 branch 要改用唯讀或可寫入嘅 branch。原生搜尋同 backlinks 只涵蓋已下載文件，連結到所選 folder 以外嘅文件唔會自動下載。

Obsidian API 冇提供 binary 寫入或刪檔嘅原子比較更新，plugin 會喺操作前再核對內容；避免其他程式同時改同一份附件。Markdown 更新有原子內容核對同未儲存 editor 檢查。

完整技術資料見 [English README](README.md)、[PRIVACY.md](PRIVACY.md) 同 [發布指南](docs/PUBLISHING.md)。

## 開發及打包

```sh
npm ci
npm run package
```

會完成 TypeScript 檢查、自動測試、build、公開檔案敏感資料檢查，再產生安裝 ZIP、source ZIP 同 SHA-256 校驗碼。自動測試使用模擬 Obsidian host；實際桌面同手機驗收項目列喺 [docs/TESTING.md](docs/TESTING.md)。
