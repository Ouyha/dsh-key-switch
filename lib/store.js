/**
 * 账号仓库：管理「这个页面订阅了哪些提供商」，以及每个提供商名下的多把 API Key。
 *
 * 设计要点
 * - **订阅制**：`state.json` 里的 `providers` 既是账号表，也是「这一页要显示谁」的名单。
 *   只有用户主动加进来的提供商才有卡片——不会把「模型」里的配置全铺出来占地方。
 * - 加提供商时从 DSH 的实时配置里挑（`providers.js` 负责发现），挑完把 `label`/`ref`
 *   存一份快照；之后「模型」里改了显示名或删了整个提供商，这里仍有据可查。
 * - **移除只影响插件**：删掉一条不会碰「模型」的配置，也不会还原提供商正在用的那把密钥，
 *   只是把插件里记的账号清掉（它们各自的密钥引用一并 unset）。
 * - 密钥本身交给 Harness 自己的凭据存储（`ctx.credentials` → `$DSH_HOME/.credentials.yaml`），
 *   每个账号占一个独立引用（`KEYSWITCH_<PROVIDER>_<ID>`）。插件不另存明文密钥。
 * - 切换 = 把某个账号的密钥值写进提供商自己的引用（如 `SHUSHENG_API_KEY`）。
 *   模型适配器每次请求都会重新解析该引用，所以切换后下一次请求立即生效，无需重启。
 * - 「当前是哪个账号」不持久化，每次把提供商引用与各账号引用的值比对得出；
 *   用户在「模型」页手动改过密钥，界面也不会谎报。
 * @module dsh-key-switch/store
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 可见 ASCII，且不含空白：与「模型」页对密钥的校验保持一致。 */
const LEGAL_KEY = /^[\x21-\x7E]+$/
const MAX_LABEL = 40

/** 带 HTTP 状态码的业务错误，路由层直接映射成响应。 */
export class KeySwitchError extends Error {
  /**
   * @param {number} status - HTTP 状态码。
   * @param {string} message - 给用户看的中文说明。
   * @param {string} [code] - 机器可读的错误码。
   */
  constructor(status, message, code = 'key-switch/error') {
    super(message)
    this.name = 'KeySwitchError'
    this.status = status
    this.code = code
  }
}

/** 运行目录 `$DSH_HOME`，与宿主其余状态同源。 */
export function dshHome() {
  const custom = process.env.DSH_HOME
  return typeof custom === 'string' && custom.trim() !== '' ? custom.trim() : join(homedir(), '.dsh')
}

/** 本插件的元数据文件。 */
export function statePath() {
  return join(dshHome(), 'key-switch', 'state.json')
}

/** 空文档。providers 用无原型对象，免得 `__proto__` 之类的键把原型改掉。 */
function emptyDoc() {
  return { version: 3, providers: Object.create(null) }
}

/** 串行化本进程内的写入，避免两次点击互相覆盖。 */
let writeQueue = Promise.resolve()
function serialize(task) {
  const next = writeQueue.then(task, task)
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}

/** 读取元数据；文件不存在或损坏时给空文档（损坏文件留一份副本）。 */
async function readDoc() {
  const file = statePath()
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyDoc()
    throw new KeySwitchError(500, `读取 ${file} 失败：${error?.message ?? error}`)
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('not an object')
    // v1/v2 把提供商标成 `slots` 或没有快照字段；原样搬过来，账号一把都不丢。
    const source = parsed.providers ?? parsed.slots
    const providers = Object.create(null)
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      for (const [id, entry] of Object.entries(source)) {
        providers[id] = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { accounts: [] }
      }
    }
    return { version: 3, providers }
  } catch {
    await copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined)
    return emptyDoc()
  }
}

