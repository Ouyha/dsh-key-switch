import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-key-switch-test-'))
process.env.DSH_HOME = home

const store = await import('../lib/store.js')

beforeEach(async () => { await rm(join(home, 'key-switch'), { recursive: true, force: true }) })

/** 「模型」配置里的提供商；测试里直接给，不去碰 harness。 */
const discovered = [
  { id: 'shusheng', label: '书生', ref: 'SHUSHENG_API_KEY', hint: 'discovery-api.intern-ai.org.cn' },
  { id: 'xingchi', label: 'xingchi', ref: 'XINGCHI_API_KEY', hint: 'api.xingchiapi.com' },
]

/** 一个只存在内存里的凭据服务，行为对齐 dsh-credentials-local 的引用半。 */
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

/** 先订阅书生，绝大多数用例的起点。 */
async function withShusheng(credentials) {
  await store.subscribeProvider(credentials, discovered, { provider: 'shusheng' })
}

test('空状态：一张卡片都没有，但候选里能看到「模型」里的两个提供商', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  const state = await store.buildState(credentials, discovered)
  assert.deepEqual(state.providers, [])
  assert.deepEqual(state.available.map(item => item.id), ['shusheng', 'xingchi'])
})

test('订阅之后只列订阅的那一个，候选里就不再出现它', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const state = await store.buildState(credentials, discovered)
  assert.deepEqual(state.providers.map(item => item.id), ['shusheng'])
  assert.equal(state.providers[0].label, '书生')
  assert.equal(state.providers[0].available, true)
  assert.equal(state.providers[0].claiming, true)
  assert.deepEqual(state.available.map(item => item.id), ['xingchi'])
})

test('订阅是幂等的；订阅一个配置里没有的提供商直接 404', async () => {
  const credentials = fakeCredentials()
  await withShusheng(credentials)
  const again = await store.subscribeProvider(credentials, discovered, { provider: 'shusheng' })
  assert.equal(again.already, true)
  await assert.rejects(
    () => store.subscribeProvider(credentials, discovered, { provider: 'nope' }),
    error => error.status === 404,
  )
})

test('「模型」里删掉提供商后，订阅还在、账号还在，只是标记 unavailable', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-aaaa', label: '大号' })
  const state = await store.buildState(credentials, [])
  const card = state.providers[0]
  assert.equal(card.available, false)
  assert.equal(card.label, '书生', '显示名用订阅时记下的快照')
  assert.equal(card.ref, 'SHUSHENG_API_KEY', '引用也用快照，账号仍然可切换')
  assert.equal(card.accounts[0].id, id)
  // 配置里已经没了，也能切回去
  await store.switchAccount(credentials, [], { provider: 'shusheng', accountId: id })
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-aaaa')
})

test('移除提供商：卡片消失、账号密钥引用清掉，但提供商正在用的那把不动', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-bbbb' })
  await store.switchAccount(credentials, discovered, { provider: 'shusheng', accountId: id })
  await store.unsubscribeProvider(credentials, { provider: 'shusheng' })

  assert.equal(credentials.map.has(`KEYSWITCH_SHUSHENG_${id.toUpperCase()}`), false)
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-bbbb', '当前生效的密钥不该被移除动作带走')
  const state = await store.buildState(credentials, discovered)
  assert.deepEqual(state.providers, [])
  assert.deepEqual(state.available.map(item => item.id), ['shusheng', 'xingchi'])
})

test('移除一个没订阅的提供商报 404', async () => {
  const credentials = fakeCredentials()
  await assert.rejects(() => store.unsubscribeProvider(credentials, { provider: 'shusheng' }), error => error.status === 404)
})

test('新增账号：密钥写进独立引用，元数据落盘', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-aaaa', label: '大号' })
  const ref = `KEYSWITCH_SHUSHENG_${id.toUpperCase()}`
  assert.equal(credentials.map.get(ref), 'sk-account-aaaa')

  const doc = JSON.parse(await readFile(join(home, 'key-switch', 'state.json'), 'utf8'))
  assert.equal(doc.providers.shusheng.accounts[0].label, '大号')
  assert.equal(doc.providers.shusheng.accounts[0].ref, ref)
  assert.equal(doc.providers.shusheng.ref, 'SHUSHENG_API_KEY', '订阅里记了引用快照')

  const state = await store.buildState(credentials, discovered)
  const card = state.providers[0]
  assert.equal(card.accounts.length, 1)
  assert.equal(card.accounts[0].active, false, '新加的账号不该自动变成当前使用中')
  assert.equal(card.claiming, true, '当前密钥没归属任何账号，应提示可以存为账号')
})

test('切换账号：把选中那把复制成提供商的当前密钥', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-bbbb' })
  await store.switchAccount(credentials, discovered, { provider: 'shusheng', accountId: id })
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-bbbb')

  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts.find(row => row.id === id).active, true)
  assert.equal(state.providers[0].claiming, false)
  assert.equal(state.providers[0].current.masked, store.maskSecret('sk-account-bbbb'))
})

test('在模型页手动改过密钥后，界面不会谎报使用中', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-cccc' })
  await store.switchAccount(credentials, discovered, { provider: 'shusheng', accountId: id })
  credentials.map.set('SHUSHENG_API_KEY', 'sk-typed-by-hand')
  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts[0].active, false)
  assert.equal(state.providers[0].claiming, true)
})

