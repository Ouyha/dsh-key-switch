/**
 * 会话级路由：把「一个账号一把 Key」落成「一条 provider 路由」。
 *
 * 为什么需要这一层
 * - 密钥是绑在路由上的：`providers.<路由>.apiKeyEnv` 每次请求都会被重新解析，
 *   但那个引用名是写死的，解析时也拿不到「这是哪个会话」。所以只要所有对话共用
 *   一条路由，它们就必然共用一把 Key——谁点「切换」全体跟着变。
 * - 模型选择却是**会话级**的（`session.selectModel` 记住 provider + model + effort）。
 *   于是把每个账号复制成一条独立路由，选路由就等于选密钥：不同对话选不同分组，
 *   各走各的 Key，互不影响，也不用重启。
 *
 * 写入走 `ctx.settings.mutate`，和「模型」设置页保存是同一条路：只改 `providers`
 * 这一个 volatile 字段，改完引擎自己热重载路由。
 *
 * 只写真正有变化的条目——每次写入都会让引擎重载路由，能省则省。
 * @module dsh-key-switch/routes
 */

import { isRouteIdOf, routeIdFor, routesUnsupported, shadowProfile, stableJson, tagsFor } from './shadow.js'
import { KeySwitchError } from './store.js'

/**
 * 默认模型不能悬在一条马上要被删掉的路由上：删之前先把它挪回原路由。
 * 读不到或写不进都不拦着清理——默认模型失效只是「新对话要重选」，比留着孤儿路由干净。
 * @param defaultModel - `ctx.agentDefaultModel`（可缺省）。
 * @param doomed - 即将被删掉的路由键。
 * @param providerId - 要挪回去的原路由键。
 */
async function repointDefault(defaultModel, doomed, providerId) {
  if (defaultModel === null || defaultModel === undefined) return
  if (typeof defaultModel.currentSelection !== 'function' || typeof defaultModel.saveSelection !== 'function') return
  try {
    const current = defaultModel.currentSelection()
    if (current === null || typeof current !== 'object') return
    if (!doomed.includes(current.provider)) return
    await defaultModel.saveSelection({ ...current, provider: providerId })
  } catch {
    // 默认模型这一层自己管自己，失败不该挡住路由清理。
  }
}

/**
 * 让「模型」里的影子路由与账号表对齐。
 *
 * 三种情况：
 * - 订阅开着：除「当前生效」那个账号外，每个账号一条路由，名字带标记；
 *   当前生效的那把不复制——它的钥匙就是基路由正在用的，再复制一条就是同一把钥匙两个分组；
 * - 订阅关掉、或提供商从「模型」里消失：删掉它名下的影子路由（只删自己造的键）；
 * - 已经一致：一个字节都不写。
 *
 * @param settings - `ctx.settings`（可缺省）。
 * @param discovered - `discoverProviders()` 的结果，用于读原配置与现有影子路由。
 * @param providerId - 原路由键。
 * @param entry - 这一页里的订阅（可缺省；缺省表示该清理）。
 * @param accounts - 订阅名下的账号数组。
 * @param anchorId - 当前生效的账号 id：它不复制路由（可缺省）。
 * @param defaultModel - `ctx.agentDefaultModel`：删路由前把默认模型挪回原路由（可缺省）。
 * @returns `{ enabled, unsupported, changed, tags }`。
 * @throws {KeySwitchError} 需要写入但没有可写的配置服务，或写入被拒。
 */
