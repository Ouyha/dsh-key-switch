/**
 * 客户端 bundle 的端到端测试：用一份最小 React 运行时把它真正渲染出来，
 * 让页面、按钮和取数都跑在真实的 HTTP 路由上。不装 jsdom，也不引入依赖。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import vm from 'node:vm'

const home = await mkdtemp(join(tmpdir(), 'dsh-key-switch-client-'))
process.env.DSH_HOME = home
const { apply } = await import('../../lib/index.js')

/** 只会这几件事的 React：状态、副作用、回调缓存、引用。 */
function miniReact() {
  let instance = null
  let dirty = false

  function createElement(type, props, ...children) {
    const flat = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: { ...(props ?? {}), children: flat }, key: props?.key }
  }

  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))

  function hook(init) {
    const box = instance.hooks[instance.index] ?? (instance.hooks[instance.index] = { value: init })
    instance.index += 1
    return box
  }

  function useState(init) {
    const box = hook(init)
    return [box.value, next => {
      box.value = typeof next === 'function' ? next(box.value) : next
      dirty = true
    }]
  }
  function useRef(init) {
    const box = hook(undefined)
    // 和真 React 一样返回 { current }，而不是把 ref 包在 hook 盒子里。
    if (box.value === undefined) box.value = { current: init }
    return box.value
  }
  function useCallback(fn, deps) {
    if (instance.hooks[instance.index] === undefined) {
      instance.hooks[instance.index] = { value: { fn, deps } }
      instance.index += 1
      return fn
    }
    const box = instance.hooks[instance.index]
    instance.index += 1
    if (!same(box.value.deps, deps)) box.value = { fn, deps }
    return box.value.fn
  }
  function useEffect(fn, deps) { instance.effects.push({ fn, deps }) }

  /** 渲染到稳定：跑副作用、吃 setState，最多 20 轮。 */
  async function render(Component) {
    let tree = null
    for (let round = 0; round < 20; round += 1) {
      dirty = false
      instance.index = 0
      instance.effects = []
      instance.cleanups = instance.cleanups ?? []
      tree = Component({})
      for (const [index, effect] of instance.effects.entries()) {
        const previous = instance.cleanups[index]
        if (previous !== undefined && same(previous.deps, effect.deps)) continue
        previous?.fn?.()
        instance.cleanups[index] = { deps: effect.deps, fn: effect.fn() }
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))
      if (!dirty) break
    }
    return tree
  }

  /** 挂载一次，返回可反复调用的渲染器（状态在实例上累积）。 */
  function mount(Component) {
    instance = { hooks: [], effects: [], cleanups: [], index: 0 }
    return () => render(Component)
  }

  return { createElement, useState, useRef, useCallback, useEffect, mount }
}

/** 深度优先找出所有满足条件的元素。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) findAll(item, predicate, out); return out }
  if (predicate(node)) out.push(node)
  findAll(node.props?.children, predicate, out)
  return out
}

/** 把一棵树里的文字拼起来，便于断言。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

/** 等一轮网络往返。 */
const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms))

/** 画到数据落地：先渲染，再轮询到「读取中…」消失（最多 3 秒）。 */
async function paint(render) {
  await render()
  const deadline = Date.now() + 3000
  let tree = await render()
  while (textOf(tree).includes('读取中…') && Date.now() < deadline) {
    await settle(50)
    tree = await render()
  }
  return tree
}
const buttons = (tree, label) => findAll(tree, node => node.type === 'button' && textOf(node) === label)

/** 每个用例开始时把假凭据存储恢复成「只有一个当前密钥」的样子。 */
const SEED = 'sk-test-0000000000000000000000000000000000000000000000000000000000000000'

let app
beforeEach(async () => {
  await rm(join(home, 'key-switch'), { recursive: true, force: true })
  if (app !== undefined) {
    app.credentials.map.clear()
    app.credentials.map.set('SHUSHENG_API_KEY', SEED)
  }
})

