# dsh-key-switch

给 DeepSeek Harness 用的多账号 API Key 切换插件：同一个提供商存多把 Key，一个号的额度用完，点一下换下一个，不用再进「模型」页改配置、也不用重启。

仓库：<https://github.com/Ouyha/dsh-key-switch> · 版本见 `package.json`，页面标题旁也会显示。

> 仓库里**不含任何密钥**。你的 Key 只存在 Harness 自己的 `~/.dsh/.credentials.yaml` 里，插件目录只有代码；测试用的假数据在 `dev/`，安装用不到。

## 它做了什么

- 在 **左侧栏** 加一行 **「密钥切换」**（钥匙图标），点开就是整页面板，按提供商分组列出已保存的账号，当前生效的那个带绿点「使用中」。不占用设置页的位置。手机版没有这条侧栏，改从「全部功能 › 插件」进同一个页面（见安装一节）。
- **订阅制，不自动全列**：这一页只显示你自己添加进来的提供商。点「+ 添加提供商」，从「模型」的配置里挑一个（只列用 API Key 认证的）加进来，再在它下面挂多个账号。不需要切换的提供商不会占地方。
- **移除只影响插件**：卡片上的「移除」只是把这条订阅和插件里记的账号清掉，**不会**改动「模型」里的任何配置；提供商当前正在用的那把密钥也不受影响。
- 每个账号一把**独立**密钥，存在 Harness 自己的凭据存储里（`~/.dsh/.credentials.yaml` 的 `refs`，引用名形如 `KEYSWITCH_SHUSHENG_A1B2C3D4`）。插件自己**不**另存明文密钥。
- 切换 = 把选中的那把写入提供商正在用的引用（如 `SHUSHENG_API_KEY`）。模型适配器**每次请求都重新解析**该引用，所以切换后下一句对话立即用新 Key，不需要重启。
- 界面上的「使用中」是每次把提供商引用和各账号引用的值**比对**出来的，不是记在配置里的标志位。所以在「模型」页手动改过密钥后，这里不会谎报。
- 账号元数据（备注名、顺序）落在 `~/.dsh/key-switch/state.json`，与密钥分开存放。提供商被删掉时，它名下的账号原样保留；提供商加回来，账号自己回来。

## 安装

装到哪一边由它自己判断（桌面版 `profiles/desktop` / DSH Go 手机版 `profiles/web`）。

> **让 AI 帮你装**：把仓库链接给它，它会读根目录的 `AGENTS.md`——里面写明了「只要跑一条命令，不跑测试、不装依赖」。装完重启即可，全程十几秒。

**有 curl 的环境**（电脑、多数 Linux）：

```bash
curl -fsSL https://raw.githubusercontent.com/Ouyha/dsh-key-switch/main/install.sh | sh
```

**没有 curl、只有 git 的环境**（DSH Go 的精简 Ubuntu 常常如此）：clone 到固定目录，再跑安装器。

```bash
git clone --depth 1 https://github.com/Ouyha/dsh-key-switch.git ~/.dsh/dsh-key-switch \
  && node ~/.dsh/dsh-key-switch/install.mjs
```

手机上建议把源码放进「重置引擎」默认保留的目录，重置后不用重新下载：

```bash
git clone --depth 1 https://github.com/Ouyha/dsh-key-switch.git ~/.dsh/dsh-go/plugins/dsh-key-switch \
  && node ~/.dsh/dsh-go/plugins/dsh-key-switch/install.mjs
```

- 一行装要带参数得写成 `sh -s -- …`，例如 `curl … | sh -s -- --dsh-go`。
- 有 git 时脚本走 clone / pull，没有就退到 GitHub tarball，效果一样。
- 装之前想先看它打算装哪：`node install.mjs --print-target`。

判定规则：

| 环境 | 认什么 | 装到 |
|---|---|---|
| DSH Go 手机版 | `~/.dsh/dsh-go` 或 `/opt/dsh-go` | `profiles/web` |
| 桌面版 | `profiles/desktop` | `profiles/desktop` |
| 电脑上只跑过 `dsh web` | 只有 `profiles/web` | `profiles/web` |

想指定就加 `--dsh-go` / `--desktop` / `--profile <名字或目录>`。

改代码时也一样：在本仓库目录里 `node install.mjs`，它会自己找目标。

装完重启 DSH。

### 在 DSH Go 里从哪打开

手机版没有网页版那条左侧栏，插件按「网页岛屿」显示，功能一致：

- **全部功能 › 插件 › 密钥切换**：整页 Web 岛屿，界面和电脑上一样（首开 1–3 秒白屏）。
- **对话详情 › 插件**：这台主机没有对话专属插件页签时，也会显示这个面板。
- **设置 › 界面** 选「网页」（网页模式）：完整网页版，侧栏照常有一行「密钥切换」。

同一个引擎、同一份凭据，切换后下一句对话就生效。

### 卸载

在装的时候那份源码目录里跑（桌面版 `~/.dsh/dsh-key-switch`，手机版 `~/.dsh/dsh-go/plugins/dsh-key-switch`）：

```bash
node uninstall.mjs
```

卸载只撤插件，`~/.dsh/key-switch/state.json` 与已保存的密钥都留着，重装后接着用。