export async function syncRoutes(settings, discovered, providerId, entry, accounts, anchorId = null, defaultModel = null) {
  const sources = Array.isArray(discovered?.sources) ? discovered.sources : []
  const base = sources.find(item => item.id === providerId)
  const live = sources.filter(item => item.shadow === true && isRouteIdOf(providerId, item.id))
  const enabled = entry !== null && entry !== undefined && entry.routes === true
  const unsupported = enabled ? routesUnsupported(base?.profile) : null
  // 开启时记下的原名。基路由一旦被加上后缀，就不能再拿它的显示名当蓝本，
  // 否则每次同步都会在名字后面再叠一层「· 1719」。
  const baseName = entry?.baseName !== null && entry?.baseName !== undefined && typeof entry.baseName.text === 'string'
    && entry.baseName.text !== '' ? entry.baseName : null
  const cleanLabel = baseName?.text ?? base?.label ?? providerId
  const table = tagsFor(accounts)

  const wanted = new Map()
  const tags = new Map()
  if (enabled && unsupported === null) {
    for (const account of accounts) {
      if (typeof account?.ref !== 'string' || account.ref === '') continue
      // 当前生效的那个账号直接用基路由，不复制：否则同一把钥匙会出现两个分组。
      if (anchorId !== null && account.id === anchorId) continue
      const tag = table.get(account.id) ?? ''
      tags.set(account.id, tag)
      wanted.set(routeIdFor(providerId, account.id), shadowProfile(base.profile, {
        ref: account.ref,
        displayName: tag === '' ? cleanLabel : `${cleanLabel} · ${tag}`,
        tag,
      }))
    }
  }

  const ops = []
  for (const [id, profile] of wanted) {
    const current = live.find(item => item.id === id)
    if (current !== undefined && stableJson(current.profile) === stableJson(profile)) continue
    ops.push({ op: 'set', path: ['providers', id], value: profile })
  }
  for (const current of live) {
    if (!wanted.has(current.id)) ops.push({ op: 'unset', path: ['providers', current.id] })
  }

  // 基路由也带上尾号：否则模型框里会有一组不带后缀，看不出是哪把。
  // 关掉开关时按开启时记下的原样还原（原来是显式写的就写回去，原本没有就去掉）。
  if (base !== undefined) {
    const currentName = typeof base.profile.displayName === 'string' ? base.profile.displayName : undefined
    if (enabled && unsupported === null && baseName !== null && anchorId !== null) {
      const tag = table.get(anchorId) ?? ''
      const wantedName = tag === '' ? cleanLabel : `${cleanLabel} · ${tag}`
      if (tag !== '' && currentName !== wantedName) {
        ops.push({ op: 'set', path: ['providers', providerId, 'displayName'], value: wantedName })
      } else if (tag === '' && currentName !== undefined && currentName !== cleanLabel) {
        ops.push({ op: 'set', path: ['providers', providerId, 'displayName'], value: cleanLabel })
      }
    } else if (!enabled && baseName !== null) {
      if (baseName.explicit === true) {
        if (currentName !== baseName.text) {
          ops.push({ op: 'set', path: ['providers', providerId, 'displayName'], value: baseName.text })
        }
      } else if (currentName !== undefined) {
        ops.push({ op: 'unset', path: ['providers', providerId, 'displayName'] })
      }
    }
  }

  const result = { enabled, unsupported, changed: 0, tags }
  if (ops.length === 0) return result

  // 先安顿默认模型，再动路由：反过来的话中间会有一瞬「默认模型指向一条不存在的路由」。
  await repointDefault(defaultModel, ops.filter(op => op.op === 'unset').map(op => op.path[1]), providerId)

  const ns = base?.ns ?? live[0]?.ns
  if (typeof ns !== 'string' || ns === '') {
    throw new KeySwitchError(503, '找不到可写的配置表：settings 里没有这个提供商的条目', 'key-switch/no-settings')
  }
  if (settings === null || settings === undefined || typeof settings.mutate !== 'function') {
    throw new KeySwitchError(
      503,
      '配置服务不可写：当前组合没有挂载可编辑的 settings，没法把会话路由写进「模型」',
      'key-switch/no-settings',
    )
  }
  // 带上读到的 revision：期间别人改过配置就让这次写入失败，而不是盖掉它。
  const expected = base?.ns === ns && Number.isInteger(base?.revision) ? base.revision : undefined
  try {
    await settings.mutate(ns, ops, expected)
  } catch (error) {
    throw new KeySwitchError(500, `写入会话路由失败：${error?.message ?? error}`)
  }
  result.changed = ops.length
  return result
}
