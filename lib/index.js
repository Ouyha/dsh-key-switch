/**
 * dsh-key-switch — Host 半。
 *
 * 三件事：注册几条本机 HTTP 路由、校验调用来自本机同源页面、把请求转给账号仓库。
 * 提供商清单每次请求都从 DSH 的实时配置里重新发现，所以「模型」页加了或删了提供商，
 * 这一页立刻跟着变。
 *
 * 不引第三方依赖，也不引 `@deepseek-ai/*`：所需服务（`webServer`、`credentials`、`settings`）
 * 都从 cordis 上下文上取，插件在 profile 的 node_modules 里是自足的。
 * @module dsh-key-switch
 */

import { REPOSITORY, VERSION, rawPackageUrl, repositoryUrl } from './meta.js'
import { discoverProviders } from './providers.js'
import { syncRoutes } from './routes.js'
import {
  KeySwitchError, accountsOf, addAccount, adoptCurrent, anchorOf, buildState, deleteAccount, readEntry,
  renameAccount, setSessionRoutes, subscribeProvider, switchAccount, unsubscribeProvider,
} from './store.js'
import { checkForUpdate } from './update.js'

/** 路由前缀。 */
const PREFIX = '/api/dsh-key-switch'
/** 只有带上这个头的请求才认，配合同源校验挡住跨站表单与随手 curl。 */
const TRUSTED_HEADER = 'x-dsh-key-switch'
/** 一个请求体最多这么多字节：这里只有备注名和密钥。 */
const MAX_BODY = 8 * 1024

/** 需要宿主提供的服务；`credentials` / `settings` 走 `ctx.get`，缺了也只影响单次请求。 */
export const inject = ['webServer']

