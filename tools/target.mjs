/**
 * 「装到哪」的判定：同一个包要同时服务桌面版 DSH 和 DSH Go 的手机引擎，
 * 两边的 profile 名不一样（`desktop` / `web`），这里把这个决定集中做掉，
 * 安装器与卸载器都用同一份规则，不会各算各的。
 *
 * 规则（按优先级）：
 * 1. `--profile <名字或目录>`：用户说了算；
 * 2. `--dsh-go` / `--desktop`：强制某一边；
 * 3. 自动：看到 DSH Go 的运行时痕迹就用 `web`，否则桌面版用 `desktop`；
 *    只有一个 profile 存在时跟着它走（很多人 PC 上只跑过 `dsh web`）。
 *
 * 纯函数：文件系统探测由调用方注入 `exists`，可直接单测。
 * @module dsh-key-switch/tools/target
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

/** 包名，安装器与卸载器共用。 */
export const PACKAGE = 'dsh-key-switch'

/** DSH Go 的 App 侧运行时目录（手机本机引擎里一定有）。 */
export const SYSTEM_MARKERS = ['/opt/dsh-go']

/** `$DSH_HOME`：自定义优先，否则 `~/.dsh`。 */
export function dshHomeOf(env = process.env, home = homedir()) {
  const custom = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return custom === '' ? join(home, '.dsh') : resolve(custom)
}

/** 某个 profile 的目录。 */
export function profileOf(home, name) {
  return join(home, 'profiles', name)
}

/** DSH Go 用来放「重置引擎也保留」的东西；插件源码放这里最稳。 */
export function stageOf(home) {
  return join(home, 'dsh-go', 'plugins', PACKAGE)
}

/** 取 `--flag value` 的 value；缺值或下一个又是选项时返回 undefined。 */
function flagValue(argv, name) {
  const at = argv.indexOf(name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  return typeof value === 'string' && value !== '' && !value.startsWith('--') ? value : undefined
}

/**
 * 判定这是不是 DSH Go 的本机引擎。
 * @param home - `$DSH_HOME`。
 * @param exists - 路径存在性判断。
 * @param markers - 额外要探测的绝对路径。
 * @returns 命中的依据（给用户看的一句话），没命中给 null。
 */
export function detectDshGo(home, exists = existsSync, markers = SYSTEM_MARKERS) {
  if (exists(join(home, 'dsh-go'))) return `找到 ${join(home, 'dsh-go')}`
  for (const marker of markers) {
    if (exists(marker)) return `找到 ${marker}`
  }
  return null
}

/**
 * 算出目标 profile。
 * @param options - 见下方默认值。
 * @returns `{ host, auto, reason, dshHome, profileName, profileDir, stageDir }`。
 */
export function resolveTarget({
  argv = [], env = process.env, home = homedir(), exists = existsSync, markers = SYSTEM_MARKERS,
} = {}) {
  const dshHome = dshHomeOf(env, home)
  const marker = detectDshGo(dshHome, exists, markers)
  const explicitProfile = flagValue(argv, '--profile')
  const forcedGo = argv.includes('--dsh-go')
  const forcedDesktop = argv.includes('--desktop')

  /** 拼一份结果，顺便把 host 从 profile 名推出来。 */
  const result = (profileName, profileDir, options) => ({
    host: options.host ?? (profileName === 'web' ? 'dsh-web' : 'desktop'),
    auto: options.auto,
    reason: options.reason,
    dshHome,
    profileName,
    profileDir,
    stageDir: stageOf(dshHome),
  })

  if (explicitProfile !== undefined) {
    // 带斜杠就是目录，否则当作 profile 名。
    const looksLikePath = isAbsolute(explicitProfile) || /[\\/]/.test(explicitProfile)
    const profileDir = looksLikePath ? resolve(explicitProfile) : profileOf(dshHome, explicitProfile)
    const profileName = looksLikePath ? basename(profileDir) : explicitProfile
    return result(profileName, profileDir, {
      host: marker === null ? (profileName === 'web' ? 'dsh-web' : 'desktop') : 'dsh-go',
      auto: false,
      reason: '指定了 --profile',
    })
  }

  if (forcedGo) {
    return result('web', profileOf(dshHome, 'web'), { host: 'dsh-go', auto: false, reason: '指定了 --dsh-go' })
  }
  if (forcedDesktop) {
    return result('desktop', profileOf(dshHome, 'desktop'), { host: 'desktop', auto: false, reason: '指定了 --desktop' })
  }

  if (marker !== null) {
    return result('web', profileOf(dshHome, 'web'), { host: 'dsh-go', auto: true, reason: marker })
  }

  const hasDesktop = exists(profileOf(dshHome, 'desktop'))
  const hasWeb = exists(profileOf(dshHome, 'web'))
  if (!hasDesktop && hasWeb) {
    return result('web', profileOf(dshHome, 'web'), { host: 'dsh-web', auto: true, reason: '只找到 web profile' })
  }
  return result('desktop', profileOf(dshHome, 'desktop'), {
    host: 'desktop',
    auto: true,
    reason: hasDesktop ? '找到 desktop profile' : '没找到现成 profile，按桌面版默认值',
  })
}

/** 给用户看的环境名。 */
export function hostLabel(host) {
  if (host === 'dsh-go') return 'DSH Go 手机版（本机引擎）'
  if (host === 'dsh-web') return 'DSH 网页版（dsh web）'
  return '桌面版 DSH'
}

/** 装完之后从哪儿打开这个页面。 */
export function entryHint(target) {
  return target.host === 'dsh-go'
    ? '重启引擎后从「全部功能 › 插件 › 密钥切换」打开（Web 岛屿）；切到「网页模式」则侧栏照常有一行。'
    : '重启 DeepSeek Harness（完全退出再打开），左侧栏会出现「密钥切换」。'
}
