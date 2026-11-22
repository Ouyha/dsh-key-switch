import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, beforeEach, test } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-key-switch-routes-'))
process.env.DSH_HOME = home

const { apply } = await import('../lib/index.js')

/** 内存版凭据服务。 */
function fakeCredentials(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    async resolve(ref) {
      const value = map.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async set(ref, value) {
      map.set(ref, value)
    },
    async unset(ref) {
      map.delete(ref)
    },
  }
}

/** 内存版配置服务：`describe()` 的形状与宿主一致。 */
function fakeSettings(providers) {
  return { describe: () => [{ ns: 'llm-pi-ai', value: { providers } }] }
}

const CONFIGURED = {
  shusheng: { displayName: '书生', apiKeyEnv: 'SHUSHENG_API_KEY', baseURL: 'https://discovery-api.intern-ai.org.cn/v1' },
  xingchi: { displayName: '星辰', apiKeyEnv: 'XINGCHI_API_KEY', baseURL: 'https://api.xingchiapi.com/v1' },
}

/** 把插件注册的路由挂到真 HTTP 服务上，端到端跑一遍守卫与 JSON 契约。 */
async function boot(options = {}) {
  const credentials = 'credentials' in options ? options.credentials : fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  const settings = 'settings' in options ? options.settings : fakeSettings(CONFIGURED)
  const table = new Map()
  const ctx = {
    webServer: {
      register(route) {
        table.set(route.path, route)
        return () => table.delete(route.path)
      },
    },
    get(name) {
      if (name === 'credentials') return credentials
      if (name === 'settings') return settings
      return undefined
    },
  }
  const dispose = apply(ctx)
  const server = createServer(async (request, response) => {
    const route = table.get(new URL(request.url, 'http://placeholder').pathname)
    if (route === undefined) {
      response.statusCode = 404
      response.end('no route')
      return
    }
    await route.handler(request, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    credentials,
    settings,
    table,
    origin: `http://127.0.0.1:${server.address().port}`,
    dispose,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

let app
beforeEach(async () => {
  await rm(join(home, 'key-switch'), { recursive: true, force: true })
  app = await boot()
})
afterEach(async () => { await app.close() })
after(async () => { await rm(home, { recursive: true, force: true }) })

const TRUST = { 'x-dsh-key-switch': '1' }
const post = (path, body, headers = TRUST) => fetch(`${app.origin}${path}`, {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

test('没有标记头的请求一律 403：写密钥的接口不对其他来源开口', async () => {
  const response = await fetch(`${app.origin}/api/dsh-key-switch/state`)
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'key-switch/forbidden')
})

test('跨站发起的请求也挡住（sec-fetch-site: cross-site）', async () => {
  const response = await fetch(`${app.origin}/api/dsh-key-switch/state`, {
    headers: { ...TRUST, 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(response.status, 403)
})

test('一打开是空的：没有卡片，候选里才是「模型」里的提供商', async () => {
  const response = await fetch(`${app.origin}/api/dsh-key-switch/state`, { headers: TRUST })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.state.providers, [])
  assert.deepEqual(body.state.available.map(item => item.id), ['shusheng', 'xingchi'])
  assert.equal(body.state.reason, null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('添加提供商后才有卡片，候选里少一个', async () => {
  const added = await (await post('/api/dsh-key-switch/add-provider', { provider: 'shusheng' })).json()
  assert.equal(added.ok, true)
  assert.deepEqual(added.state.providers.map(item => item.id), ['shusheng'])
  assert.deepEqual(added.state.available.map(item => item.id), ['xingchi'])
  assert.equal(added.state.providers[0].claiming, true)
})

test('移除提供商只影响插件：卡片没了，但 settings 里的配置一个字没动', async () => {
  await post('/api/dsh-key-switch/add-provider', { provider: 'shusheng' })
  const account = (await (await post('/api/dsh-key-switch/accounts', { provider: 'shusheng', key: 'sk-account-2222' })).json())
    .state.providers[0].accounts[0]
  const before = JSON.stringify(app.settings.describe())

  const removed = await (await post('/api/dsh-key-switch/remove-provider', { provider: 'shusheng' })).json()
  assert.deepEqual(removed.state.providers, [])
  assert.equal(app.credentials.map.has(`KEYSWITCH_SHUSHENG_${account.id.toUpperCase()}`), false)
  assert.equal(JSON.stringify(app.settings.describe()), before, '不该碰「模型」的配置')
})

test('「模型」里删掉提供商后，已添加的卡片标记 unavailable，而不是消失', async () => {
  await post('/api/dsh-key-switch/add-provider', { provider: 'shusheng' })
  const shrunk = await boot({ settings: fakeSettings({ xingchi: CONFIGURED.xingchi }) })
  try {
    // 用同一份状态文件：DSH_HOME 没变，so 订阅还在
    const response = await fetch(`${shrunk.origin}/api/dsh-key-switch/state`, { headers: TRUST })
    const body = await response.json()
    assert.deepEqual(body.state.providers.map(item => item.id), ['shusheng'])
    assert.equal(body.state.providers[0].available, false)
    assert.deepEqual(body.state.available.map(item => item.id), ['xingchi'])
  } finally {
    shrunk.dispose()
    await shrunk.close()
  }
})

test('新增 → 切换 → 删除：一次往返就带回最新状态', async () => {
  await post('/api/dsh-key-switch/add-provider', { provider: 'shusheng' })
  const added = await (await post('/api/dsh-key-switch/accounts', { provider: 'shusheng', label: '小号', key: 'sk-account-1111' })).json()
  assert.equal(added.ok, true)
  const account = added.state.providers[0].accounts[0]
  assert.equal(account.label, '小号')
  assert.equal(account.active, false)

  const switched = await (await post('/api/dsh-key-switch/switch', { provider: 'shusheng', accountId: account.id })).json()
  assert.equal(switched.state.providers[0].accounts[0].active, true)
  assert.equal(app.credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-1111')

  const deleted = await (await post('/api/dsh-key-switch/delete', { provider: 'shusheng', accountId: account.id })).json()
  assert.equal(deleted.state.providers[0].accounts.length, 0)
  assert.equal(app.credentials.map.has(`KEYSWITCH_SHUSHENG_${account.id.toUpperCase()}`), false)
})

test('错误映射：未知提供商 404、坏密钥 400、坏 JSON 400', async () => {
  const unknown = await post('/api/dsh-key-switch/accounts', { provider: 'nope', key: 'sk-1' })
  assert.equal(unknown.status, 404)
  assert.match((await unknown.json()).error.message, /先在上面添加它/)

  const notInConfig = await post('/api/dsh-key-switch/add-provider', { provider: 'nope' })
  assert.equal(notInConfig.status, 404)

  await post('/api/dsh-key-switch/add-provider', { provider: 'shusheng' })
  const badKey = await post('/api/dsh-key-switch/accounts', { provider: 'shusheng', key: 'has space' })
  assert.equal(badKey.status, 400)
  assert.match((await badKey.json()).error.message, /ASCII/)

  const badJson = await fetch(`${app.origin}/api/dsh-key-switch/accounts`, {
    method: 'POST', headers: { ...TRUST, 'content-type': 'application/json' }, body: '{oops',
  })
  assert.equal(badJson.status, 400)
  assert.equal((await badJson.json()).ok, false)
})

test('凭据服务缺位时报 503 并说清缺哪个插件', async () => {
  const bare = await boot({ credentials: undefined })
  try {
    const response = await fetch(`${bare.origin}/api/dsh-key-switch/state`, { headers: TRUST })
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.error.code, 'key-switch/no-credentials')
    assert.match(body.error.message, /credentials-local/)
  } finally {
    bare.dispose()
    await bare.close()
  }
})

test('配置服务缺位时不报错，而是回空清单加原因', async () => {
  const bare = await boot({ settings: undefined })
  try {
    const response = await fetch(`${bare.origin}/api/dsh-key-switch/state`, { headers: TRUST })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.state.providers, [])
    assert.equal(body.state.reason, 'settings-unavailable')
  } finally {
    bare.dispose()
    await bare.close()
  }
})

test('卸载后路由全部撤销，重复卸载不抛错', async () => {
  app.dispose()
  app.dispose()
  assert.equal(app.table.size, 0)
  const gone = await fetch(`${app.origin}/api/dsh-key-switch/state`, { headers: TRUST })
  assert.equal(gone.status, 404)
})