before(async () => {
  const table = new Map()
  const map = new Map([['SHUSHENG_API_KEY', SEED]])
  const credentials = {
    map,
    async resolve(ref) { const value = map.get(ref); return value === undefined ? undefined : { value, source: 'file' } },
    async set(ref, value) { map.set(ref, value) },
    async unset(ref) { map.delete(ref) },
  }
  // 「模型」里的两个提供商，形状与宿主 ctx.settings.describe() 一致
  const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {
    shusheng: { displayName: '书生', apiKeyEnv: 'SHUSHENG_API_KEY', baseURL: 'https://discovery-api.intern-ai.org.cn/v1' },
    xingchi: { displayName: '星辰', apiKeyEnv: 'XINGCHI_API_KEY', baseURL: 'https://api.xingchiapi.com/v1' },
  } } }] }
  const dispose = apply({
    webServer: { register(route) { table.set(route.path, route); return () => table.delete(route.path) } },
    get: name => {
      if (name === 'credentials') return credentials
      if (name === 'settings') return settings
      return undefined
    },
  }, {})
  const server = createServer(async (request, response) => {
    const route = table.get(new URL(request.url, 'http://placeholder').pathname)
    if (route === undefined) { response.statusCode = 404; response.end('no route'); return }
    await route.handler(request, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  app = { credentials, settings, server, dispose, origin: `http://127.0.0.1:${server.address().port}` }
})

after(async () => {
  app.dispose()
  await new Promise(resolve => app.server.close(resolve))
  await rm(home, { recursive: true, force: true })
})

/** 载入 bundle，返回导出与渲染器工厂。`windowExtra` 用来伪造宿主窗口（手机宽度、屏幕尺寸）。 */
async function loadBundle(origin = app.origin, windowExtra = {}) {
  const code = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let captured = null
  const sandbox = {
    window: { ...windowExtra, __ModuleLoader__: { load: module => { captured = module } } },
    document: { baseURI: `${origin}/` },
    fetch: (...args) => fetch(...args),
    console,
    setTimeout,
    clearTimeout,
    URL,
    JSON,
  }
  vm.runInNewContext(code, sandbox, { filename: 'lib/client.js' })
  assert.ok(captured !== null, '客户端 bundle 必须通过 __ModuleLoader__.load 注册自己')
  assert.equal(captured.id, 'dsh-key-switch')
  const react = miniReact()
  const exports = captured.factory(name => {
    if (name === 'react') return react
    throw new Error(`bundle 请求了未提供的模块：${name}`)
  })
  return { exports, react }
}

/** 起一个只服务本用例的宿主：用来模拟「模型」里没有可用提供商的配置。 */
async function bootWith(providers) {
  const table = new Map()
  const map = new Map([['SHUSHENG_API_KEY', SEED]])
  const credentials = {
    map,
    async resolve(ref) { const value = map.get(ref); return value === undefined ? undefined : { value, source: 'file' } },
    async set(ref, value) { map.set(ref, value) },
    async unset(ref) { map.delete(ref) },
  }
  // 配置服务：`mutate` 真的改写 providers，会话路由的开关才有地方落。
  let revision = 1
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', value: { providers }, revision }],
    async mutate(ns, ops) {
      for (const op of ops) {
        // ['providers', id] 改整条路由；['providers', id, 字段] 只改一个字段（基路由改名走这条）。
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
  const dispose = apply({
    webServer: { register(route) { table.set(route.path, route); return () => table.delete(route.path) } },
    get: name => name === 'credentials' ? credentials : name === 'settings' ? settings : undefined,
  }, {})
  const server = createServer(async (request, response) => {
    const route = table.get(new URL(request.url, 'http://placeholder').pathname)
    if (route === undefined) { response.statusCode = 404; response.end('no route'); return }
    await route.handler(request, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    providers,
    close: async () => { dispose(); await new Promise(resolve => server.close(resolve)) },
  }
}

/** 注册侧栏入口与主面板，取回页面组件。 */
function mountPage(exports, react) {
  let Component = null
  exports.apply({
    effect: fn => fn(),
    slots: {
      inject: (name, cb) => cb(),
      register: (options, component) => {
        if (options.name === 'main') Component = component
        return () => {}
      },
    },
  })
  assert.ok(Component !== null)
  return react.mount(Component)
}

test('bundle 契约：导出 apply 与 inject，在左侧栏注册入口并挂上主面板', async () => {
  const { exports } = await loadBundle()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual([...exports.inject], ['slots'])

  const registered = []
  const injected = []
  exports.apply({
    effect: fn => fn(),
    slots: {
      inject(name, cb) { injected.push(name); return cb() },
      register(options, Component) { registered.push({ options, Component }); return () => {} },
    },
  })

  assert.deepEqual(injected.sort(), ['main', 'sidebar.panellist'])

  const panel = registered.find(entry => entry.options.name === 'main')
  assert.equal(panel.options.key, 'key-switch')
  assert.equal(typeof panel.Component, 'function')

  const row = registered.find(entry => entry.options.name === 'sidebar.panellist')
  assert.equal(row.options.id, 'key-switch')
  assert.equal(row.options.order, 15)
  assert.equal(row.options.label(), '密钥切换')
  assert.equal(typeof row.Component, 'function')

  const icon = row.Component({ size: 18, active: true })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 18)
  assert.equal(icon.props.height, 18)
  assert.equal(icon.props['aria-hidden'], 'true')
})

/** 从页面里把书生加进来：点「+ 添加提供商」→ 点候选第一行的「添加」。 */
async function addShusheng(render) {
  let tree = await paint(render)
  buttons(tree, '+ 添加提供商')[0].props.onClick()
  tree = await paint(render)
  buttons(tree, '添加')[0].props.onClick()
  await settle()
  return paint(render)
}

test('打开时是空的：只给添加引导，不把「模型」里的提供商全铺出来', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  const tree = await paint(render)
  const text = textOf(tree)
  assert.match(text, /还没有添加提供商/)
  assert.match(text, /不会把「模型」里的配置全部铺出来/)
  assert.match(text, /v\d+\.\d+\.\d+/, '标题旁要显示版本号')
  assert.equal(buttons(await render(), '+ 添加提供商').length, 1, '空页只该有一个添加入口')
  assert.equal(buttons(await render(), '检查更新').length, 1, '页脚要有手动检查更新入口')
  assert.doesNotMatch(text, /SHUSHENG_API_KEY/, '未添加前不该出现提供商卡片')
})

test('点「+ 添加提供商」列出候选，选一个加进来才出现卡片', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  let tree = await paint(render)

  buttons(tree, '+ 添加提供商')[0].props.onClick()
  tree = await paint(render)
  const picker = textOf(tree)
  assert.match(picker, /从「模型」里选一个用 API Key 认证的提供商/)
  assert.match(picker, /书生/)
  // 行内显示 API 地址（同名提供商靠它区分），引用名放在 title 里，悬停可见。
  assert.match(picker, /discovery-api\.intern-ai\.org\.cn/)
  const rowTitle = findAll(
    tree,
    node => node.type === 'div' && typeof node.props?.title === 'string' && node.props.title.includes('SHUSHENG_API_KEY'),
  )
  assert.equal(rowTitle.length, 1, '候选行的 title 里要带引用名，便于确认换的是哪一把')

  buttons(tree, '添加')[0].props.onClick()
  await settle()
  tree = await paint(render)
  const text = textOf(tree)
  assert.match(text, /书生/)
  assert.match(text, /存为账号/)
  assert.match(text, /sk-test······0000/)
  assert.doesNotMatch(text, /从「模型」里选一个用 API Key 认证的提供商/, '添加完候选面板应当收起来')
})

test('点「存为账号」把当前密钥收编，状态变成「使用中」', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  const tree = await addShusheng(render)

  const adopt = buttons(tree, '存为账号')
  assert.equal(adopt.length, 1)
  adopt[0].props.onClick()
  await settle()

  const after = textOf(await render())
  assert.match(after, /使用中/)
  assert.doesNotMatch(after, /存为账号/)
})

test('添加账号并切换：当前密钥换成新账号那把，旧钥匙仍然留着', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  let tree = await addShusheng(render)

  buttons(tree, '+ 添加账号')[0].props.onClick()
  tree = await render()
  let inputs = findAll(tree, node => node.type === 'input')
  assert.equal(inputs.length, 2)
  inputs[0].props.onChange({ target: { value: '小号' } })

  tree = await render()
  inputs = findAll(tree, node => node.type === 'input')
  inputs[1].props.onChange({ target: { value: 'sk-account-9999' } })

  tree = await render()
  const save = buttons(tree, '保存')[0]
  assert.equal(save.props.type, 'submit', '保存按钮必须能触发表单提交（回车同样有效）')
  findAll(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} })
  await settle()

  const accountRef = [...app.credentials.map.keys()].find(key => key.startsWith('KEYSWITCH_SHUSHENG_'))
  assert.ok(accountRef !== undefined, '新账号的密钥应当写进独立引用')
  assert.equal(app.credentials.map.get(accountRef), 'sk-account-9999')
  assert.match(textOf(await render()), /小号/)

  buttons(await render(), '切换')[0].props.onClick()
  await settle()
  assert.equal(app.credentials.map.get('SHUSHENG_API_KEY'), 'sk-account-9999')
  assert.equal(app.credentials.map.get(accountRef), 'sk-account-9999', '切换不该把账号自己的那把删掉')
  assert.match(textOf(await render()), /使用中/)
})

