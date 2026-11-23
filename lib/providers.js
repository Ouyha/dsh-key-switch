/**
 * 提供商发现：「这一页该列谁」不再由插件猜，而是从 DSH 的实时配置里读。
 *
 * 读法：`ctx.settings.describe()` 会给出每个已激活插件的表单值。模型适配器（llm-pi-ai 一类）
 * 的配置里有一张 `providers` 表，每个路由的 `apiKeyEnv` 就是它读密钥用的引用。
 * 只收「配了 apiKeyEnv」的路由——没有这个字段的提供商（OAuth 登录、或者把密钥存在
 * credential record 里的）不是靠某个环境引用取密钥的，换引用对它没有意义。
 *
 * 这么做的好处：用户在「模型」里新增/删除提供商，这一页自动跟着变，
 * 插件里不再有一份会和真实配置跑偏的硬编码名单。
 *
 * 三类结果分开返回：
 * - `providers`：能订阅的提供商（候选与卡片都用它）；
 * - `shadow`：本插件自己复制出来的会话路由（引用名以 `KEYSWITCH_` 开头），
 *   它们是「一个账号一条路由」的产物，不能出现在候选里，也不能被当成用户的路由；
 * - `sources`：每条路由的原始配置与所在的表单（`ns` / `revision` / `profile`），
 *   复制路由时要拿它做蓝本，写回时要拿它定位表单。
 * @module dsh-key-switch/providers
 */

/** 引用名与环境变量同名：`[A-Za-z_][A-Za-z0-9_]*`。 */
const REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** 本插件给账号分配的引用前缀。带这个前缀的路由一定是自己复制出来的。 */
const SHADOW_REF = /^KEYSWITCH_/

/** 普通对象判定。 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从 baseURL 里取主机名，取不到就留空。 */
export function hostOf(baseURL) {
  if (typeof baseURL !== 'string' || baseURL.trim() === '') return null
  try {
    return new URL(baseURL.trim()).host
  } catch {
    return null
  }
}

/**
 * 读出一份提供商的显示信息。
 * @param id - 路由键，例如 `shusheng`。
 * @param profile - 该路由的配置对象。
 * @returns 展示用的一条，或 undefined（这个路由不是靠引用取密钥的）。
 */
export function providerOf(id, profile) {
  if (typeof id !== 'string' || id === '') return undefined
  if (!isRecord(profile)) return undefined
  const ref = profile.apiKeyEnv
  if (typeof ref !== 'string' || !REF_NAME.test(ref)) return undefined
  const name = typeof profile.displayName === 'string' ? profile.displayName.trim() : ''
  return { id, label: name !== '' ? name : id, ref, hint: hostOf(profile.baseURL) }
}

/**
 * 扫一遍所有已激活插件的表单值，收出「配了 API Key 引用」的提供商。
 * @param settings - `ctx.settings`（可缺省）。
 * @returns `{ providers, shadow, sources, reason }`；`reason` 为空表示读到了配置。
 */
export function discoverProviders(settings) {
  if (settings === undefined || settings === null) {
    return { providers: [], shadow: [], sources: [], reason: 'settings-unavailable' }
  }
  let descriptors
  try {
    descriptors = settings.describe()
  } catch {
    return { providers: [], shadow: [], sources: [], reason: 'describe-failed' }
  }
  if (!Array.isArray(descriptors)) {
    return { providers: [], shadow: [], sources: [], reason: 'describe-failed' }
  }
  const providers = []
  const shadow = []
  const sources = []
  const seen = new Set()
  for (const descriptor of descriptors) {
    const value = descriptor?.value
    if (!isRecord(value) || !isRecord(value.providers)) continue
    const ns = typeof descriptor?.ns === 'string' ? descriptor.ns : null
    const revision = Number.isInteger(descriptor?.revision) ? descriptor.revision : undefined
    for (const [id, profile] of Object.entries(value.providers)) {
      const provider = providerOf(id, profile)
      if (provider === undefined || seen.has(provider.id)) continue
      seen.add(provider.id)
      const isShadow = SHADOW_REF.test(provider.ref)
      if (isShadow) shadow.push(provider)
      else providers.push(provider)
      sources.push({ id: provider.id, label: provider.label, ns, revision, profile, shadow: isShadow })
    }
  }
  return { providers, shadow, sources, reason: null }
}