/** 原子写入元数据。 */
async function writeDoc(doc) {
  const file = statePath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/** 某条订阅里的账号数组。 */
function accountsOf(entry) {
  const list = entry && Array.isArray(entry.accounts) ? entry.accounts : []
  return list.filter(row => row && typeof row.id === 'string' && typeof row.ref === 'string')
}

/**
 * 找一条订阅，并把「配置里的最新样子」和「加入时的快照」合成它当前的地址。
 * @param doc - 已读出的文档。
 * @param discovered - 本次从「模型」配置里发现的提供商。
 * @param providerId - 路由键。
 * @returns `{ id, label, ref, hint, available, entry }`。
 * @throws {KeySwitchError} 这条订阅不存在。
 */
function subscriptionOf(doc, discovered, providerId) {
  if (typeof providerId !== 'string' || !Object.hasOwn(doc.providers, providerId)) {
    throw new KeySwitchError(404, `「${providerId}」不在这一页的提供商里，先在上面添加它`)
  }
  const entry = doc.providers[providerId]
  const live = discovered.find(item => item.id === providerId)
  const snapshot = { label: entry.label, ref: entry.ref, hint: entry.hint }
  const label = live?.label ?? (typeof snapshot.label === 'string' && snapshot.label !== '' ? snapshot.label : providerId)
  const ref = live?.ref ?? (typeof snapshot.ref === 'string' && snapshot.ref !== '' ? snapshot.ref : undefined)
  const hint = live?.hint ?? (typeof snapshot.hint === 'string' && snapshot.hint !== '' ? snapshot.hint : null)
  return { id: providerId, label, ref, hint, available: live !== undefined, entry }
}

/** 掩码：保留前 7 位和后 4 位，中间省略，和「模型」页的观感一致。 */
export function maskSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length <= 12) return `${value.slice(0, 3)}…`
  if (value.length <= 20) return `${value.slice(0, 4)}…${value.slice(-2)}`
  return `${value.slice(0, 7)}${'·'.repeat(6)}${value.slice(-4)}`
}

/** 生成一个不会撞车的账号引用；非字母数字一律换成下划线，保证符合引用语法。 */
function accountRef(providerId, id) {
  return `KEYSWITCH_${providerId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${id.toUpperCase()}`
}

/**
 * 这个引用是不是本插件写的。
 * 删除账号时会 unset 它——只认自己造的引用，防止状态文件被改坏后误删
 * 提供商正在用的 `SHUSHENG_API_KEY` 之类。
 */
function ownsRef(ref) {
  return typeof ref === 'string' && /^KEYSWITCH_[A-Z0-9_]+$/.test(ref)
}

/** 给新账号起一个不撞车的默认名：删过账号也不会和现有名字重复。 */
function nextLabel(accounts) {
  const used = new Set(accounts.map(account => account.label))
  let n = accounts.length + 1
  while (used.has(`账号 ${n}`)) n += 1
  return `账号 ${n}`
}

/** 规整用户输入的备注名。 */
function cleanLabel(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return fallback
  return text.length > MAX_LABEL ? text.slice(0, MAX_LABEL) : text
}

/** 校验用户输入的密钥。 */
function cleanKey(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new KeySwitchError(400, '请填写 API 密钥')
  if (!LEGAL_KEY.test(text)) throw new KeySwitchError(400, '密钥只能是可见 ASCII 字符，不能带空格或换行')
  return text
}

/** 取凭据服务，缺了就说明缺少哪个插件。 */
function seam(credentials) {
  if (credentials === undefined || credentials === null) {
    throw new KeySwitchError(
      503,
      '凭据服务不可用：当前组合没有挂载 @deepseek-ai/dsh-credentials-local，密钥无法读写',
      'key-switch/no-credentials',
    )
  }
  return credentials
}

/** 读一个引用的值，未配置时给 undefined。 */
async function resolveValue(credentials, ref) {
  if (typeof ref !== 'string' || ref === '') return undefined
  try {
    const hit = await credentials.resolve(ref)
    return typeof hit?.value === 'string' && hit.value !== '' ? hit.value : undefined
  } catch {
    return undefined
  }
}

