/**
 * 更新检测：读 GitHub 默认分支上的 package.json，和本地版本比一下。
 *
 * 为什么读 raw 而不是 GitHub Releases：本插件不强制每次发版都建 Release，
 * raw 永远能拿到默认分支的版本；代价是“main 上 bump 了但还没打 tag”时会提前提示。
 * 请求走宿主进程的全局 fetch；如果 Harness 启动时配了代理，dsh-http-proxy 会把
 * undici 的全局 dispatcher 换掉，这里不用额外处理代理。
 * @module dsh-key-switch/update
 */

import { repositoryUrl } from './meta.js'
import { KeySwitchError } from './store.js'
import { compareVersions } from './version.js'

/** 请求上限：检查更新是锦上添花，不该让页面等太久。 */
const TIMEOUT_MS = 8000

/** 只在支持 AbortSignal.timeout 的运行时上加超时。 */
function timeoutSignal() {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(TIMEOUT_MS)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 检查远端是否有更新的版本。
 * @param {object} options - 参数。
 * @param {string} options.version - 本地版本。
 * @param {{ owner: string, name: string } | null} options.repository - 仓库坐标。
 * @param {typeof fetch} [options.fetchImpl] - 测试可注入的 fetch。
 * @returns {Promise<object>} `{ configured, current, latest, relation, hasUpdate, url }`。
 * @throws {KeySwitchError} 网络失败、HTTP 错误或远端版本非法。
 */
export async function checkForUpdate({ version, repository, fetchImpl = globalThis.fetch } = {}) {
  if (repository === null || repository === undefined) return { configured: false }
  if (typeof fetchImpl !== 'function') {
    throw new KeySwitchError(503, '当前环境没有可用的 fetch，无法检查更新', 'key-switch/update-unavailable')
  }

  const raw = `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/HEAD/package.json`
  let response
  try {
    response = await fetchImpl(raw, {
      headers: {
        accept: 'application/json',
        'user-agent': `dsh-key-switch/${version ?? '0.0.0'}`,
      },
      signal: timeoutSignal(),
    })
  } catch (error) {
    throw new KeySwitchError(
      502,
      `连不上 GitHub（${error?.message ?? error}）。如果网络需要代理，请给 Harness 配置代理后重启再试。`,
      'key-switch/update-offline',
    )
  }

  if (response?.ok !== true) {
    throw new KeySwitchError(
      502,
      `GitHub 返回 HTTP ${response?.status ?? '未知'}，暂时无法检查更新`,
      'key-switch/update-http',
    )
  }

  let remote
  try {
    remote = await response.json()
  } catch {
    throw new KeySwitchError(502, 'GitHub 上的 package.json 无法解析', 'key-switch/update-json')
  }

  const latest = typeof remote?.version === 'string' ? remote.version : null
  const relation = compareVersions(latest, version)
  if (latest === null || relation === null) {
    throw new KeySwitchError(502, 'GitHub 上的 package.json 里没有合法的版本号', 'key-switch/update-version')
  }

  return {
    configured: true,
    current: version,
    latest,
    relation,
    hasUpdate: relation > 0,
    url: repositoryUrl(repository),
  }
}
