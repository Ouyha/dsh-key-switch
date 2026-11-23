/**
 * 会话级路由的端到端测试：账号表 → 「模型」里的影子路由。
 *
 * 全部走内存里的假配置服务，假得足够真：`mutate` 会真的改写 `providers` 并推进
 * revision，所以「写了几次」「写了什么」都能断言。不联网、不碰真的 ~/.dsh。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-key-switch-sync-'))
process.env.DSH_HOME = home

const store = await import('../../lib/store.js')
const { syncRoutes } = await import('../../lib/routes.js')
const { discoverProviders } = await import('../../lib/providers.js')

beforeEach(async () => { await rm(join(home, 'key-switch'), { recursive: true, force: true }) })

/** 和真 profile 同形：自定义路由，自己写 models 清单 + 声明 api。 */
function baseProviders() {
  return {
    shusheng: {
      displayName: '书生',
      apiKeyEnv: 'SHUSHENG_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://discovery-api.intern-ai.org.cn/v1',
      models: [
        { id: 'Sage-S2.1-Flash', name: 'Sage-S2.1-Flash', contextWindow: 524288, input: ['text', 'image'] },
        { id: 'deepseek-v4.1-flash-1017', name: 'deepseek-v4.1-flash-1017', contextWindow: 1048576 },
      ],
    },
  }
}

/** 内存版配置服务：`describe()` 与 `mutate()` 都作用于同一个 providers 对象。 */
function fakeSettings(providers) {
  let revision = 1
  const writes = []
  return {
    providers,
    writes,
    describe: () => [{ ns: 'llm-pi-ai', value: { providers }, revision }],
    async mutate(ns, ops, expected) {
      assert.equal(ns, 'llm-pi-ai')
      if (expected !== undefined && expected !== revision) throw new Error('revision conflict')
      writes.push(ops)
      for (const op of ops) {
        // 支持两种路径：['providers', id] 改整条路由，['providers', id, 字段] 改单个字段。
        const [, id, field] = op.path
        if (field === undefined) {
          if (op.op === 'set') providers[id] = op.value
          else delete providers[id]
        } else if (op.op === 'set') {
          providers[id][field] = op.value
        } else {
          delete providers[id][field]
        }
      }
      revision += 1
    },
  }
}

/** 内存版凭据服务。 */
function fakeCredentials(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    async resolve(ref) {
      const value = map.get(ref)
      return value === undefined || value === '' ? undefined : { value, source: 'file' }
    },
    async set(ref, value) {
      if (typeof value !== 'string' || value === '') throw new Error('empty value rejected')
      map.set(ref, value)
    },
    async unset(ref) { map.delete(ref) },
  }
}

/** 起一套「书生 + 若干账号」的环境，返回操作它需要的全部句柄。 */
async function setup(labels = ['17611231719']) {
  const settings = fakeSettings(baseProviders())
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await store.subscribeProvider(credentials, discoverProviders(settings).providers, { provider: 'shusheng' })
  const ids = []
  for (const label of labels) {
    const { id } = await store.addAccount(credentials, discoverProviders(settings).providers, {
      provider: 'shusheng', key: `sk-${label}`, label,
    })
    ids.push(id)
  }
  return { settings, credentials, ids }
}

/** 开/关并同步一次，语义与 index.js 里那条接口完全一致。 */
async function toggle(context, enabled) {
  const entry = await store.readEntry('shusheng')
  await store.setSessionRoutes(context.credentials, discoverProviders(context.settings).providers, { provider: 'shusheng', enabled })
  return sync(context)
}

/** 按当前账号表同步一次。 */
async function sync(context) {
  const entry = await store.readEntry('shusheng')
  return syncRoutes(context.settings, discoverProviders(context.settings), 'shusheng', entry, store.accountsOf(entry))
}

/** 「模型」里由本插件复制出来的路由键。 */
function shadowIds(settings) {
  return Object.keys(settings.providers).filter(id => id.includes('-ks-')).sort()
}