test('删除账号要二次确认，删掉后账号从列表消失', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  let tree = await addShusheng(render)

  buttons(tree, '存为账号')[0].props.onClick()
  await settle()
  tree = await render()
  assert.equal(buttons(tree, '删除').length, 1)
  buttons(tree, '删除')[0].props.onClick()
  tree = await render()
  assert.equal(buttons(tree, '确认删除').length, 1)

  buttons(tree, '确认删除')[0].props.onClick()
  await settle()
  assert.equal(buttons(await render(), '删除').length, 0)
})

test('移除提供商要二次确认，确认后卡片消失、回到空页，且不碰「模型」配置', async () => {
  const { exports, react } = await loadBundle()
  const render = mountPage(exports, react)
  let tree = await addShusheng(render)
  const before = JSON.stringify(app.settings.describe())

  buttons(tree, '移除')[0].props.onClick()
  tree = await render()
  const confirmText = textOf(tree)
  assert.match(confirmText, /只从这个页面移除/)
  assert.match(confirmText, /不动「模型」里的配置/)

  buttons(tree, '确认移除')[0].props.onClick()
  await settle()
  const after = textOf(await render())
  assert.match(after, /还没有添加提供商/)
  assert.equal(JSON.stringify(app.settings.describe()), before)
})

test('配置里没有用 API Key 的提供商时，候选面板说清楚去哪儿加', async () => {
  const host = await bootWith({ deepseek: { displayName: 'DeepSeek', baseURL: 'https://api.deepseek.com' } })
  try {
    const { exports, react } = await loadBundle(host.origin)
    const render = mountPage(exports, react)
    let tree = await paint(render)
    buttons(tree, '+ 添加提供商')[0].props.onClick()
    tree = await paint(render)
    assert.match(textOf(tree), /没有还能添加的提供商/)
    assert.match(textOf(tree), /「模型」/)
  } finally {
    await host.close()
  }
})

