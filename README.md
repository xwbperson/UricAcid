# UricAcid 个人观测台

手机优先的饮食、饮品和血尿酸趋势记录 Web 应用。它保存膳食嘌呤参考范围、实际饮品容量和真实测量值，不把食物换算成个人血尿酸升高值，也不提供诊断、治疗或用药建议。

## 本地运行

需要 Node.js 22+。

```powershell
npm install
npm run build
npm run setup:password
npm run dev
```

打开 `http://localhost:4317`。共享口令只通过交互式输入生成哈希并写入被 Git 忽略的 `.env.local`，不会写入源码、数据库或日志。网页修改口令后会写入数据目录中的独立 `password.hash` 私密文件，服务重启仍保持新口令；该文件不进入业务导出。没有 `SHARED_PASSWORD_HASH` 时，应用只提供健康检查和口令入口，业务 API 保持锁定。

### Windows temporary local test console

Double-click [`local-test.bat`](local-test.bat) for a persistent English menu. It provides one-click start, stop, restart, status, automated checks, browser smoke testing, password setup, browser opening, and project-folder opening. The server runs in a separate persistent `cmd /k` window; option `2` stops only the process recorded by this script and does not kill unrelated `node.exe` processes.

The same actions are available from an existing terminal, for example `local-test.bat start`, `local-test.bat stop`, `local-test.bat status`, and `local-test.bat check`. Use option `7` or `local-test.bat setup` for the interactive password setup. The application requires at least 8 password characters; do not hard-code even a temporary password into the script.

生产模式下必须把 `BACKUP_ENCRYPTION_KEY` 放在私密部署配置中；若要满足异盘/异机复制验收，再配置私有挂载目录 `BACKUP_REPLICA_DIR`。这两个值都不能进入 Git、导出文件或日志。

## 验证

```powershell
npm run check
```

这会执行 TypeScript 构建和 10 项服务端测试。浏览器烟测使用 Playwright：

```powershell
npx playwright install chromium
$env:SMOKE_PASSWORD = ([guid]::NewGuid().ToString('N') + 'Aa')
$taskHash = node -e "const {hashPassword}=require('./dist/src/auth'); process.stdout.write(hashPassword(process.env.SMOKE_PASSWORD))"
$env:SHARED_PASSWORD_HASH = $taskHash
python C:\Users\xiewe\.codex\skills\webapp-testing\scripts\with_server.py --server "node dist/src/server.js" --port 4317 -- node test/browser-smoke.mjs
```

烟测覆盖 360px 视口下的口令门、食物、饮品、尿酸、统计、管理/设置页，以及 1280px 桌面布局；同时检查无横向溢出和浏览器错误。测试产生的截图位于 `test-artifacts/`，不进入 Git。

## Docker 部署

复制 `.env.example` 为服务器私密配置并设置 `SHARED_PASSWORD_HASH`。生成哈希请在服务器上运行交互式 `npm run setup:password`，或使用等价的私密部署流程；不要把明文口令放进命令行参数、Compose 文件或 Git。

```powershell
docker compose up -d --build
docker compose exec uric-acid npm run setup:password
```

生产模式下，交互式口令哈希会写入持久化卷中的独立 `password.hash`，不会进入 Compose 文件。Compose 只暴露应用端口，SQLite 数据写入持久化卷 `/app/data`。公网部署还需要在反向代理层配置 HTTPS；数据库端口不应暴露。宿主机计划任务可以调用单次备份命令：

```powershell
npm run backup:once
```

该命令使用 SQLite 在线备份 API 创建安全快照并返回文件大小、SHA-256、复制状态和退出结果；生产环境没有加密密钥或复制目标时会失败。宿主机需要自行配置每日/每周/月度任务，应用不会假装任务已经配置。

维护窗口中可用命令行恢复 SQLite 快照。先停止正在使用该数据库的应用，再设置明确确认短语：

```powershell
npm run build
$env:CONFIRM_RESTORE = 'RESTORE_URIC_ACID'
npm run restore:snapshot -- .\data\backups\<snapshot.db.enc>
```

恢复前会先创建当前数据库快照；恢复过程在临时库完成完整性检查、清空可信设备并轮换会话世代后再切换，失败时保留原库及恢复前副本。成功的命令行恢复会在目标库留下 `VERIFIED` 恢复证据。网页管理页用于 JSON/ZIP 的预览恢复；CSV 只用于阅读，不代替完整备份。

## 数据与安全边界

- 单一共享数据空间，无用户名、账户或多用户角色。
- 浏览器只持有随机 HttpOnly、SameSite Cookie；服务端保存凭证哈希并检查撤销、过期和会话世代。
- 写接口要求 CSRF 头；共享口令修改会立即撤销全部设备。
- 响应带 CSP、`nosniff`、禁止嵌入、无 Referrer 和权限策略；失效 Cookie 会在服务端立即清除。
- 历史饮食记录保存录入时的名称、分组、参考范围和计算版本快照。
- JSON/ZIP 导出不包含共享口令/哈希、可信设备凭证、服务器签名密钥或备份密钥。
- 未知参考值不会按 0 参与估算；当天会显示部分覆盖。
- 饮品只贡献 mL；尿酸实测先统一为 μmol/L 统计，原始值和单位仍保留。

## 交付状态

实现状态和证据边界见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。当前代码与自动化/浏览器烟测已完成，但首批参考库仍标记 `PREPARED`；尚未在用户的真实目标服务器完成 HTTPS、持久化重建、异机迁移恢复和用户手机/电脑验收，因此不能将项目标记为 `VERIFIED` 或 `ACCEPTED`。
