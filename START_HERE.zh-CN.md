# 在 D 盘运行 Signal 网站

这是本机网站，不需要做成桌面 APP，也不用安装 Rust、Tauri 或 Python。

## 下载后怎么用

1. 将整个 `Signal` 文件夹解压到 **`D:\Signal`**。不要直接在压缩包里运行。
2. 双击 **`Start-Signal.cmd`**。第一次会联网下载便携版 Node、安装依赖并构建网页，所需空间和时间取决于网络。
3. 等窗口显示 `[5/5] Website ready: http://127.0.0.1:1421`，保持这个窗口打开。
4. 启动完成后会自动用 Chrome 的独立 D 盘配置打开网页。如未自动打开，双击 **`Open-Signal.cmd`**。也可手动访问 `http://127.0.0.1:1421`，但普通浏览器窗口可能使用原来的 C 盘配置。
5. 使用完后，在服务器窗口按 Ctrl+C 关闭网站。

这是运行在**你自己的电脑**上的网址。云端任务里运行的 localhost 地址不能直接从你的电脑访问。当前没有公网网站地址。

## 文件位置

```text
D:\Signal\
  Start-Signal.cmd              启动网站
  Open-Signal.cmd               用 D 盘浏览器配置打开
  src\                         网页源码
  server\                      本机服务源码
  database\migrations\         SQLite 表结构
  .tools\                      便携 Node.js（首次启动后）
  .cache\npm\                  依赖下载缓存
  .cache\tmp\                  启动进程临时文件
  .cache\browser\chrome\       独立 Chrome 配置与缓存
  node_modules\                网页开发依赖
  dist\                        构建后的网页
  data\signal.sqlite3          本机数据库
```

不用全局安装 Node。启动脚本会从 Node 官方网站下载匹配 x64/ARM64 的便携版，核对官方 SHA-256 校验信息。首次安装需要联网，应用数据不会上传到服务器。如果下载失败，请保留错误信息；不要关闭校验或更换来历不明的下载包。

**这些是本应用可以控制的文件位置。Windows、PowerShell、杀毒软件及既有浏览器程序仍可能使用 C 盘的系统文件，不能承诺整台电脑对 C 盘完全零写入。** 启动脚本不会全局修改你的 PATH、临时目录或 npm 配置。

## 只想先看界面

双击 `dist\signal-preview.html`。这一份不需要安装任何工具，也不需要运行服务器。它仅展示页面与导航，不能保存 SQLite 数据。普通浏览器自身的配置位置仍由浏览器管理。

## 已经安装了 Node 的开发者

要求 Node.js 24.x。在 PowerShell 中执行：

```powershell
Set-Location D:\Signal
$env:npm_config_cache = 'D:\Signal\.cache\npm'
$env:SIGNAL_DATA_DIR = 'D:\Signal\data'
$env:TEMP = 'D:\Signal\.cache\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
npm ci
npm run build
npm start
```

随后访问 `http://127.0.0.1:1421`。需要修改代码并即时预览时改用 `npm run dev`，开发界面地址为 `http://127.0.0.1:1420`。

## 现在能做什么

已有 Dashboard、融资周报和公司资料。融资范围为美国 AI/Fintech、Pre-seed 至 Series B。其他独立 CRM/邮件/简历模块仍待开发，不会自动发送邮件。

数据默认在项目中的 `data`，重启后保留；`SIGNAL_DATA_DIR` 可指定其他绝对路径。目录不可写时会直接报错，不会改存到 C 盘 AppData。升级前关闭服务器并备份整个 `data` 文件夹。若曾使用旧桌面版，请先备份旧数据库，再手动迁入目标目录；不会自动移动或删除旧数据。

当前网页构建、UI、Node/SQLite/HTTP 与数据库结构检查已在 Linux 云环境执行；Windows 的双击启动脚本和 Chrome 启动流程仍需在 Windows 上验证。

## 双击后没有反应或窗口闪退

更新后的 CMD 会保留窗口，并显示实际解压目录、启动步骤和错误。请确认已将整个压缩包解压，不是在 ZIP 预览窗口里双击文件。

按 Win+R，输入下面命令并按回车，可以保持诊断窗口打开（路径按实际解压位置调整）：

```text
cmd /k D:\Signal\Start-Signal.cmd
```

启动进度分为 `[1/5]` 到 `[5/5]`。首次下载可能需要几分钟。失败时将窗口里的错误文字发给开发者；或提供项目目录下 `.cache\logs\startup.log`。服务器输出分别位于 `server.stdout.log`、`server.stderr.log`，同样在日志目录中。

### 为什么打开一个新的 Chrome 窗口？

