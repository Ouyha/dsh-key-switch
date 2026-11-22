import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { join, resolve } from 'node:path'

const {
  PACKAGE, detectDshGo, dshHomeOf, entryHint, hostLabel, profileOf, resolveTarget, stageOf,
} = await import('../../tools/target.mjs')

/** 用一份路径集合冒充文件系统。 */
function fsOf(...paths) {
  const set = new Set(paths.map(item => resolve(item)))
  return value => set.has(resolve(value))
}

const HOME = resolve('/home/u')
const DSH_HOME = join(HOME, '.dsh')

test('DSH Go：认 ~/.dsh/dsh-go，落到 web profile', () => {
  const target = resolveTarget({
    env: {}, home: HOME, exists: fsOf(join(DSH_HOME, 'dsh-go'), profileOf(DSH_HOME, 'web')),
  })
  assert.equal(target.host, 'dsh-go')
  assert.equal(target.profileName, 'web')
  assert.equal(target.profileDir, profileOf(DSH_HOME, 'web'))
  assert.equal(target.auto, true)
  assert.match(target.reason, /dsh-go/)
})

test('DSH Go：连 App 的 /opt/dsh-go 也认，不靠 profile 猜', () => {
  const target = resolveTarget({ env: {}, home: HOME, exists: fsOf('/opt/dsh-go') })
  assert.equal(target.host, 'dsh-go')
  assert.equal(target.profileDir, profileOf(DSH_HOME, 'web'))
})

test('桌面版：有 desktop profile 就用它', () => {
  const target = resolveTarget({ env: {}, home: HOME, exists: fsOf(profileOf(DSH_HOME, 'desktop')) })
  assert.equal(target.host, 'desktop')
  assert.equal(target.profileName, 'desktop')
  assert.equal(target.auto, true)
})

test('只有一个 web profile（PC 上只用 dsh web）也跟着它走', () => {
  const target = resolveTarget({ env: {}, home: HOME, exists: fsOf(profileOf(DSH_HOME, 'web')) })
  assert.equal(target.host, 'dsh-web')
  assert.equal(target.profileName, 'web')
})

test('什么都没装过：按桌面版默认值，不硬猜 web', () => {
  const target = resolveTarget({ env: {}, home: HOME, exists: fsOf() })
  assert.equal(target.host, 'desktop')
  assert.equal(target.profileName, 'desktop')
  assert.match(target.reason, /没找到/)
})

test('DSH_HOME 优先于 ~/.dsh', () => {
  const custom = resolve('/data/dsh')
  const target = resolveTarget({ env: { DSH_HOME: custom }, home: HOME, exists: fsOf(join(custom, 'dsh-go')) })
  assert.equal(target.dshHome, custom)
  assert.equal(target.profileDir, profileOf(custom, 'web'))
})

test('--profile 传名字：当 profile 名拼到 DSH_HOME 下', () => {
  const target = resolveTarget({
    argv: ['--profile', 'staging'], env: {}, home: HOME, exists: fsOf(join(DSH_HOME, 'dsh-go')),
  })
  assert.equal(target.auto, false)
  assert.equal(target.profileName, 'staging')
  assert.equal(target.profileDir, profileOf(DSH_HOME, 'staging'))
})

test('--profile 传目录：原样使用，host 仍能认出手机版', () => {
  const dir = resolve('/tmp/some-profile')
  const target = resolveTarget({ argv: ['--profile', dir], env: {}, home: HOME, exists: fsOf(join(DSH_HOME, 'dsh-go')) })
  assert.equal(target.profileDir, dir)
  assert.equal(target.profileName, 'some-profile')
  assert.equal(target.host, 'dsh-go')
})

test('--dsh-go / --desktop 强制覆盖自动判定', () => {
  const go = resolveTarget({ argv: ['--dsh-go'], env: {}, home: HOME, exists: fsOf(profileOf(DSH_HOME, 'desktop')) })
  assert.equal(go.host, 'dsh-go')
  assert.equal(go.profileDir, profileOf(DSH_HOME, 'web'))

  const desktop = resolveTarget({ argv: ['--desktop'], env: {}, home: HOME, exists: fsOf(join(DSH_HOME, 'dsh-go')) })
  assert.equal(desktop.host, 'desktop')
  assert.equal(desktop.profileDir, profileOf(DSH_HOME, 'desktop'))
})

test('detectDshGo 没命中时给 null，不抛错', () => {
  assert.equal(detectDshGo(DSH_HOME, fsOf(), []), null)
})

test('源码目录与提示文案跟着环境走', () => {
  assert.equal(stageOf(DSH_HOME), join(DSH_HOME, 'dsh-go', 'plugins', PACKAGE))
  assert.match(entryHint({ host: 'dsh-go' }), /全部功能/)
  assert.match(entryHint({ host: 'desktop' }), /左侧栏/)
  assert.match(hostLabel('dsh-go'), /DSH Go/)
})

// 宿主启动时按 engines.dsh（没有则看 @deepseek-ai peer）判断兼容性，不满足就把整层 patch
// 从 profile 里剔掉——插件不会加载，也不会有显眼报错。这个上限曾经写成 <0.3.0-0，
// 于是手机上（引擎更新）整个插件被静默跳过，只能去「设置 › 插件」放行才出现。
test('manifest 不带会把整个插件判成不兼容的版本门槛', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(
    manifest.engines?.dsh, undefined,
    'engines.dsh 一旦写死上限，新引擎会整包跳过插件；要限版本请在 README 说明，别写死在 manifest 里',
  )
  const dshPeers = Object.keys(manifest.peerDependencies ?? {})
    .filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.deepEqual(dshPeers, [], '没有 engines.dsh 时宿主改用 @deepseek-ai peer 判兼容，同样会跳过插件')
  assert.equal(manifest.engines?.node !== undefined, true, 'Node 版本门槛要留着，安装脚本靠它')
})
