# dsh-key-switch

给 DeepSeek Harness 用的多账号 API Key 切换插件：同一个提供商存多把 Key，一个号的额度用完，点一下换下一个，不用再进「模型」页改配置、也不用重启。

仓库：<https://github.com/Ouyha/dsh-key-switch> · 版本见 `package.json`，页面标题旁也会显示。

> 仓库里**不含任何密钥**。你的 Key 只存在 Harness 自己的 `~/.dsh/.credentials.yaml` 里，插件目录只有代码和假数据测试。

## 它做了什么

- 在 **左侧栏** 加一行 **「密钥切换」**（钥匙图标），点开就是整页面板，按提供商分组列出已保存的账号，当前生效的那个带绿点「使用中」。不占用设置页的位置。
- **订阅制，不自动全列**：这一页只显示你自己添加进来的提供商。点「+ 添加提供商」，从「模型」的配置里挑一个（只列用 API Key 认证的）加进来，再在它下面挂多个账号。不需要切换的提供商不会占地方。
- **移除只影响插件**：卡片上的「移除」只是把这条订阅和插件里记的账号清掉，**不会**改动「模型」里的任何配置；提供商当前正在用的那把密钥也不受影响。
- 每个账号一把**独立**密钥，存在 Harness 自己的凭据存储里（`~/.dsh/.credentials.yaml` 的 `refs`，引用名形如 `KEYSWITCH_SHUSHENG_A1B2C3D4`）。插件自己**不**另存明文密钥。
- 切换 = 把选中的那把写入提供商正在用的引用（如 `SHUSHENG_API_KEY`）。模型适配器**每次请求都重新解析**该引用，所以切换后下一句对话立即用新 Key，不需要重启。
- 界面上的「使用中」是每次把提供商引用和各账号引用的值**比对**出来的，不是记在配置里的标志位。所以在「模型」页手动改过密钥后，这里不会谎报。
- 账号元数据（备注名、顺序）落在 `~/.dsh/key-switch/state.json`，与密钥分开存放。提供商被删掉时，它名下的账号原样保留；提供商加回来，账号自己回来。

## 安装

```bash
git clone https://github.com/Ouyha/dsh-key-switch.git
cd dsh-key-switch
node install.mjs          # 默认装进 ~/.dsh/profiles/desktop
# 或者：node install.mjs --profile /path/to/profile
```

然后重启 DeepSeek Harness（完全退出再打开），左侧栏会出现「密钥切换」。

卸载：

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

然后完全退出并重开 Harness。

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
- 凭据服务缺位（组合里没有 `@deepseek-ai/dsh-credentials-local`）时接口回 503；配置服务缺位时回空清单 + `reason`，界面照实说明，不假装「没有提供商」。

## 测试

```bash
node --test test/
```

- `providers.test.mjs`：从配置里挑提供商的规则（跳过 OAuth/坏引用、去重、配置服务缺失的原因）。
- `update.test.mjs`：版本号解析/比较、仓库地址解析、更新检测的网络成功与失败路径（都使用假 fetch，不访问 GitHub）。
- `store.test.mjs`：订阅与账号的全部行为（订阅幂等、移除后清引用、提供商从配置消失后仍能切回、新增/切换/删除/收编、损坏文件恢复、v1 旧文件兼容）。
- `routes.test.mjs`：真 HTTP 服务上的路由契约与来源守卫（403/404/400/503），以及「移除只动插件、不动模型配置」。
- `client.test.mjs`：校验侧栏入口 + 主面板的注册契约（id 一致、图标尺寸跟随），并用一份最小 React 运行时真的把面板渲染出来，走完整链路：空页 → 添加提供商 → 存为账号 → 添加账号 → 切换 → 删除账号 → 移除提供商。

## 已知边界

- 只在**本机**页面可用（回环地址）。从别的机器通过远程访问打开 Harness 时，这一页会 403——这是故意的。
- 不做「余额/额度」探测：各家的额度接口不统一，猜一个不如不做。
- 如果之后在 profile 里用 pnpm 重新安装插件，`file:` 依赖会重新链接；万一被清掉，重跑 `install.mjs` 即可。