test('Host 连不上 GitHub 时，页面用浏览器网络再查一次（走系统代理）', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const text = String(url)
    if (text.startsWith('https://raw.githubusercontent.com/')) {
      return { ok: true, status: 200, async json() { return { version: '9.9.9' } } }
    }
    if (text.startsWith('http://127.0.0.1:')) return original(url, init)
    throw new Error('offline')
  }
  try {
    const { exports, react } = await loadBundle()
    const render = mountPage(exports, react)
    let tree = await paint(render)
    buttons(tree, '检查更新')[0].props.onClick()
    await settle(400)
    tree = await render()
    assert.match(textOf(tree), /有新版本 v9\.9\.9/)
  } finally {
    globalThis.fetch = original
  }
})

test('会话路由：只给「不是当前生效」的账号复制路由，卡片说明怎么用', async () => {
  const host = await bootWith({
    shusheng: {
      displayName: '书生',
      apiKeyEnv: 'SHUSHENG_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://discovery-api.intern-ai.org.cn/v1',
      models: [{ id: 'Sage-S2.1-Flash', name: 'Sage-S2.1-Flash', contextWindow: 524288 }],
    },
  })
  try {
    const { exports, react } = await loadBundle(host.origin)
    const render = mountPage(exports, react)
    let tree = await paint(render)
    buttons(tree, '+ 添加提供商')[0].props.onClick()
    tree = await paint(render)
    buttons(tree, '添加')[0].props.onClick()
    await settle()
    tree = await paint(render)

    // 先把当前密钥收编成账号 —— 它的 key 与基路由相同，所以不该再复制一条。
    buttons(tree, '存为账号')[0].props.onClick()
    await settle()
    tree = await paint(render)

    // 再加一个钥匙不同的账号，它才需要自己的路由。
    buttons(tree, '+ 添加账号')[0].props.onClick()
    tree = await render()
    let inputs = findAll(tree, node => node.type === 'input')
    inputs[0].props.onChange({ target: { value: '小号' } })
    tree = await render()
    inputs = findAll(tree, node => node.type === 'input')
    inputs[1].props.onChange({ target: { value: 'sk-second-0001' } })
    tree = await render()
    findAll(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} })
    await settle()
    tree = await paint(render)

    assert.equal(buttons(tree, '会话路由').length, 1, '能复制的提供商要有开关')
    buttons(tree, '会话路由')[0].props.onClick()
    await settle()
    tree = await paint(render)

    const text = textOf(tree)
    assert.match(text, /会话路由已开启/)
    assert.match(text, /共 2 组，全部带尾号/, '模型框里不该再有「不带后缀」那组')
    assert.match(text, /「书生 · 账号1」就是新对话默认用的那把/)
    assert.equal(host.providers.shusheng.displayName, '书生 · 账号1', '基路由也要带上尾号')
    assert.equal(buttons(tree, '会话路由 · 开').length, 1, '开着的状态要看得出来')

    // 只有「小号」这一条影子路由；当前生效那个账号直接用基路由。
    const shadow = Object.keys(host.providers).filter(id => id.includes('-ks-'))
    assert.equal(shadow.length, 1, '当前生效的账号不该再复制一条')
    assert.equal(host.providers[shadow[0]].displayName, '书生 · 小号')
    assert.equal(host.providers[shadow[0]].apiKeyEnv,
      'KEYSWITCH_SHUSHENG_' + shadow[0].split('-ks-')[1].toUpperCase())

    // 会话路由开着时全局「切换」禁用，免得把别人选好的那组路由切没了。
    const swap = buttons(tree, '切换')
    assert.equal(swap.length, 1)
    assert.equal(swap[0].props.disabled, true)

    // 关掉：基路由还原成原名，影子路由清空，开关回到初始状态。
    buttons(tree, '会话路由 · 开')[0].props.onClick()
    await settle()
    tree = await paint(render)
    assert.equal(host.providers.shusheng.displayName, '书生', '关掉后要把显示名还原')
    assert.equal(Object.keys(host.providers).filter(id => id.includes('-ks-')).length, 0)
    assert.equal(buttons(tree, '会话路由').length, 1)
  } finally {
    await host.close()
  }
})

