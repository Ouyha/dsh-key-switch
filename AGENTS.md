# AGENTS.md

给 AI 代理看的。这个仓库是一个 DSH 插件，**安装一条命令，装完就结束**。

## 安装：只跑这一条

```bash
curl -fsSL https://raw.githubusercontent.com/Ouyha/dsh-key-switch/main/install.sh | sh
```

没有 curl 的环境（DSH Go 的精简 Ubuntu 常见）：

```bash
git clone --depth 1 https://github.com/Ouyha/dsh-key-switch.git ~/.dsh/dsh-go/plugins/dsh-key-switch \
  && node ~/.dsh/dsh-go/plugins/dsh-key-switch/install.mjs
```

不确定会装到哪、想先看一眼：

```bash
node install.mjs --print-target
```

装完让用户**重启 DSH / 重启引擎**，然后从「密钥切换」进页面。到此为止。

## 不要做的事

这个仓库里 `dev/` 是给维护者用的开发资产，**装插件用不到**：

- ❌ 不要运行 `node --test`、`npm test`、`node --test dev/test/`
- ❌ 不要 `npm install` / `pnpm install` / `pnpm add`（`dependencies` 是空的，装了只会拖时间）
- ❌ 不要为了「让测试通过」去改 `lib/` 下的代码
- ❌ 不要读 `dev/` 找安装步骤——安装步骤全在本文和 `README.md`

安装器只做三件事：把 `lib/`、`package.json`、`cordis.patch.yml`、`README.md` 复制进 profile 的 `node_modules/dsh-key-switch`；在 profile 的 `package.json` 里登记 `file:` 依赖与 bundle；打印入口提示。它不跑构建，也不跑测试。

## 装不上时怎么办

按顺序看，不要靠猜：

1. `node install.mjs --print-target`：确认判定到的是哪一边、profile 目录是否存在。
2. 报「找不到 …/profiles/xxx/package.json」→ 让用户先把那一边启动一次（生成 profile），或用 `--profile <名字或目录>` 指过去。
3. 报 Node 版本 → 需要 Node 22.19+ 或 24+。DSH 自己跑在 Node 上，找它的 Node。
4. 报 clone / 下载失败 → 网络问题。国内环境先设代理，或 `DSH_KEY_SWITCH_SRC=<本地已 clone 的目录>` 跳过联网。
5. **装完重启了，但插件就是不出现**（尤其手机版）→ 先看「设置 › 插件」里这一条是否标了不兼容／已跳过。宿主会按 `engines.dsh` 判断兼容性，不满足就把整个插件从 profile 里剔掉，且不显眼报错。0.4.0 及更早写成 `<0.3.0-0`，在更新引擎上必踩；让用户升级到 0.4.1+，或临时 `dsh plugin allow-version` 放行。**不要**去改 `lib/` 里的代码排查这个问题。

把错误原文贴给用户，别自己加一堆重试和调试脚本。

## 目录（只列对安装有用的）

- `install.sh` / `install.mjs`：取源码 + 安装（`install.sh` 只负责下载，逻辑都在 `install.mjs`）
- `uninstall.mjs`：卸载，保留已存的 Key
- `tools/target.mjs`：判定装到 `profiles/desktop` 还是 `profiles/web`
- `lib/`：插件本体（Host 半 + 浏览器半）
- `cordis.patch.yml`：bundle 补丁
- `dev/`：测试与离线自检，**与安装无关**