## 用法

1. 点 **+ 添加提供商** → 从「模型」里挑一个 → 它就成为一张卡片。
2. 卡片里点 **存为账号**，把当前正在用的那把 Key 存下来（省得再粘一遍）；后续账号点 **+ 添加账号**，填备注名和 Key。
3. 额度用完时，在目标账号那行点 **切换**。下一句对话就走新 Key。
4. 不想在这一页看到某个提供商了，点卡片右上角的 **移除**（二次确认）。

在「模型」里新增或删除了提供商，回到这一页点 **+ 添加提供商**（打开候选时会自动重新读取配置）就能看到最新候选；候选面板里也有一个 **重新读取**。

## 版本与更新检测

- 页面标题旁显示当前版本（从 `package.json` 读，不在代码里写死）。
- 页脚有 **检查更新**：点它才请求一次 GitHub，读取默认分支上的 `package.json` 版本并与本地比较。
  - 远端更高 → 提示「有新版本 vX.Y.Z」并给出仓库链接；
  - 相同 → 「已是最新版本」；
  - 本地更高 → 说明是本地开发版。
- **不自动检查**：避免每次打开页面都打 GitHub，也避免没有网络时拖慢首屏。
- 请求先走 Harness 进程的 `fetch`；如果 Harness 是用 `HTTPS_PROXY` / `HTTP_PROXY` 启动的，`dsh-http-proxy` 会装上全局 dispatcher，自动走代理。
- 如果 Host 的 Node 网络连不上 GitHub（常见于只开了 Windows 系统代理的情况），页面会用浏览器网络栈再查一次——Chromium 会走系统代理。两边都失败时才报错，并提示去配代理。

更新插件：

```bash
git pull
node install.mjs
```

或者再跑一次安装那条 `curl … | sh`（会用源码目录里的 git 仓库 pull 一次）。然后完全退出并重开 Harness。

## 添加时为什么可能看不到某个提供商

候选只包含**用引用（`apiKeyEnv`）取密钥**的路由，因为切换的本质就是换那个引用指向的值。

- ✅ 「模型」里那种「API 地址 + API Key」的自定义提供商（书生、星辰、各种中转站）。
- ❌ 走 OAuth 登录的（如账号登录的 DeepSeek）——没有引用可换。
- ❌ 把密钥存在 credential record 里的适配器——那是各插件自己的载荷格式，换引用对它无效。

另外，已经添加过的提供商不会重复出现在候选里。

## 实现笔记

- **Host 半**（`lib/index.js` + `lib/providers.js` + `lib/store.js`）只用内置模块，通过 `ctx.webServer` 注册 `/api/dsh-key-switch/*`，通过 `ctx.get('credentials')` 读写凭据、`ctx.get('settings')` 发现提供商。不引 `@deepseek-ai/*`，因此在 profile 的 `node_modules` 里是自足的。
- **安全**：所有接口要求自定义头 `x-dsh-key-switch: 1`，且连接必须来自回环地址、`sec-fetch-site` 不得是跨站、Host/Origin 必须一致。少一条就 403——写密钥的接口不给别的来源留口子。
- **浏览器半**（`lib/client.js`）按宿主的 `window.__ModuleLoader__.load` 协议输出，只 `require('react')`，样式全部走 `--dsw-alias-*` 设计令牌，明暗主题自动跟随。不依赖 UI 组件库，升级 Harness 时更不容易碎。
- **入口在左侧栏**：向 `sidebar.panellist` 注册一行（id 与图标），同时向 `main` 注册同 id 的整页面板；点侧栏那行由宿主自己完成导航。不需要改设置页，也不用改 `cordis.patch.yml`。
- **安装目标**（`tools/target.mjs`）只做一件事：认出这是桌面版还是 DSH Go 的手机引擎，选出 `desktop` / `web`。安装器、卸载器、`dev/preflight.mjs` 共用这一份规则，不会各算各的。
- 凭据服务缺位（组合里没有 `@deepseek-ai/dsh-credentials-local`）时接口回 503；配置服务缺位时回空清单 + `reason`，界面照实说明，不假装「没有提供商」。

## 开发

改这个插件才需要看：测试与离线自检都在 `dev/`，说明见 [`dev/README.md`](dev/README.md)。

```bash
node --test dev/test/        # 约 5 秒，假数据，不联网
```

安装（包括让 AI 代装）**不需要**跑测试，也不需要 `npm install`——`dependencies` 是空的。

## 已知边界

- 只在**本机**页面可用（回环地址）。从别的机器通过远程访问打开 Harness 时，这一页会 403——这是故意的。
- **手机上是网页岛屿**：要有本机引擎（连远程 / 中转主机时没有本机 Web 页面，也就没有入口）；首开 1–3 秒白屏，之后常驻内存。功能与电脑版一致。
- 手机上的岛屿用同一个引擎，所以切换 Key 立即生效；但插件代码更新后要**重启引擎**才加载新代码（`设置 › 引擎`）。
- 不做「余额/额度」探测：各家的额度接口不统一，猜一个不如不做。
- 如果之后在 profile 里用 pnpm 重新安装插件，`file:` 依赖会重新链接；万一被清掉，重跑 `install.mjs` 即可。