test('窄屏（DSH Go 竖屏 390px）：卡片头分三行、按钮 36px、输入框 16px、底部留安全区', async () => {
  const host = await bootWith({
    shusheng: {
      displayName: '书生',
      apiKeyEnv: 'SHUSHENG_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://discovery-api.intern-ai.org.cn/v1',
      models: [{ id: 'Sage-S2.1-Flash', name: 'Sage-S2.1-Flash', contextWindow: 524288 }],
    },
  })
  try {
    const { exports, react } = await loadBundle(host.origin, { innerWidth: 390, screen: { width: 390 } })
    const render = mountPage(exports, react)
    let tree = await render()
    await settle(200)
    tree = await render()

    // 页面要接管滚动，并给 iPhone 底部横条留位置。
    const page = findAll(tree, node => node.props?.style?.overscrollBehaviorY === 'contain')[0]
    assert.ok(page !== undefined, '窄屏页面要标记成独立滚动容器')
    assert.match(page.props.style.paddingBottom, /safe-area-inset-bottom/)

    // 空状态的主按钮整行铺开。
    const addProvider = buttons(tree, '+ 添加提供商')[0]
    assert.equal(addProvider.props.style.minHeight, '40px', '主操作按钮要更高')

    addProvider.props.onClick()
    tree = await render()
    buttons(tree, '添加')[0].props.onClick()
    await settle()
    tree = await render()

    // 卡片头：窄屏第一个孩子是 div（标题 + 引用那一行），宽屏是 span（标题本身）。
    const header = findAll(tree, node => node.type === 'header')[0]
    assert.equal(header.props.children.length, 3)
    assert.equal(header.props.children[0].type, 'div', '窄屏卡片头要拆行')

    // 卡片头按钮：一行两个，等分，36px 高。
    assert.equal(buttons(tree, '会话路由')[0].props.style.minHeight, '36px')
    assert.equal(buttons(tree, '移除')[0].props.style.minHeight, '36px')

    // 账号行变成两列网格，动作按钮另起一行。
    buttons(tree, '存为账号')[0].props.onClick()
    await settle()
    tree = await render()
    const accountRow = findAll(tree, node => node.type === 'li')[0]
    assert.equal(accountRow.props.style.display, 'grid')

    // 输入框 16px：iOS 对 <16px 的输入框会在聚焦时放大整页。
    buttons(tree, '+ 添加账号')[0].props.onClick()
    tree = await render()
    const inputs = findAll(tree, node => node.type === 'input')
    assert.ok(inputs.length >= 2)
    assert.equal(inputs[0].props.style.fontSize, '16px')
    assert.equal(inputs[1].props.style.fontSize, '16px')
  } finally {
    await host.close()
  }
})

