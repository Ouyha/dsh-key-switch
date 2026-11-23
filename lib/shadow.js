/**
 * 会话级路由的纯计算部分：命名、短标记、配置复制。
 *
 * 这里不碰文件、不碰服务、不引任何东西——它被两处共用：
 * - `store.js` 组装界面状态时要用同一套标记，界面和真实路由才不会对不上；
 * - `routes.js` 真正去写「模型」配置时用它做蓝本。
 * 分开放是为了避免 store 与 routes 互相 import 成环。
 * @module dsh-key-switch/shadow
 */

/** 影子路由的键中缀。 */
export const ROUTE_INFIX = '-ks-'
/** 短标记最长这么多字符：它只用来区分，不承担完整信息。 */
const MAX_TAG = 8
/** 纯数字且够长的（手机号、工号）取末四位，比整串好认。 */
const LONG_DIGITS = /^\d{6,}$/

/** 某个账号的短标记：去空白、纯数字取末四位、其余截断。 */
function baseTag(label) {
  const text = typeof label === 'string' ? label.replace(/\s+/g, '') : ''
  if (text === '') return ''
  if (LONG_DIGITS.test(text)) return text.slice(-4)
  return text.length > MAX_TAG ? text.slice(0, MAX_TAG) : text
}

/**
 * 给一组账号算短标记，保证同一条路由下互不重复。
 * 顺序与账号列表一致，所以加删账号不会让前面的标记乱跳。
 * @param accounts - 账号元数据数组。
 * @returns `Map<账号 id, 标记>`；没有备注名的账号得到空串。
 */
export function tagsFor(accounts) {
  const used = new Set()
  const tags = new Map()
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const base = baseTag(account?.label)
    let tag = base
    if (tag !== '') {
      let n = 2
      while (used.has(tag)) {
        tag = `${base}${n}`
        n += 1
      }
      used.add(tag)
    }
    tags.set(account?.id, tag)
  }
  return tags
}

/** 影子路由的路由键。 */
export function routeIdFor(providerId, accountId) {
  return `${providerId}${ROUTE_INFIX}${accountId}`
}

/** 这个路由键是不是从某个提供商复制出来的。 */
export function isRouteIdOf(providerId, routeId) {
  return typeof routeId === 'string' && routeId.startsWith(`${providerId}${ROUTE_INFIX}`)
}

/**
 * 这条提供商能不能复制。
 * 只有「自己写了 models 清单 + 声明了 api」的路由才能复制：换一个路由键就等于
 * 换了一个引擎不认识的提供商，内置模型目录补不上它的协议和模型清单。
 * @param profile - 「模型」里的原始配置。
 * @returns 不能复制时的原因，能复制则 null。
 */
export function routesUnsupported(profile) {
  if (profile === null || typeof profile !== 'object') return '读不到「模型」里这个提供商的配置'
  if (!Array.isArray(profile.models) || profile.models.length === 0) {
    return '这个提供商用的是内置模型目录，没有可复制的模型清单，暂不支持会话级路由'
  }
  if (typeof profile.api !== 'string' || profile.api === '') {
    return '这个提供商没有声明协议（api），复制出来的路由跑不起来'
  }
  return null
}

/** 在模型名后面缀上短标记；没有标记就原样返回。 */
function namedWith(name, tag) {
  const text = typeof name === 'string' ? name : ''
  if (text === '' || tag === '') return text
  return `${text} · ${tag}`
}

/** 一条模型条目的副本，名字带标记。 */
function cloneModel(model, tag) {
  const copy = JSON.parse(JSON.stringify(model))
  const name = typeof copy.name === 'string' && copy.name !== '' ? copy.name : String(copy.id ?? '')
  copy.name = namedWith(name, tag)
  return copy
}

/**
 * 把原路由的配置整段复制一份，只换密钥引用、显示名、模型名。
 * @param profile - 原路由的配置。
 * @param options - 密钥引用、显示名、短标记。
 * @returns 可以直接写进 `providers` 的一份新配置。
 */
export function shadowProfile(profile, options) {
  const copy = JSON.parse(JSON.stringify(profile))
  copy.apiKeyEnv = options.ref
  copy.displayName = options.displayName
  copy.models = (Array.isArray(profile.models) ? profile.models : []).map(model => cloneModel(model, options.tag))
  return copy
}

/** 键序无关的 JSON，用来判断「配置要不要重写」——不重写就不会触发引擎重载。 */
export function stableJson(value) {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