/**
 * 组装给界面看的状态。
 * @param credentials - `ctx.credentials`。
 * @param discovered - 本次从「模型」配置里发现的提供商（用于「添加」候选与显示名）。
 * @param reason - 发现失败的原因，原样带给界面。
 * @returns `{ providers, available, reason }`：已订阅的卡片 + 还能添加的候选。
 */
export async function buildState(credentials, discovered, reason = null) {
  const credentialsSeam = seam(credentials)
  const doc = await readDoc()
  const providers = []
  for (const providerId of Object.keys(doc.providers)) {
    const target = subscriptionOf(doc, discovered, providerId)
    const current = await resolveValue(credentialsSeam, target.ref)
    const accounts = []
    let claimed = false
    for (const account of accountsOf(target.entry)) {
      const value = await resolveValue(credentialsSeam, account.ref)
      const active = !claimed && value !== undefined && current !== undefined && value === current
      if (active) claimed = true
      accounts.push({
        id: account.id,
        label: typeof account.label === 'string' ? account.label : account.id,
        masked: maskSecret(value),
        missing: value === undefined,
        active,
        addedAt: typeof account.addedAt === 'string' ? account.addedAt : null,
      })
    }
    providers.push({
      id: target.id,
      label: target.label,
      ref: target.ref ?? null,
      hint: target.hint,
      available: target.available,
      current: { configured: current !== undefined, masked: maskSecret(current) },
      accounts,
      claiming: current !== undefined && !claimed,
    })
  }
  const available = discovered
    .filter(item => !Object.hasOwn(doc.providers, item.id))
    .map(item => ({ id: item.id, label: item.label, ref: item.ref, hint: item.hint }))
  return { providers, available, reason }
}

/** 把「模型」里的一个提供商加进这一页。 */
export async function subscribeProvider(credentials, discovered, input) {
  const provider = discovered.find(item => item.id === input?.provider)
  if (provider === undefined) {
    throw new KeySwitchError(404, `「模型」里没有叫「${input?.provider}」的提供商，或者它不支持 API Key 认证`)
  }
  seam(credentials)
  return serialize(async () => {
    const doc = await readDoc()
    if (Object.hasOwn(doc.providers, provider.id)) return { id: provider.id, already: true }
    doc.providers[provider.id] = {
      label: provider.label,
      ref: provider.ref,
      hint: provider.hint,
      addedAt: new Date().toISOString(),
      accounts: [],
    }
    await writeDoc(doc)
    return { id: provider.id }
  })
}

/**
 * 把提供商从这一页移除：清掉插件里记的账号与它们的密钥引用。
 * 「模型」里的配置、以及提供商当前正在用的那把密钥都不动。
 */
export async function unsubscribeProvider(credentials, input) {
  const credentialsSeam = seam(credentials)
  return serialize(async () => {
    const doc = await readDoc()
    if (typeof input?.provider !== 'string' || !Object.hasOwn(doc.providers, input.provider)) {
      throw new KeySwitchError(404, '这一页没有这个提供商，可能已经被移除')
    }
    const entry = doc.providers[input.provider]
    for (const account of accountsOf(entry)) {
      if (!ownsRef(account.ref)) continue
      try {
        await credentialsSeam.unset(account.ref)
      } catch {
        // 引用本来就没了也照样往下走：订阅必须能删掉。
      }
    }
    delete doc.providers[input.provider]
    await writeDoc(doc)
    return { id: input.provider }
  })
}