/** 取请求头里的单值。 */
function header(request, name) {
  const value = request.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/** 本机地址判定。 */
function isLoopback(value) {
  const address = typeof value === 'string' ? value.toLowerCase().replace(/^\[|\]$/g, '') : ''
  return address === 'localhost' || address === 'localhost.'
    || address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/**
 * 这条路由只服务「本机页面自己发起的同源请求」：
 * 自带标记头 + 连接来自回环地址 + `sec-fetch-site` 不是跨站 + Host/Origin 一致。
 * 少任何一条都拒绝——写密钥的接口不该给别的来源留口子。
 */
function isTrusted(request) {
  if (header(request, TRUSTED_HEADER) !== '1') return false
  if (!isLoopback(request.socket?.remoteAddress)) return false
  const site = header(request, 'sec-fetch-site')
  if (site !== undefined && site !== 'same-origin') return false
  const host = header(request, 'host')
  if (host === undefined || host === '') return false
  const origin = header(request, 'origin')
  if (origin === undefined || origin === '') {
    try {
      return isLoopback(new URL(`http://${host}`).hostname)
    } catch {
      return false
    }
  }
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopback(url.hostname) && url.host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

/** 写一个 JSON 响应；路由自己拥有整个响应生命周期。 */
function sendJson(response, status, body) {
  if (response.headersSent) return
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.end(JSON.stringify(body))
}

/** 读一个小 JSON 请求体。 */
async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new KeySwitchError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('not an object')
    return value
  } catch {
    throw new KeySwitchError(400, '请求体不是合法的 JSON 对象')
  }
}

/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @returns 卸载函数：撤销全部路由。
 */
export function apply(ctx) {
  const disposers = []

  /** 每次请求现读一次提供商清单：读的永远是当前配置，不是启动时的快照。 */
  const providersNow = () => discoverProviders(ctx.get('settings'))
  /** 配置服务：既能读也能写，写会话路由走它。 */
  const settingsNow = () => ctx.get('settings')

  /**
   * 一条订阅开了「会话级路由」时，把它名下的账号同步成「模型」里的影子路由。
   * 没开、或已经一致时一个字节都不写——每次写都会让引擎重载路由。
   * @param credentials - `ctx.credentials`：要拿它判断「当前生效」是哪个账号。
   * @param providerId - 原路由键。
   */
  const syncProviderRoutes = async (credentials, providerId) => {
    let entry = await readEntry(providerId)
    // 自愈：开关开着但没记过原名（老版本留下的状态），补记一次，好让基路由也能带上尾号。
    if (entry !== undefined && entry.routes === true && entry.baseName === undefined) {
      const discovery = providersNow()
      const source = discovery.sources.find(item => item.id === providerId)
      if (source !== undefined) {
        await setSessionRoutes(credentials, discovery.providers, {
          provider: providerId,
          enabled: true,
          baseName: { text: source.label, explicit: typeof source.profile?.displayName === 'string' },
        })
        entry = await readEntry(providerId)
      }
    }
    const accounts = entry === undefined ? [] : accountsOf(entry)
    const anchor = await anchorOf(credentials, entry)
    await syncRoutes(settingsNow(), providersNow(), providerId, entry, accounts, anchor, ctx.get('agentDefaultModel'))
  }

  /**
   * 撤掉某个提供商名下的全部影子路由（不管订阅还在不在）。
   * 只删本插件造的键，用户自己配的路由与密钥一概不碰。
   * @param providerId - 原路由键。
   */
  const pruneProviderRoutes = async providerId => {
    // 传一份「开关已关」的订阅进去，好让同步顺手把基路由的显示名还原。
    const entry = await readEntry(providerId)
    const off = entry === undefined ? undefined : { ...entry, routes: false }
    await syncRoutes(settingsNow(), providersNow(), providerId, off, [], null, ctx.get('agentDefaultModel'))
  }

  /**
   * 包一条路由的公共部分：来源校验、错误映射、日志。
   * @param path - 前缀之后的路径段。
   * @param handler - 拿到请求体后返回响应体的函数。
   */
  const route = (path, handler) => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/${path}`,
      handler: async (request, response) => {
        try {
          if (!isTrusted(request)) {
            sendJson(response, 403, {
              ok: false,
              error: { code: 'key-switch/forbidden', message: '该接口只接受本机 Harness 页面发起的同源请求' },
            })
            return
          }
          const payload = await handler({ request, credentials: ctx.get('credentials') })
          sendJson(response, 200, { ok: true, ...payload })
        } catch (error) {
          const known = error instanceof KeySwitchError
          const status = known ? error.status : 500
          const message = error instanceof Error ? error.message : String(error)
          if (!known || status >= 500) console.error(`[dsh-key-switch] ${request.method} ${request.url}: ${message}`)
          sendJson(response, status, {
            ok: false,
            error: { code: known ? error.code : 'key-switch/internal', message },
          })
        }
      },
    })
    disposers.push(() => { try { dispose() } catch { /* 已经撤销过 */ } })
  }

  /** 统一的响应体：一份最新状态，外加界面要展示的版本与仓库地址。 */
  const stateOf = async credentials => {
    const discovery = providersNow()
    return {
      state: await buildState(credentials, discovery, discovery.reason),
      version: VERSION,
      repo: repositoryUrl(REPOSITORY),
      source: rawPackageUrl(REPOSITORY),
    }
  }

  route('state', async ({ credentials }) => stateOf(credentials))

  route('update', async () => ({
    update: await checkForUpdate({ version: VERSION, repository: REPOSITORY }),
  }))

  route('add-provider', async ({ request, credentials }) => {
    const body = await readJson(request)
    await subscribeProvider(credentials, providersNow().providers, { provider: body.provider })
    return stateOf(credentials)
  })

  route('remove-provider', async ({ request, credentials }) => {
    const body = await readJson(request)
    // 先撤影子路由，再删订阅：万一写配置失败，这一页的状态还是完整的，可以重试。
    await pruneProviderRoutes(body.provider)
    await unsubscribeProvider(credentials, { provider: body.provider })
    return stateOf(credentials)
  })

  route('accounts', async ({ request, credentials }) => {
    const body = await readJson(request)
    await addAccount(credentials, providersNow().providers, { provider: body.provider, label: body.label, key: body.key })
    // 账号表变了，影子路由跟着变（这条订阅没开会话路由时这里什么都不做）。
    await syncProviderRoutes(credentials, body.provider)
    return stateOf(credentials)
  })

  route('switch', async ({ request, credentials }) => {
    const body = await readJson(request)
    await switchAccount(credentials, providersNow().providers, { provider: body.provider, accountId: body.accountId })
    // 换了当前密钥，「当前生效」的账号就变了：影子路由要跟着挪一条。
    await syncProviderRoutes(credentials, body.provider)
    return stateOf(credentials)
  })

  route('rename', async ({ request, credentials }) => {
    const body = await readJson(request)
    await renameAccount(credentials, providersNow().providers, {
      provider: body.provider, accountId: body.accountId, label: body.label,
    })
    // 备注名决定模型框里的后缀，改了就得重写一遍。
    await syncProviderRoutes(credentials, body.provider)
    return stateOf(credentials)
  })

  route('delete', async ({ request, credentials }) => {
    const body = await readJson(request)
    await deleteAccount(credentials, providersNow().providers, { provider: body.provider, accountId: body.accountId })
    await syncProviderRoutes(credentials, body.provider)
    return stateOf(credentials)
  })

  route('adopt', async ({ request, credentials }) => {
    const body = await readJson(request)
    await adoptCurrent(credentials, providersNow().providers, { provider: body.provider })
    await syncProviderRoutes(credentials, body.provider)
    return stateOf(credentials)
  })

  /**
   * 开关「会话级路由」：一条订阅 -> 每个账号一条「模型」里的路由。
   * 开启时记下基路由原本的显示名（关掉时还原），写不进配置就把开关回滚，
   * 不留一个骗人的状态。
   */
  route('session-routes', async ({ request, credentials }) => {
    const body = await readJson(request)
    const enabled = body.enabled === true
    const entry = await readEntry(body.provider)
    const discovery = providersNow()
    const source = discovery.sources.find(item => item.id === body.provider)
    // 已经有记录就沿用（那才是真正的原名），否则从当前配置里读一次。
    const remembered = entry?.baseName
    const baseName = remembered !== undefined && typeof remembered.text === 'string' && remembered.text !== ''
      ? remembered
      : source === undefined
        ? null
        : { text: source.label, explicit: typeof source.profile?.displayName === 'string' }
    await setSessionRoutes(credentials, discovery.providers, { provider: body.provider, enabled, baseName })
    try {
      await syncProviderRoutes(credentials, body.provider)
    } catch (error) {
      await setSessionRoutes(credentials, providersNow().providers, { provider: body.provider, enabled: !enabled })
        .catch(() => undefined)
      throw error
    }
    return stateOf(credentials)
  })

  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