test('宽屏保持原样：卡片头还是那一行，账号行还是 flex', async () => {
  const host = await bootWith({
    shusheng: {
      displayName: '书生',
      apiKeyEnv: 'SHUSHENG_API_KEY',
      api: 'openai-responses',
      baseURL: 'https://discovery-api.intern-ai.org.cn/v1',
      models: [{ id: 'Sage-S2.1-Flash', name: 'Sage-S2.1-Flash', contextWindow: 524288 }],
    },
  })
  try {
    const { exports, react } = await loadBundle(host.origin)
    const render = mountPage(exports, react)
    let tree = await paint(render)
    buttons(tree, '+ 添加提供商')[0].props.onClick()
    tree = await paint(render)
    buttons(tree, '添加')[0].props.onClick()
    await settle()
    tree = await paint(render)
    buttons(tree, '存为账号')[0].props.onClick()
    await settle()
    tree = await paint(render)

    const header = findAll(tree, node => node.type === 'header')[0]
    assert.equal(header.props.children[0].type, 'span', '宽屏不该拆行')
    const accountRow = findAll(tree, node => node.type === 'li')[0]
    assert.equal(accountRow.props.style.display, 'flex')
    assert.equal(buttons(tree, '会话路由')[0].props.style.minHeight, undefined, '宽屏按钮高度不抬')
  } finally {
    await host.close()
  }
})