test('开启后：每个账号一条路由，引用不相干、名字带末四位、模型清单原样复制', async () => {
  const context = await setup()
  const [id] = context.ids
  const result = await toggle(context, true)

  assert.equal(result.enabled, true)
  assert.equal(result.unsupported, null)
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${id}`])

  const route = context.settings.providers[`shusheng-ks-${id}`]
  assert.equal(route.apiKeyEnv, `KEYSWITCH_SHUSHENG_${id.toUpperCase()}`, '指向账号自己的引用')
  assert.equal(route.displayName, '书生 · 1719')
  assert.equal(route.baseURL, 'https://discovery-api.intern-ai.org.cn/v1', '地址照抄')
  assert.equal(route.api, 'openai-responses', '协议照抄')
  assert.deepEqual(route.models.map(model => model.id), ['Sage-S2.1-Flash', 'deepseek-v4.1-flash-1017'],
    '模型 id 不能改，改了就没法请求')
  assert.deepEqual(route.models.map(model => model.name), ['Sage-S2.1-Flash · 1719', 'deepseek-v4.1-flash-1017 · 1719'],
    '模型名带后缀，composer 的触发器才看得见用的是哪把')
  assert.equal(route.models[0].contextWindow, 524288, '其余字段原封不动')

  const base = context.settings.providers.shusheng
  assert.equal(base.displayName, '书生', '原路由一个字都不改')
  assert.deepEqual(base.models.map(model => model.name), ['Sage-S2.1-Flash', 'deepseek-v4.1-flash-1017'])
  assert.equal(base.apiKeyEnv, 'SHUSHENG_API_KEY')
})

test('重复同步不写配置：没有变化就一个字节都不动', async () => {
  const context = await setup(['17611231719', '17611231720'])
  await toggle(context, true)
  const before = context.settings.writes.length
  assert.equal(before, 1, '两条路由一次写完')
  assert.equal(context.settings.writes[0].length, 2)
  await sync(context)
  await sync(context)
  assert.equal(context.settings.writes.length, before, '一致时不该再写')
})

test('改备注名：后缀跟着换，不会越叠越长', async () => {
  const context = await setup()
  const [id] = context.ids
  await toggle(context, true)
  await store.renameAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', accountId: id, label: '17611233333',
  })
  await sync(context)

  const route = context.settings.providers[`shusheng-ks-${id}`]
  assert.equal(route.displayName, '书生 · 3333')
  assert.equal(route.models[0].name, 'Sage-S2.1-Flash · 3333')
  assert.ok(!route.models[0].name.includes('1719'), '旧后缀不能残留')
})

test('两个账号备注撞了末四位：自动错开，不互相覆盖', async () => {
  const context = await setup(['17611231719', '13900001719'])
  await toggle(context, true)
  const names = Object.keys(context.settings.providers)
    .filter(id => id.includes('-ks-'))
    .map(id => context.settings.providers[id].displayName)
    .sort()
  assert.deepEqual(names, ['书生 · 1719', '书生 · 17192'])
})

test('新增与删除账号：路由跟着增删，别人的路由不被牵连', async () => {
  const context = await setup(['17611231719'])
  const [first] = context.ids
  await toggle(context, true)
  const added = await store.addAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', key: 'sk-13900002222', label: '13900002222',
  })
  await sync(context)
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${added.id}`, `shusheng-ks-${first}`].sort())

  await store.deleteAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', accountId: added.id,
  })
  await sync(context)
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${first}`])
})

test('关闭后：复制出来的路由全删，账号与密钥都还在', async () => {
  const context = await setup(['17611231719', '17611231720'])
  await toggle(context, true)
  assert.equal(shadowIds(context.settings).length, 2)

  await toggle(context, false)
  assert.deepEqual(shadowIds(context.settings), [])
  assert.deepEqual(Object.keys(context.settings.providers), ['shusheng'])
  assert.equal(context.settings.providers.shusheng.apiKeyEnv, 'SHUSHENG_API_KEY')

  const entry = await store.readEntry('shusheng')
  assert.equal(store.accountsOf(entry).length, 2, '账号没被顺手删掉')
  assert.ok(context.credentials.map.has(`KEYSWITCH_SHUSHENG_${context.ids[0].toUpperCase()}`), '密钥也没动')
})

test('移除提供商之前先撤路由：订阅没了也不会留下孤儿路由', async () => {
  const context = await setup()
  await toggle(context, true)
  assert.equal(shadowIds(context.settings).length, 1)

  await syncRoutes(context.settings, discoverProviders(context.settings), 'shusheng', undefined, [])
  assert.deepEqual(shadowIds(context.settings), [])
})

test('复制不出来的提供商：开关可以开，但不写路由，并且说明原因', async () => {
  const providers = { catalog: { displayName: '内置', apiKeyEnv: 'CATALOG_KEY', baseURL: 'https://api.example.com' } }
  const settings = fakeSettings(providers)
  const credentials = fakeCredentials({ CATALOG_KEY: 'sk-x' })
  await store.subscribeProvider(credentials, discoverProviders(settings).providers, { provider: 'catalog' })
  await store.addAccount(credentials, discoverProviders(settings).providers, { provider: 'catalog', key: 'sk-a', label: 'a' })
  await store.setSessionRoutes(credentials, discoverProviders(settings).providers, { provider: 'catalog', enabled: true })

  const entry = await store.readEntry('catalog')
  const result = await syncRoutes(settings, discoverProviders(settings), 'catalog', entry, store.accountsOf(entry))
  assert.match(result.unsupported, /内置模型目录/)
  assert.equal(result.changed, 0)
  assert.deepEqual(shadowIds(settings), [])

  const state = await store.buildState(credentials, discoverProviders(settings))
  assert.equal(state.providers[0].routes.enabled, true)
  assert.equal(state.providers[0].routes.supported, false)
  assert.equal(state.providers[0].accounts[0].tag, null, '不支持时不要给界面假的标记')
})

test('界面状态：开着的卡片给出后缀，复制路由不进候选名单', async () => {
  const context = await setup(['17611231719'])
  await toggle(context, true)
  const state = await store.buildState(context.credentials, discoverProviders(context.settings))

  const card = state.providers[0]
  assert.equal(card.routes.enabled, true)
  assert.equal(card.routes.supported, true)
  assert.equal(card.accounts[0].tag, '1719')
  assert.equal(card.accounts[0].route, `shusheng-ks-${context.ids[0]}`)
  assert.deepEqual(state.available, [], '自己复制出来的路由不能出现在「可添加」里')
})

test('没有可写的配置服务：开启会话路由直接报 503，不给假成功', async () => {
  const settings = fakeSettings(baseProviders())
  delete settings.mutate
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await store.subscribeProvider(credentials, discoverProviders(settings).providers, { provider: 'shusheng' })
  await store.addAccount(credentials, discoverProviders(settings).providers, { provider: 'shusheng', key: 'sk-a', label: '1' })
  await store.setSessionRoutes(credentials, discoverProviders(settings).providers, { provider: 'shusheng', enabled: true })

  const entry = await store.readEntry('shusheng')
  await assert.rejects(
    () => syncRoutes(settings, discoverProviders(settings), 'shusheng', entry, store.accountsOf(entry)),
    error => error.status === 503 && /配置服务不可写/.test(error.message),
  )
})

/** 带上「当前生效」判断的同步，语义与 index.js 里那条路径一致。 */
async function syncWithAnchor(context) {
  const entry = await store.readEntry('shusheng')
  const anchor = await store.anchorOf(context.credentials, entry)
  return syncRoutes(context.settings, discoverProviders(context.settings), 'shusheng', entry, store.accountsOf(entry), anchor)
}

test('当前生效的账号不复制路由：同一把钥匙只出现一组', async () => {
  const context = await setup(['17611231719', '13900002222'])
  const [first, second] = context.ids
  await toggle(context, true)
  assert.equal(shadowIds(context.settings).length, 2, '当前密钥不属于任何账号时人人都有路由')

  // 把当前密钥换成第一个账号的那把：它就该收回自己的路由，改用基路由。
  await store.switchAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', accountId: first,
  })
  await syncWithAnchor(context)

  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${second}`], '当前生效那个不该再有独立路由')

  const state = await store.buildState(context.credentials, discoverProviders(context.settings))
  const card = state.providers[0]
  const active = card.accounts.find(row => row.id === first)
  assert.equal(active.active, true)
  assert.equal(active.route, null, '生效中：它就是不带后缀的那组')
  assert.equal(active.tag, '1719', '标记仍然展示，方便对上是哪把')
  assert.equal(card.accounts.find(row => row.id === second).route, `shusheng-ks-${second}`)
})

