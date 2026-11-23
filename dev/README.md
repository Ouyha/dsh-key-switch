# dev/ — 维护者用的东西

**安装这个插件不需要进这个目录。** 安装步骤见根目录 `README.md` 或 `AGENTS.md`，就一条命令。

这里的东西只在改代码时要跑：

## 测试

```bash
node --test dev/test/
```

约 9 秒，89 个用例，全部用假数据（临时 `DSH_HOME`、假 fetch、假配置服务），不联网、不碰 `~/.dsh` 里的真凭据。

- `providers.test.mjs`：从配置里挑提供商的规则（跳过 OAuth/坏引用、去重、配置服务缺失的原因）。
- `update.test.mjs`：版本号解析/比较、仓库地址解析、更新检测的网络成功与失败路径（都使用假 fetch，不访问 GitHub）。
- `store.test.mjs`：订阅与账号的全部行为（订阅幂等、移除后清引用、提供商从配置消失后仍能切回、新增/切换/删除/收编、损坏文件恢复、v1 旧文件兼容）。
- `routes.test.mjs`：真 HTTP 服务上的路由契约与来源守卫（403/404/400/503），以及「移除只动插件、不动模型配置」。
- `routes-sync.test.mjs`：会话级路由——复制出来的路由长什么样（引用、显示名、模型名后缀、其余字段照抄）、重复同步不写配置、改名不叠后缀、备注撞了末四位自动错开、增删账号跟着增删、关掉开关全撤、复制不出来的提供商只报原因不写配置、无配置服务时 503；当前生效的账号不复制路由、换密钥后路由在两个账号之间挪、默认模型在路由被撤前先被挪回原路由。
- `client.test.mjs`：校验侧栏入口 + 主面板的注册契约（id 一致、图标尺寸跟随），并用一份最小 React 运行时真的把面板渲染出来，走完整链路：空页 → 添加提供商 → 存为账号 → 添加账号 → 切换 → 删除账号 → 移除提供商。另有一组窄屏用例：伪造 390px 窗口，确认卡片头拆成三行、按钮抬到 36px、账号行走两列网格、输入框 16px、页面给底部安全区留位；并对照确认宽屏布局一个字段都没变。
- `target.test.mjs`：`tools/target.mjs` 的安装目标判定——DSH Go 的两个痕迹、只有 `desktop` / 只有 `web`、都没装过、`DSH_HOME`、`--profile` 传名字与传目录、`--dsh-go` / `--desktop` 强制覆盖。

测试依赖 Node 内置的 `node:test`，没有第三方依赖，所以不用 `npm install`。

## 装完的离线自检

按 Harness 自己的组合逻辑把 profile 展开一遍，确认 `key-switch` 这条 entry 真的进了组合树：

```bash
node dev/preflight.mjs                    # 自动判定 profile
node dev/preflight.mjs --dsh-go           # 指定手机版
DSH_APP_DIR=/path/to/dsh node dev/preflight.mjs
```

它需要能读到 DSH 的 app 目录（默认 `D:/app/ds/resources/app/dsh`），只读文件、不启动 App、不动运行中的进程。