启动脚本现在使用 Google Chrome。为满足 D 盘存储要求，它使用 `D:\Signal\.cache\browser\chrome` 下的独立配置和缓存，不修改默认浏览器，也不移动你原来的 Chrome 资料。这个窗口可能没有你平时的登录状态和书签。直接在平时的 Chrome 输入 `http://127.0.0.1:1421` 也能使用网站，但会沿用普通 Chrome 的配置存储位置。旧的 Edge 配置不会被修改或删除。

## v0.2：融资周报与公司资料

1. 进入 Funding Feed，点击“生成过去 7 天周报”。默认每周自动生成，但必须保持本机网站运行；关闭期间下次启动补跑当前周。
2. 范围是美国 AI / Fintech，Pre-seed 至 Series B，按美国东部时间计算最近 7 个日历日（含今天）。
3. 公开 RSS 提取的是候选报道，不是已证实融资。打开原文核对美国总部、融资阶段和实际公告日期后，点击“核对并保存”，写入正式公司与融资表。
4. “来源检查”会显示抓取失败与覆盖不足。零条结果不表示市场上没有融资。云端源站访问目前被拦截，尚未成功验证真实抓取，请在本机联网测试。
5. 导出 Markdown 会区分已核对融资与待核对报道。多来源的同一融资轮次不会重复计算。
6. Companies 支持公司官网/X/LinkedIn、业务、办公室、创始人 LinkedIn 和公开联系方式。详细资料当前需人工核实录入，没有自动补全功能。
7. 招聘只记录 PM / GTM / Data：需要官网明确岗位名称、官网或其链接的 ATS 地址、原文依据及核查日期。未核查不等于不招聘，岗位也不等于公司战略结论。

## 已有版本怎么更新

先在黑色窗口按 Ctrl+C 停止网站。备份 D:\Signal\data 整个文件夹，再将新版包中的 Signal 文件夹内容覆盖到 D:\Signal。**保留 data、.tools、.cache，不要删除数据库。** 新版 Start-Signal.cmd 会根据锁文件更新依赖，并按序升级数据库、保留旧记录。新数据库不能用旧版打开。

## v0.3：以后不用手动覆盖

已有 v0.1/v0.2：先关闭黑色服务窗口，下载一次性安装器 Install-Signal.zip，解压到 D 盘并双击 Install-Signal.cmd。安装器自动升级 D:\Signal，不要再手动复制源码。

以后每次打开 Start-Signal.cmd 会自动检查 GitHub 新版并安装。网站开着时，顶部会定期检查；看到新版点“更新并重启”即可，保持启动窗口打开，网页会等待新版服务恢复后刷新。使用 npm start 直接运行而不是 Windows 启动器时，网页按钮不能控制父进程；请改用 Start-Signal.cmd。

程序/数据库备份、下载、临时文件、依赖、浏览器资料都在 D 盘项目目录中。自动更新只替换发布清单中的程序文件，不覆盖 data、.tools、普通缓存或你自己的未知文件。新版构建/启动失败且还没对外提供服务时，恢复旧程序、旧依赖和更新前数据库；已成功确认并开始使用的版本不会在后台回滚用户后续数据。保留最近两份更新备份，注意 D 盘空间。

离线或 GitHub 暂不可用时继续运行原版。先前失败的发布版本会暂停自动重试，下一修复版本发布后继续更新。日志仍在 .cache\logs。Windows 安装/重启流程尚需实机验证，更新核心和真实包升级已在隔离环境通过。

## v0.3.1：只看最终公司，一页完成

Funding Feed 与 Companies 已合并为“公司发现”。点击“生成本周公司名单”后，后台读取融资原文、地点依据、公司官网/团队/联系方式/招聘页，以及官网链接的 Greenhouse/Lever/Ashby 职位。完成筛选与公开页面查询后，公司卡片集中显示所有字段，不再要求你核实、保存或跨页操作。

无法明确支持美国总部、阶段或公司页面查询未完成的结果不展示；旧误入选记录自动隐藏。邮箱电话等在已查页面未找到时如实显示，不编造。日期标为融资消息发布日期，不冒充资金交割日。公开网页与反爬限制可能影响结果覆盖，云环境目前无法成功连接这些新闻源，真实页面效果需在本机确认。

已接入自动更新的版本直接在顶部点击“更新并重启”，或关闭服务后重新启动。无需覆盖文件。

## v0.3.3: core eligibility and optional data

Core gates are US location evidence, AI/Fintech industry, Pre-seed–Series B and a recent funding news event. A failed optional website/team/careers/contact fetch no longer excludes a company passing those gates; attempted-but-unavailable fields stay empty with explicit access/availability wording. RSS location evidence is retained when the full article omits it. Startup reruns research after this algorithm upgrade. Report diagnostics show read/candidate/included counts and omitted reasons; these are not manual review tasks. Retrieval is still bounded to the configured sources and is not a general web-search engine.