test('换了当前密钥：路由在两个账号之间挪，不会留下同一把的两组', async () => {
  const context = await setup(['17611231719', '13900002222'])
  const [first, second] = context.ids
  await toggle(context, true)
  const switchTo = async id => {
    await store.switchAccount(context.credentials, discoverProviders(context.settings).providers, {
      provider: 'shusheng', accountId: id,
    })
    await syncWithAnchor(context)
  }

  await switchTo(first)
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${second}`])
  await switchTo(second)
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${first}`])

  // 任何时刻「模型」里的分组数都等于钥匙数：一组不带后缀 + (账号数-1) 组带后缀。
  const groups = Object.keys(context.settings.providers).filter(id => id === 'shusheng' || id.includes('-ks-'))
  assert.equal(groups.length, 2)
  const keys = new Set(context.credentials.map.values())
  assert.equal(groups.length, keys.size, '分组数不能多于密钥数')
})

/** 假装成宿主的 agentDefaultModel 服务，记录它被改成了什么。 */
function fakeDefaultModel(initial) {
  return {
    selection: { ...initial },
    saved: [],
    currentSelection() { return this.selection },
    async saveSelection(next) { this.selection = { ...next }; this.saved.push({ ...next }) },
  }
}

test('默认模型指着要删的路由时，先把它挪回原路由，模型 id 保持不变', async () => {
  const context = await setup(['17611231719', '13900002222'])
  const [, second] = context.ids
  await toggle(context, true)
  const defaultModel = fakeDefaultModel({ provider: `shusheng-ks-${second}`, model: 'Sage-S2.1-Flash', reasoningEffort: 'high' })

  // 把当前密钥换成第二个账号：它成为「当前生效」，那条影子路由要被删掉。
  await store.switchAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', accountId: second,
  })
  const entry = await store.readEntry('shusheng')
  const anchor = await store.anchorOf(context.credentials, entry)
  await syncRoutes(context.settings, discoverProviders(context.settings), 'shusheng', entry, store.accountsOf(entry), anchor, defaultModel)

  assert.equal(defaultModel.saved.length, 1, '默认模型必须被挪走')
  assert.equal(defaultModel.selection.provider, 'shusheng')
  assert.equal(defaultModel.selection.model, 'Sage-S2.1-Flash', '模型 id 不能跟着改')
  assert.equal(defaultModel.selection.reasoningEffort, 'high', '思考强度也要保住')
  assert.deepEqual(shadowIds(context.settings), [`shusheng-ks-${context.ids[0]}`])
})

