/**
 * dsh-key-switch — 客户端半（左侧栏「密钥切换」面板）。
 *
 * 这个文件是给宿主浏览器加载的 bundle：外层 `window.__ModuleLoader__.load` 是宿主的
 * 模块协议，`require` 由宿主提供（这里只用到 react）。不引 UI 组件库，
 * 样式全部走 CSSOM 内联几何 + 宿主的设计令牌，明暗主题都跟着走。
 * @module dsh-key-switch/client
 */

window.__ModuleLoader__.load({ id: `dsh-key-switch`, factory: require => {
  var module = { exports: {} }
  var exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: `Module` })

  const React = require('react')
  const h = React.createElement

  /** 路由前缀，与 Host 半一致。 */
  const API_ROOT = '/api/dsh-key-switch'
  /** 写接口要求的标记头；跨站页面带不上同源请求，也就拿不到它。 */
  const TRUST_HEADER = 'x-dsh-key-switch'
  /** 侧栏入口 id，同时是主面板的 key：点这一行就打开这一页。 */
  const PANEL_ID = 'key-switch'

  /** 把绝对路径解析到页面基准路径上（宿主可能挂在子路径下）。 */
  function resolveApiUrl(path) {
    const doc = globalThis.document
    const raw = doc?.baseURI
    if (typeof raw !== 'string' || raw === '') return path
    try {
      const url = new URL(raw)
      const lastSlash = url.pathname.lastIndexOf('/')
      if (/\.(html?|php|aspx?|jsp)$/i.test(url.pathname.slice(lastSlash + 1))) {
        url.pathname = url.pathname.slice(0, lastSlash + 1)
      } else if (!url.pathname.endsWith('/')) {
        url.pathname += '/'
      }
      return new URL(path.replace(/^\//, ''), url.href).href
    } catch {
      return path
    }
  }

  /** 给请求加个上限，宿主卡住时界面不会一直转圈。 */
  function timeoutSignal() {
    try {
      return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(15000)
        : undefined
    } catch {
      return undefined
    }
  }

  /** 调一条 Host 路由，统一成 `{ ok, state }` 或抛错。 */
  async function call(name, body) {
    const url = `${resolveApiUrl(API_ROOT)}/${name}`
    const signal = timeoutSignal()
    const init = body === undefined
      ? { method: 'GET', headers: { [TRUST_HEADER]: '1' }, cache: 'no-store', credentials: 'same-origin', signal }
      : {
          method: 'POST',
          headers: { [TRUST_HEADER]: '1', 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
          credentials: 'same-origin',
          signal,
        }
    let response
    try {
      response = await fetch(url, init)
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new Error('宿主响应超时，请稍后再试')
      throw new Error(`连不上宿主服务：${error?.message ?? error}`)
    }
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    if (data === null) throw new Error(`宿主返回了无法解析的响应（HTTP ${response.status}）`)
    if (data.ok !== true) throw new Error(data?.error?.message ?? `请求失败（HTTP ${response.status}）`)
    return data
  }

  /**
   * 与 lib/version.js 保持一致的精简版：只在「Host 连不上 GitHub」时由页面兜底用。
   * @param {unknown} left - 左版本。
   * @param {unknown} right - 右版本。
   * @returns {-1 | 0 | 1 | null}
   */
  function compareVersions(left, right) {
    const parse = (value) => {
      const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        typeof value === 'string' ? value.trim() : '',
      )
      return match === null
        ? null
        : { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
    }
    const a = parse(left)
    const b = parse(right)
    if (a === null || b === null) return null
    for (let index = 0; index < 3; index += 1) {
      if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1
    }
    if (a.pre === b.pre) return 0
    if (a.pre === null) return 1
    if (b.pre === null) return -1
    return a.pre < b.pre ? -1 : 1
  }

  /**
   * Host 的 Node 网络连不上 GitHub 时（常见于只有系统代理的 Windows），
   * 用渲染进程的 fetch 再试一次——Chromium 会自动走系统代理。
   * @param {{ source: string | null, version: string | null }} meta - 更新源与本地版本。
   * @returns {Promise<{ latest: string, relation: -1 | 0 | 1 } | null>}
   */
  async function browserUpdateCheck(meta) {
    if (typeof meta.source !== 'string' || meta.source === '' || typeof meta.version !== 'string') return null
    try {
      const response = await fetch(meta.source, {
        cache: 'no-store',
        credentials: 'omit',
        signal: timeoutSignal(),
      })
      if (response?.ok !== true) return null
      const remote = await response.json()
      const latest = typeof remote?.version === 'string' ? remote.version : null
      const relation = compareVersions(latest, meta.version)
      return latest === null || relation === null ? null : { latest, relation }
    } catch {
      return null
    }
  }

  // ---- 设计令牌 -------------------------------------------------------------
  // 只用 App 里已有的 alias 令牌，明暗主题自动跟随；不写死颜色。
  const label = 'var(--dsw-alias-label-primary)'
  const secondary = 'var(--dsw-alias-label-secondary)'
  const tertiary = 'var(--dsw-alias-label-tertiary)'
  const border = '0.5px solid var(--dsw-alias-settings-card-stroke)'
  const cardFill = 'var(--dsw-alias-settings-card-fill)'
  const accent = 'var(--dsw-alias-state-business-primary)'
  const success = 'var(--dsw-alias-state-success-primary)'
  const danger = 'var(--dsw-alias-state-error-primary)'

  const s = {
    page: {
      height: '100%', boxSizing: 'border-box', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
      padding: 'calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(24px, 4vw, 48px) 40px',
      color: label,
    },
    pageInner: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '820px' },
    headRow: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
    titleRow: { display: 'flex', alignItems: 'center', gap: '8px' },
    title: { margin: 0, fontSize: '20px', fontWeight: 600, lineHeight: '28px', color: label },
    version: {
      fontSize: '11px', lineHeight: '16px', color: tertiary,
      border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '999px', padding: '0 6px',
    },
    intro: { margin: '2px 0 0', fontSize: '13px', lineHeight: '20px', color: tertiary },
    footnote: { margin: 0, fontSize: '12px', lineHeight: '18px', color: tertiary, flex: '1 1 320px' },
    footer: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    okInline: { margin: 0, fontSize: '12px', lineHeight: '18px', color: success },
    link: { fontSize: '12px', color: accent, textDecoration: 'none' },
    card: {
      border, borderRadius: '12px', background: cardFill,
      display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px',
    },
    cardHead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
    cardTitle: { fontSize: '14px', fontWeight: 600, color: label },
    ref: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px', color: tertiary, background: 'var(--dsw-alias-fill-tsp-secondary)',
      borderRadius: '4px', padding: '1px 6px',
    },
    spacer: { flex: 1 },
    currentGroup: { display: 'flex', alignItems: 'baseline', gap: '5px', flex: '0 0 auto' },
    currentLabel: { fontSize: '11px', lineHeight: '16px', color: tertiary },
    currentMask: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px', color: secondary,
    },
    list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
    row: {
      display: 'flex', alignItems: 'center', gap: '10px',
      border: '0.5px solid transparent', borderRadius: '8px', padding: '7px 10px',
    },
    rowActive: {
      display: 'flex', alignItems: 'center', gap: '10px',
      border: `0.5px solid ${accent}`, borderRadius: '8px', padding: '7px 10px',
      background: 'var(--dsw-alias-fill-tsp-secondary)',
    },
    dot: (on) => ({
      flex: '0 0 auto', width: '7px', height: '7px', borderRadius: '50%',
      background: on ? success : 'var(--dsw-alias-border-l3)',
    }),
    rowMain: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 },
    rowLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: label },
    badge: {
      fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '999px',
      color: success, border: `0.5px solid ${success}`,
    },
    rowMask: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px', color: tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },
    actions: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' },
    primary: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '3px 10px',
      borderRadius: '6px', border: '0.5px solid transparent', cursor: 'pointer',
      background: accent, color: '#fff', fontWeight: 500,
    },
    ghost: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '3px 8px',
      borderRadius: '6px', cursor: 'pointer', color: secondary,
      border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent',
    },
    ghostDanger: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '3px 8px',
      borderRadius: '6px', cursor: 'pointer', color: danger,
      border: `0.5px solid ${danger}`, background: 'transparent',
    },
    form: {
      border: '0.5px dashed var(--dsw-alias-border-l3)', borderRadius: '8px',
      padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
    },
    fields: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    input: {
      font: 'inherit', fontSize: '13px', lineHeight: '20px', padding: '4px 8px',
      minWidth: 0, flex: 1, borderRadius: '6px', color: label,
      border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
      outline: 'none',
    },
    inputLabel: { flex: '0 0 150px' },
    formFoot: { display: 'flex', alignItems: 'center', gap: '8px' },
    hint: { fontSize: '12px', lineHeight: '18px', color: tertiary, margin: 0 },
    warn: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' },
    infoRow: {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      background: 'var(--dsw-alias-fill-tsp-secondary)', borderRadius: '8px', padding: '7px 10px',
    },
    confirmBox: {
      display: 'flex', flexDirection: 'column', gap: '8px',
      background: 'var(--dsw-alias-fill-tsp-secondary)', borderRadius: '8px', padding: '10px 12px',
    },
    confirmActions: { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' },
    emptyBox: {
      border: '0.5px dashed var(--dsw-alias-border-l3)', borderRadius: '12px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px',
      padding: '20px', background: 'transparent',
    },
    emptyTitle: { margin: 0, fontSize: '13px', lineHeight: '20px', fontWeight: 500, color: secondary },
    error: { margin: 0, fontSize: '12px', lineHeight: '18px', color: danger },
    notice: { margin: 0, fontSize: '12px', lineHeight: '18px', color: success },
    empty: { margin: 0, fontSize: '12px', lineHeight: '18px', color: tertiary },
  }

  /** 键帽样式的小按钮。 */
  function button(style, text, onClick, options = {}) {
    return h('button', {
      type: options.type ?? 'button',
      style: {
        ...style,
        opacity: options.disabled === true ? 0.5 : 1,
        cursor: options.disabled === true ? 'default' : 'pointer',
      },
      disabled: options.disabled === true,
      title: options.title,
      onClick: options.disabled === true ? undefined : onClick,
    }, text)
  }

  /**
   * 主面板主体：从左侧栏「密钥切换」进入时渲染这一页。
   * @returns 密钥切换页面。
   */
  function KeySwitchSection() {
    const [state, setState] = React.useState(null)
    const [error, setError] = React.useState(null)
    const [notice, setNotice] = React.useState(null)
    const [busy, setBusy] = React.useState(null)
    const [draft, setDraft] = React.useState(null)
    const [editing, setEditing] = React.useState(null)
    const [confirming, setConfirming] = React.useState(null)
    const [removing, setRemoving] = React.useState(null)
    const [picking, setPicking] = React.useState(false)
    const [meta, setMeta] = React.useState({ version: null, repo: null, source: null })
    const [update, setUpdate] = React.useState(null)
    const timer = React.useRef(null)
    /** 写操作的互斥锁：请求在飞时忽略后续点击，避免重复提交。 */
    const inflight = React.useRef(false)
    /** 状态序号：只有最后一次发出的请求能写回界面，避免慢响应覆盖新状态。 */
    const stateSeq = React.useRef(0)

    const flash = React.useCallback((text) => {
      setNotice(text)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setNotice(null); timer.current = null }, 2600)
    }, [])
    React.useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])

    const load = React.useCallback(async () => {
      const ticket = ++stateSeq.current
      try {
        const data = await call('state')
        if (ticket !== stateSeq.current) return
        setState(data.state)
        setMeta({
          version: typeof data.version === 'string' ? data.version : null,
          repo: typeof data.repo === 'string' ? data.repo : null,
          source: typeof data.source === 'string' ? data.source : null,
        })
        setError(null)
      } catch (problem) {
        if (ticket !== stateSeq.current) return
        setError(problem?.message ?? String(problem))
      }
    }, [])

    React.useEffect(() => { void load() }, [load])

    /** 跑一个写操作：置忙、刷新状态、给出提示。 */
    const run = React.useCallback(async (key, task, done) => {
      if (inflight.current) return false
      inflight.current = true
      setBusy(key)
      setError(null)
      try {
        const data = await task()
        if (data?.state) {
          // 写操作的结果比任何在飞的读取都新：让它们的响应作废。
          stateSeq.current += 1
          setState(data.state)
        }
        if (typeof data?.version === 'string') {
          setMeta({
            version: data.version,
            repo: typeof data.repo === 'string' ? data.repo : null,
            source: typeof data.source === 'string' ? data.source : null,
          })
        }
        if (typeof done === 'string') flash(done)
        return true
      } catch (problem) {
        setError(problem?.message ?? String(problem))
        return false
      } finally {
        inflight.current = false
        setBusy(null)
      }
    }, [flash])

    const providers = state?.providers ?? []
    const available = state?.available ?? []

    /** 打开「添加提供商」候选面板：顺手重读一次配置，省得手动刷新。 */
    const openPicker = React.useCallback(() => {
      setPicking(true)
      setRemoving(null)
      setConfirming(null)
      setEditing(null)
      setDraft(null)
      // 写操作在飞时不刷新，免得读回的旧状态盖掉刚写的结果。
      if (!inflight.current) void load()
    }, [load])

    /** 手动检查 GitHub 上的版本；只在点按钮时发请求。 */
    const checkUpdate = async () => {
      if (update?.status === 'checking') return
      setUpdate({ status: 'checking' })
      try {
        const data = await call('update')
        const info = data?.update
        if (info === null || info === undefined || info.configured === false) {
          setUpdate({ status: 'unconfigured' })
          return
        }
        if (info.hasUpdate === true) {
          setUpdate({ status: 'available', latest: info.latest, url: info.url })
        } else if (info.relation < 0) {
          setUpdate({ status: 'ahead', latest: info.latest })
        } else {
          setUpdate({ status: 'latest' })
        }
      } catch (problem) {
        // Host 的 Node 网络可能因为系统代理而连不上 GitHub；让浏览器再试一次。
        const fallback = await browserUpdateCheck(meta)
        if (fallback !== null) {
          if (fallback.relation > 0) {
            setUpdate({ status: 'available', latest: fallback.latest, url: meta.repo })
          } else if (fallback.relation < 0) {
            setUpdate({ status: 'ahead', latest: fallback.latest })
          } else {
            setUpdate({ status: 'latest' })
          }
          return
        }
        setUpdate({ status: 'error', message: problem?.message ?? String(problem) })
      }
    }

    const addProvider = (providerId) => {
      void run(`provider:${providerId}:add`, () => call('add-provider', { provider: providerId }), '已添加提供商')
        .then(ok => { if (ok) setPicking(false) })
    }

    const removeProvider = (providerId) => {
      void run(`provider:${providerId}:remove`, () => call('remove-provider', { provider: providerId }), '已从这一页移除')
        .then(ok => { if (ok) setRemoving(null) })
    }

    const addAccount = (providerId) => {
      const form = draft
      if (form === null || form.provider !== providerId) return
      void run(`${providerId}:add`, () => call('accounts', { provider: providerId, label: form.label, key: form.key }), '已添加账号')
        .then(ok => { if (ok) setDraft(null) })
    }

    /** 从「模型」的配置里挑提供商加进来。 */
    const renderPicker = () => h('section', { style: s.card },
      h('header', { style: s.cardHead },
        h('span', { style: s.cardTitle }, '添加提供商'),
        h('span', { style: s.spacer }),
        button(s.ghost, '重新读取', () => { void load() }),
        button(s.ghost, '关闭', () => setPicking(false)),
      ),
      h('p', { style: s.hint }, '从「模型」里选一个用 API Key 认证的提供商：'),
      available.length === 0
        ? h('p', { style: s.empty }, state?.reason === 'settings-unavailable'
            ? '读不到 Harness 的配置服务（settings 不可用），暂时拿不到提供商清单。'
            : '「模型」里没有还能添加的提供商了。要加新的，先去「模型」页添加一个填了 API Key 的，回来点「重新读取」。')
        : h('ul', { style: s.list }, available.map(item => h('li', { key: item.id, style: s.row },
            h('div', { style: s.rowMain },
              h('div', { style: s.rowLabel }, item.label, h('code', { style: s.ref }, item.ref)),
              item.hint === null ? null : h('div', { style: s.rowMask }, item.hint),
            ),
            h('div', { style: s.actions },
              button(s.primary, busy === `provider:${item.id}:add` ? '添加中…' : '添加', () => addProvider(item.id),
                { disabled: busy === `provider:${item.id}:add` }),
            ),
          ))),
      h('p', { style: s.hint }, '从这里添加不会改动「模型」里的任何配置。'),
    )

    const renderForm = (provider) => {
      const form = draft
      const submitting = busy === `${provider.id}:add`
      return h('form', {
        style: s.form,
        onSubmit: (event) => { event.preventDefault(); addAccount(provider.id) },
      },
      h('div', { style: s.fields },
        h('input', {
          style: { ...s.input, ...s.inputLabel }, value: form.label, placeholder: '备注名（可留空）',
          'aria-label': '账号备注名',
          onChange: (event) => setDraft({ ...form, label: event.target.value }),
        }),
        h('input', {
          style: s.input, value: form.key, placeholder: '粘贴 API Key，如 sk-…', autoFocus: true, spellCheck: false,
          'aria-label': `${provider.label} API Key`,
          onChange: (event) => setDraft({ ...form, key: event.target.value }),
        }),
      ),
      h('div', { style: s.formFoot },
        button(s.primary, submitting ? '保存中…' : '保存', undefined, { disabled: submitting, type: 'submit' }),
        button(s.ghost, '取消', () => setDraft(null), { disabled: submitting }),
        h('span', { style: s.hint }, '密钥只会交给 Harness 的凭据存储'),
      ))
    }

    const renderRow = (provider, account) => {
      const rowBusy = busy === `${provider.id}:${account.id}`
      const editingThis = editing !== null && editing.provider === provider.id && editing.id === account.id
      const confirmingThis = confirming === `${provider.id}:${account.id}`

      if (editingThis) {
        return h('li', { key: account.id, style: account.active ? s.rowActive : s.row },
          h('input', {
            style: { ...s.input, flex: 1 }, value: editing.label, autoFocus: true, 'aria-label': '账号备注名',
            onChange: (event) => setEditing({ ...editing, label: event.target.value }),
            onKeyDown: (event) => { if (event.key === 'Escape') setEditing(null) },
          }),
          h('div', { style: s.actions },
            button(s.primary, '保存', () => {
              void run(`${provider.id}:${account.id}`, () => call('rename', { provider: provider.id, accountId: account.id, label: editing.label }), '已改名')
                .then(ok => { if (ok) setEditing(null) })
            }, { disabled: rowBusy }),
            button(s.ghost, '取消', () => setEditing(null), { disabled: rowBusy }),
          ))
      }

      return h('li', { key: account.id, style: account.active ? s.rowActive : s.row },
        h('span', { style: s.dot(account.active) }),
        h('div', { style: s.rowMain },
          h('div', { style: s.rowLabel },
            account.label,
            account.active ? h('span', { style: s.badge }, '使用中') : null,
          ),
          h('div', { style: s.rowMask },
            account.missing === true ? '密钥已丢失，请删除后重新添加' : (account.masked ?? '••••••'),
          ),
        ),
        h('div', { style: s.actions },
          account.active === true || account.missing === true ? null
            : button(s.primary, rowBusy ? '切换中…' : '切换', () => {
                void run(`${provider.id}:${account.id}`, () => call('switch', { provider: provider.id, accountId: account.id }), `已切换到「${account.label}」`)
              }, { disabled: rowBusy }),
          confirmingThis
            ? [
                button(s.ghostDanger, '确认删除', () => {
                  void run(`${provider.id}:${account.id}`, () => call('delete', { provider: provider.id, accountId: account.id }), '已删除')
                    .then(ok => { if (ok) setConfirming(null) })
                }, { disabled: rowBusy }),
                button(s.ghost, '取消', () => setConfirming(null), { disabled: rowBusy }),
              ]
            : [
                button(s.ghost, '改名', () => {
                  setEditing({ provider: provider.id, id: account.id, label: account.label })
                  setConfirming(null)
                  setRemoving(null)
                }),
                button(s.ghost, '删除', () => {
                  setConfirming(`${provider.id}:${account.id}`)
                  setRemoving(null)
                  setEditing(null)
                }),
              ],
        ))
    }

    const renderProvider = (provider) => {
      const open = draft !== null && draft.provider === provider.id
      const removingThis = removing === provider.id
      return h('section', { key: provider.id, style: s.card },
        h('header', { style: s.cardHead },
          h('span', { style: s.cardTitle }, provider.label),
          provider.ref === null ? null : h('code', {
            style: s.ref,
            title: provider.hint === null ? provider.ref : `${provider.ref} · ${provider.hint}`,
          }, provider.ref),
          h('span', { style: s.spacer }),
          provider.current.configured
            ? h('span', { style: s.currentGroup },
                h('span', { style: s.currentLabel }, '当前'),
                h('span', { style: s.currentMask }, provider.current.masked ?? '已配置'),
              )
            : h('span', { style: s.error }, '未配置'),
          removingThis ? null : button(s.ghost, '移除', () => {
            setRemoving(provider.id)
            setDraft(null)
            setConfirming(null)
            setEditing(null)
          }),
        ),
        removingThis ? h('div', { style: s.confirmBox },
          h('span', { style: s.hint }, '只从这个页面移除，不动「模型」里的配置。这里保存的账号会一起删掉，当前正在用的那把密钥不受影响。'),
          h('div', { style: s.confirmActions },
            button(s.ghost, '取消', () => setRemoving(null)),
            button(s.ghostDanger, busy === `provider:${provider.id}:remove` ? '移除中…' : '确认移除',
              () => removeProvider(provider.id), { disabled: busy === `provider:${provider.id}:remove` }),
          ),
        ) : null,
        provider.available === false
          ? h('p', { style: s.warn }, '「模型」里已经找不到这个提供商了。账号还留着，要清理就移除。')
          : null,
        provider.claiming
          ? h('div', { style: s.infoRow },
              h('span', { style: s.hint }, '当前密钥还没存成账号，存一份以后就能一键切回来。'),
              h('span', { style: s.spacer }),
              button(s.ghost, '存为账号', () => {
                void run(`${provider.id}:adopt`, () => call('adopt', { provider: provider.id }), '已保存当前密钥')
              }, { disabled: busy === `${provider.id}:adopt` }),
            )
          : null,
        provider.accounts.length === 0
          ? h('p', { style: s.empty }, '还没有保存任何账号。点下面的「添加账号」把几个号的 Key 都存进来。')
          : h('ul', { style: s.list }, provider.accounts.map(account => renderRow(provider, account))),
        open
          ? renderForm(provider)
          : h('div', { style: s.formFoot },
              button(s.ghost, '+ 添加账号', () => setDraft({ provider: provider.id, label: '', key: '' }))),
      )
    }

    /** 更新检测的结果；未点过按钮时什么也不显示。 */
    const renderUpdate = () => {
      if (update === null) return null
      if (update.status === 'checking') return h('span', { style: s.hint }, '检查中…')
      if (update.status === 'latest') return h('span', { style: s.okInline, role: 'status' }, '已是最新版本')
      if (update.status === 'available') {
        return h('span', { style: s.okInline, role: 'status' },
          `有新版本 v${update.latest}`,
          ' ',
          h('a', {
            href: update.url, target: '_blank', rel: 'noreferrer noopener', style: s.link,
          }, '查看'),
        )
      }
      if (update.status === 'ahead') {
        return h('span', { style: s.hint, role: 'status' }, `本地 v${meta.version ?? ''} 比远端新`)
      }
      if (update.status === 'unconfigured') return h('span', { style: s.hint, role: 'status' }, '未配置仓库地址')
      return h('span', { style: s.error, role: 'alert' }, update.message)
    }

    /** 一个提供商都还没加时说清楚下一步。 */
    const renderEmpty = () => h('div', { style: s.emptyBox },
      h('p', { style: s.emptyTitle }, '还没有添加提供商'),
      h('p', { style: s.empty },
        state?.reason === 'settings-unavailable'
          ? '读不到 Harness 的配置服务（settings 不可用），暂时没法添加提供商。'
          : '从「模型」的配置里挑一个需要换 Key 的提供商加进来，再在它下面保存多个账号。只有添加过的才会显示在这一页，不会把「模型」里的配置全部铺出来。'),
      h('div', { style: s.formFoot },
        button(s.primary, '+ 添加提供商', openPicker),
      ),
    )

    return h('div', { style: s.page },
      h('div', { style: s.pageInner },
        h('div', { style: s.headRow },
          h('div', null,
            h('div', { style: s.titleRow },
              h('h1', { style: s.title }, '密钥切换'),
              meta.version === null ? null : h('span', { style: s.version }, `v${meta.version}`),
            ),
            h('p', { style: s.intro },
              '同一个提供商可以保存多把 API Key，额度用完点一下就能换下一个。切换立即生效，不用重启。'),
          ),
          h('span', { style: s.spacer }),
          providers.length === 0 || picking ? null : button(s.primary, '+ 添加提供商', openPicker),
        ),
        error !== null ? h('p', { style: s.error, role: 'alert' }, error) : null,
        notice !== null ? h('p', { style: s.notice, role: 'status' }, notice) : null,
        state === null && error === null ? h('p', { style: s.hint }, '读取中…') : null,
        picking ? renderPicker() : null,
        state !== null && providers.length === 0 && !picking ? renderEmpty() : providers.map(renderProvider),
        h('div', { style: s.footer },
          h('p', { style: s.footnote },
            '密钥存放在 Harness 的凭据存储里，每个账号一把独立引用；切换只替换当前生效的那把，随时可以切回来。'),
          h('span', { style: s.spacer }),
          renderUpdate(),
          button(s.ghost, update?.status === 'checking' ? '检查中…' : '检查更新', () => { void checkUpdate() },
            { disabled: update?.status === 'checking' }),
        ),
      ),
    )
  }

  /** 侧栏图标：一把描边钥匙，颜色跟随侧栏文字。 */
  function KeyIcon({ size } = {}) {
    const edge = typeof size === 'number' ? size : 16
    return h('svg', {
      width: edge, height: edge, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', focusable: 'false',
    },
    h('circle', { cx: 7.5, cy: 15.5, r: 5.5 }),
    h('path', { d: 'm21 2-9.6 9.6' }),
    h('path', { d: 'm15.5 7.5 3 3L22 7l-3-3' }))
  }

  /**
   * 浏览器半入口：在左侧栏注册一行入口，并注册它打开的主面板。
   * @param ctx - 客户端插件上下文。
   */
  function apply(ctx) {
    try {
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, KeySwitchSection)), 'dsh-key-switch: main panel')
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 15,
        label: () => '密钥切换',
      }, KeyIcon)), 'dsh-key-switch: sidebar entry')
    } catch (error) {
      console.warn('[dsh-key-switch] 注册侧栏入口失败：', error)
    }
  }

  const inject = ['slots']

  exports.apply = apply
  exports.inject = inject
  return module.exports
}})