/** 新增账号：密钥写进它自己的引用，元数据追加到订阅里。 */
export async function addAccount(credentials, discovered, input) {
  const credentialsSeam = seam(credentials)
  const key = cleanKey(input?.key)
  return serialize(async () => {
    const doc = await readDoc()
    const target = subscriptionOf(doc, discovered, input?.provider)
    if (target.ref === undefined) {
      throw new KeySwitchError(409, `「${target.label}」在配置里已经没有密钥引用了，请先在「模型」页确认它还能用`)
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const ref = accountRef(target.id, id)
    const label = cleanLabel(input?.label, nextLabel(accountsOf(target.entry)))
    await credentialsSeam.set(ref, key)
    target.entry.accounts = [...accountsOf(target.entry), { id, label, ref, addedAt: new Date().toISOString() }]
    // 顺手把快照刷新成配置里的最新样子，日后「模型」里删了也还认得它。
    target.entry.label = target.label
    target.entry.ref = target.ref
    target.entry.hint = target.hint
    await writeDoc(doc)
    return { id }
  })
}

/** 把某个账号设为当前使用中：把它的密钥复制进提供商的引用。 */
export async function switchAccount(credentials, discovered, input) {
  const credentialsSeam = seam(credentials)
  return serialize(async () => {
    const doc = await readDoc()
    const target = subscriptionOf(doc, discovered, input?.provider)
    if (target.ref === undefined) {
      throw new KeySwitchError(409, `「${target.label}」在配置里已经没有密钥引用了，切不了`)
    }
    const account = accountsOf(target.entry).find(row => row.id === input?.accountId)
    if (account === undefined) throw new KeySwitchError(404, '账号不存在，可能已被删除')
    const value = await resolveValue(credentialsSeam, account.ref)
    if (value === undefined) throw new KeySwitchError(409, `账号「${account.label}」的密钥已丢失，请重新添加`)
    await credentialsSeam.set(target.ref, value)
    return { accountId: account.id }
  })
}

/** 改备注名。 */
export async function renameAccount(credentials, discovered, input) {
  seam(credentials)
  const label = cleanLabel(input?.label, '')
  if (label === '') throw new KeySwitchError(400, '备注名不能为空')
  return serialize(async () => {
    const doc = await readDoc()
    const target = subscriptionOf(doc, discovered, input?.provider)
    const accounts = accountsOf(target.entry)
    const account = accounts.find(row => row.id === input?.accountId)
    if (account === undefined) throw new KeySwitchError(404, '账号不存在')
    account.label = label
    target.entry.accounts = accounts
    await writeDoc(doc)
    return { accountId: account.id }
  })
}

/** 删除账号：先清掉它的密钥引用，再摘掉元数据。 */
export async function deleteAccount(credentials, discovered, input) {
  const credentialsSeam = seam(credentials)
  return serialize(async () => {
    const doc = await readDoc()
    const target = subscriptionOf(doc, discovered, input?.provider)
    const accounts = accountsOf(target.entry)
    const account = accounts.find(row => row.id === input?.accountId)
    if (account === undefined) throw new KeySwitchError(404, '账号不存在')
    if (ownsRef(account.ref)) {
      try {
        await credentialsSeam.unset(account.ref)
      } catch {
        // 引用本来就没了也照样往下走：元数据必须能删掉。
      }
    }
    target.entry.accounts = accounts.filter(row => row.id !== account.id)
    await writeDoc(doc)
    return { accountId: account.id }
  })
}

/** 把提供商当前正在用的密钥收编成一个账号，省得重新粘一遍。 */
export async function adoptCurrent(credentials, discovered, input) {
  const credentialsSeam = seam(credentials)
  return serialize(async () => {
    const doc = await readDoc()
    const target = subscriptionOf(doc, discovered, input?.provider)
    const current = await resolveValue(credentialsSeam, target.ref)
    if (current === undefined) throw new KeySwitchError(409, '当前没有可保存的密钥，请先在「模型」页填一个，或直接添加账号')
    const accounts = accountsOf(target.entry)
    // 去重也放在队列里：两次并发点「存为账号」不会造出两条一样的。
    for (const account of accounts) {
      if (await resolveValue(credentialsSeam, account.ref) === current) return { id: account.id, already: true }
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const ref = accountRef(target.id, id)
    const label = cleanLabel(input?.label, nextLabel(accounts))
    await credentialsSeam.set(ref, current)
    target.entry.accounts = [...accounts, { id, label, ref, addedAt: new Date().toISOString() }]
    target.entry.label = target.label
    target.entry.ref = target.ref
    target.entry.hint = target.hint
    await writeDoc(doc)
    return { id }
  })
}
