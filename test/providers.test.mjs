import assert from 'node:assert/strict'
import { test } from 'node:test'

const { discoverProviders, hostOf, providerOf } = await import('../lib/providers.js')

/** 造一个和宿主 `ctx.settings.describe()` 同形的描述表。 */
function settingsWith(value) {
  return { describe: () => [{ ns: 'llm-pi-ai', value }] }
}

test('只收「配了 apiKeyEnv」的提供商，OAuth 之类的一律跳过', () => {
  const { providers, reason } = discoverProviders(settingsWith({
    providers: {
      shusheng: { displayName: '书生', apiKeyEnv: 'SHUSHENG_API_KEY', baseURL: 'https://discovery-api.intern-ai.org.cn/v1' },
      xingchi: { displayName: '星辰', apiKeyEnv: 'XINGCHI_API_KEY', baseURL: 'https://api.xingchiapi.com/v1' },
      deepseek: { displayName: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
      'oauth-thing': { displayName: 'OAuth', nativeAuth: { oauth: true } },
    },
  }))
  assert.equal(reason, null)
  assert.deepEqual(providers.map(item => item.id), ['shusheng', 'xingchi'])
  assert.deepEqual(providers[0], {
    id: 'shusheng', label: '书生', ref: 'SHUSHENG_API_KEY', hint: 'discovery-api.intern-ai.org.cn',
  })
})

test('没写 displayName 时退回路由键，baseURL 不合法就留空', () => {
  const { providers } = discoverProviders(settingsWith({
    providers: { myGateway: { apiKeyEnv: 'MY_GATEWAY_KEY', baseURL: 'not a url' } },
  }))
  assert.deepEqual(providers, [{ id: 'myGateway', label: 'myGateway', ref: 'MY_GATEWAY_KEY', hint: null }])
})

test('引用名不合法、配置不是对象的条目直接跳过，不猜', () => {
  const { providers } = discoverProviders(settingsWith({
    providers: {
      bad: { apiKeyEnv: 'not-a-ref' },
      empty: { apiKeyEnv: '' },
      notObject: 'shusheng',
      good: { apiKeyEnv: 'GOOD_KEY' },
    },
  }))
  assert.deepEqual(providers.map(item => item.id), ['good'])
})

test('同一路由只出现一次，顺序按配置里的顺序', () => {
  const settings = {
    describe: () => [
      { ns: 'llm-pi-ai', value: { providers: { b: { apiKeyEnv: 'B_KEY' } } } },
      { ns: 'llm-pi-ai', value: { providers: { a: { apiKeyEnv: 'A_KEY' }, b: { apiKeyEnv: 'B_KEY' } } } },
    ],
  }
  assert.deepEqual(discoverProviders(settings).providers.map(item => item.id), ['b', 'a'])
})

test('多张表单一起扫：哪个插件里配了 providers 就收哪个', () => {
  const settings = {
    describe: () => [
      { ns: 'ui-theme', value: { preference: 'system' } },
      { ns: 'llm-pi-ai', value: { providers: { a: { apiKeyEnv: 'A_KEY' } } } },
    ],
  }
  assert.deepEqual(discoverProviders(settings).providers.map(item => item.id), ['a'])
})

test('没有 settings 服务 / describe 抛错时给出原因，而不是假装没有提供商', () => {
  assert.equal(discoverProviders(undefined).reason, 'settings-unavailable')
  assert.equal(discoverProviders(null).reason, 'settings-unavailable')
  assert.equal(discoverProviders({ describe() { throw new Error('boom') } }).reason, 'describe-failed')
  assert.equal(discoverProviders({ describe: () => null }).reason, 'describe-failed')
  assert.deepEqual(discoverProviders({ describe: () => [] }).providers, [])
})

test('providerOf 与 hostOf 的边界', () => {
  assert.equal(providerOf('', { apiKeyEnv: 'X' }), undefined)
  assert.equal(providerOf('a', null), undefined)
  assert.equal(providerOf('a', { apiKeyEnv: 42 }), undefined)
  assert.equal(hostOf('https://api.example.com/v1'), 'api.example.com')
  assert.equal(hostOf(''), null)
  assert.equal(hostOf(undefined), null)
})