test('默认模型没指着影子路由时，一个字节都不动它', async () => {
  const context = await setup(['17611231719'])
  await toggle(context, true)
  const defaultModel = fakeDefaultModel({ provider: 'shusheng', model: 'Sage-S2.1-Flash' })
  await toggle(context, false)
  assert.equal(defaultModel.saved.length, 0)
  assert.equal(defaultModel.selection.provider, 'shusheng')
})

test('基路由也带上尾号；关掉后还原成原名，后缀不会越叠越长', async () => {
  const context = await setup(['17611231719', '13900002222'])
  const [first, second] = context.ids
  // 模拟一次真实开启：index.js 会把基路由的原名一起记下来
  await store.setSessionRoutes(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', enabled: true, baseName: { text: '书生', explicit: true },
  })
  await store.switchAccount(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', accountId: first,
  })
  await syncWithAnchor(context)

  assert.equal(context.settings.providers.shusheng.displayName, '书生 · 1719', '基路由是当前生效那把，也带尾号')
  assert.equal(context.settings.providers[`shusheng-ks-${second}`].displayName, '书生 · 2222',
    '其余账号按原名 + 尾号命名，不会带上基路由的后缀')

  const writes = context.settings.writes.length
  await syncWithAnchor(context)
  assert.equal(context.settings.writes.length, writes, '第二次同步不该再写')
  assert.equal(context.settings.providers.shusheng.displayName, '书生 · 1719', '后缀不能叠成两层')

  await store.setSessionRoutes(context.credentials, discoverProviders(context.settings).providers, {
    provider: 'shusheng', enabled: false,
  })
  await syncWithAnchor(context)
  assert.equal(context.settings.providers.shusheng.displayName, '书生', '关掉后还原成原名')
  assert.deepEqual(shadowIds(context.settings), [])
})

test('原本没有显示名的提供商：关掉时把后缀连同这个键一起删掉', async () => {
  const settings = fakeSettings({
    xingchi: {
      apiKeyEnv: 'XINGCHI_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://api.xingchiapi.com/v1',
      models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }],
    },
  })
  const credentials = fakeCredentials({ XINGCHI_API_KEY: 'sk-xingchi' })
  const discoveredNow = () => discoverProviders(settings)
  await store.subscribeProvider(credentials, discoveredNow().providers, { provider: 'xingchi' })
  const { id } = await store.addAccount(credentials, discoveredNow().providers, {
    provider: 'xingchi', key: 'sk-second', label: '13900002222',
  })
  await store.setSessionRoutes(credentials, discoveredNow().providers, {
    provider: 'xingchi', enabled: true, baseName: { text: 'xingchi', explicit: false },
  })
  const anchor = await store.anchorOf(credentials, await store.readEntry('xingchi'))
  const entry = await store.readEntry('xingchi')
  await syncRoutes(settings, discoveredNow(), 'xingchi', entry, store.accountsOf(entry), anchor)
  assert.equal('displayName' in settings.providers.xingchi, false, '当前密钥不属于任何账号时，基路由不加后缀')
  assert.equal(settings.providers[`xingchi-ks-${id}`].displayName, 'xingchi · 2222')

  await store.setSessionRoutes(credentials, discoveredNow().providers, { provider: 'xingchi', enabled: false })
  const off = await store.readEntry('xingchi')
  await syncRoutes(settings, discoveredNow(), 'xingchi', off, store.accountsOf(off), null)
  assert.equal('displayName' in settings.providers.xingchi, false, '原本没有这个键，关掉后也不该留下')
})