test('删除账号：密钥引用与元数据一起清掉，且不影响当前生效的密钥', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-dddd' })
  await store.switchAccount(credentials, discovered, { provider: 'shusheng', accountId: id })
  await store.deleteAccount(credentials, discovered, { provider: 'shusheng', accountId: id })
  assert.equal(credentials.map.has(`KEYSWITCH_SHUSHENG_${id.toUpperCase()}`), false)
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-dddd', '删账号不该把正在用的密钥抽走')
  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts.length, 0)
})

test('收编当前密钥：不会重复添加同一把', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const first = await store.adoptCurrent(credentials, discovered, { provider: 'shusheng' })
  const second = await store.adoptCurrent(credentials, discovered, { provider: 'shusheng' })
  assert.equal(first.id, second.id)
  assert.equal(second.already, true)
  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts.length, 1)
  assert.equal(state.providers[0].accounts[0].active, true)
})

test('密钥校验：空值、空格、非 ASCII 一律拒绝', async () => {
  const credentials = fakeCredentials()
  await withShusheng(credentials)
  await assert.rejects(() => store.addAccount(credentials, discovered, { provider: 'shusheng', key: '' }), /请填写/)
  await assert.rejects(() => store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk a' }), /ASCII/)
  await assert.rejects(() => store.addAccount(credentials, discovered, { provider: 'shusheng', key: '密钥' }), /ASCII/)
})

test('没订阅的提供商不能直接加账号', async () => {
  const credentials = fakeCredentials()
  await assert.rejects(
    () => store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-1' }),
    error => error.status === 404 && /先在上面添加它/.test(error.message),
  )
})

test('备注名可以改，空名被拒', async () => {
  const credentials = fakeCredentials()
  await withShusheng(credentials)
  const { id } = await store.addAccount(credentials, discovered, { provider: 'shusheng', key: 'sk-account-eeee' })
  await store.renameAccount(credentials, discovered, { provider: 'shusheng', accountId: id, label: '备用号' })
  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts[0].label, '备用号')
  await assert.rejects(
    () => store.renameAccount(credentials, discovered, { provider: 'shusheng', accountId: id, label: '  ' }),
    /不能为空/,
  )
})

test('状态文件损坏时不影响使用：留一份现场再重来', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await mkdir(join(home, 'key-switch'), { recursive: true })
  await writeFile(join(home, 'key-switch', 'state.json'), '{ this is not json', 'utf8')
  const state = await store.buildState(credentials, discovered)
  assert.deepEqual(state.providers, [])
  await withShusheng(credentials)
  assert.deepEqual((await store.buildState(credentials, discovered)).providers.map(item => item.id), ['shusheng'])
})

test('旧版把提供商标成 slots 的状态文件能直接读，并按订阅处理', async () => {
  const credentials = fakeCredentials({
    SHUSHENG_API_KEY: 'sk-current-0001',
    KEYSWITCH_SHUSHENG_ABC12345: 'sk-old',
  })
  await mkdir(join(home, 'key-switch'), { recursive: true })
  await writeFile(join(home, 'key-switch', 'state.json'), JSON.stringify({
    version: 1,
    slots: { shusheng: { accounts: [{ id: 'abc12345', label: '老账号', ref: 'KEYSWITCH_SHUSHENG_ABC12345' }] } },
  }), 'utf8')
  const state = await store.buildState(credentials, discovered)
  assert.equal(state.providers[0].accounts[0].label, '老账号')
  assert.equal(state.providers[0].available, true)
})

test('凭据服务缺失时给出可读的 503', async () => {
  await assert.rejects(() => store.buildState(undefined, discovered), error => {
    assert.equal(error.status, 503)
    assert.match(error.message, /credentials-local/)
    return true
  })
})

test('掩码只露头尾', () => {
  assert.equal(store.maskSecret('sk-demo-abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345'), 'sk-demo······2345')
  assert.equal(store.maskSecret('short'), 'sho…')
  assert.equal(store.maskSecret(undefined), null)
})

test('中等长度的密钥不会露出大半：只留前 4 后 2', () => {
  assert.equal(store.maskSecret('sk-account-bbbb'), 'sk-a…bb')
  assert.equal(store.maskSecret('1234567890123'), '1234…23')
})

test('状态文件被改坏、账号引用了提供商的键时，删除不会误删那把正在用的密钥', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const file = join(home, 'key-switch', 'state.json')
  const doc = JSON.parse(await readFile(file, 'utf8'))
  doc.providers.shusheng.accounts = [{ id: 'deadbeef', label: '坏数据', ref: 'SHUSHENG_API_KEY' }]
  await writeFile(file, JSON.stringify(doc), 'utf8')

  await store.deleteAccount(credentials, discovered, { provider: 'shusheng', accountId: 'deadbeef' })
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-current-0001', '不该 unset 不是本插件写的引用')
})

test('移除订阅时同样只清理本插件自己的引用', async () => {
  const credentials = fakeCredentials({ SHUSHENG_API_KEY: 'sk-current-0001' })
  await withShusheng(credentials)
  const file = join(home, 'key-switch', 'state.json')
  const doc = JSON.parse(await readFile(file, 'utf8'))
  doc.providers.shusheng.accounts = [{ id: 'deadbeef', label: '坏数据', ref: 'SHUSHENG_API_KEY' }]
  await writeFile(file, JSON.stringify(doc), 'utf8')

  await store.unsubscribeProvider(credentials, { provider: 'shusheng' })
  assert.equal(credentials.map.get('SHUSHENG_API_KEY'), 'sk-current-0001')
})
