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

  // 桌面基准样式。手机的差异全部集中在 `narrowStyles()`，宽屏分支一个字节都不变。
  const s = {
    page: {
      height: '100%', boxSizing: 'border-box', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
      padding: 'calc(20px + var(--dsh-frame-top-clearance, 0px)) clamp(14px, 4vw, 48px) 40px',
      color: label,
    },
    pageInner: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '820px' },
    headRow: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' },
    headText: { flex: '1 1 200px', minWidth: 0 },
    titleRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    title: { margin: 0, fontSize: '20px', fontWeight: 600, lineHeight: '28px', color: label },
    version: {
      fontSize: '11px', lineHeight: '16px', color: tertiary,
      border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '999px', padding: '0 6px',
    },
    intro: { margin: '2px 0 0', fontSize: '13px', lineHeight: '20px', color: tertiary },
    footnote: { margin: 0, fontSize: '12px', lineHeight: '18px', color: tertiary, flex: '1 1 220px' },
    footer: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    okInline: { margin: 0, fontSize: '12px', lineHeight: '18px', color: success },
    link: { fontSize: '12px', color: accent, textDecoration: 'none' },
    card: {
      border, borderRadius: '12px', background: cardFill,
      display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px',
    },
    cardHead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' },
    cardTitle: { fontSize: '15px', fontWeight: 600, color: label, flex: '0 0 auto' },
    ref: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px', color: tertiary, background: 'var(--dsw-alias-fill-tsp-secondary)',
      borderRadius: '4px', padding: '1px 6px',
      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      minWidth: 0, flex: '0 1 auto',
    },
    spacer: { flex: 1 },
    headActions: { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto', marginLeft: 'auto' },
    currentGroup: { display: 'flex', alignItems: 'baseline', gap: '5px', flex: '0 0 auto', whiteSpace: 'nowrap' },
    currentLabel: { fontSize: '11px', lineHeight: '16px', color: tertiary },
    currentMask: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px', color: secondary,
    },
    list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
    row: {
      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
      border: '0.5px solid transparent', borderRadius: '8px', padding: '8px 10px',
    },
    rowActive: {
      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
      border: `0.5px solid ${accent}`, borderRadius: '8px', padding: '8px 10px',
      background: 'var(--dsw-alias-fill-tsp-secondary)',
    },
    dot: (on) => ({
      flex: '0 0 auto', width: '7px', height: '7px', borderRadius: '50%',
      background: on ? success : 'var(--dsw-alias-border-l3)',
    }),
    rowMain: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: '1 1 140px' },
    rowLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: label, flexWrap: 'wrap' },
    badge: {
      fontSize: '11px', lineHeight: '16px', padding: '0 6px', borderRadius: '999px',
      color: success, border: `0.5px solid ${success}`,
    },
    rowMask: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px', color: tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    },
    actions: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto', marginLeft: 'auto' },
    primary: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '4px 12px',
      borderRadius: '6px', border: '0.5px solid transparent', cursor: 'pointer',
      background: accent, color: '#fff', fontWeight: 500, whiteSpace: 'nowrap', flex: '0 0 auto',
    },
    ghost: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '4px 10px',
      borderRadius: '6px', cursor: 'pointer', color: secondary,
      border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent',
      whiteSpace: 'nowrap', flex: '0 0 auto',
    },
    ghostDanger: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '4px 10px',
      borderRadius: '6px', cursor: 'pointer', color: danger,
      border: `0.5px solid ${danger}`, background: 'transparent',
      whiteSpace: 'nowrap', flex: '0 0 auto',
    },
    toggleOn: {
      font: 'inherit', fontSize: '12px', lineHeight: '18px', padding: '4px 10px',
      borderRadius: '6px', cursor: 'pointer', color: accent,
      border: `0.5px solid ${accent}`, background: 'transparent',
      whiteSpace: 'nowrap', flex: '0 0 auto',
    },
    tag: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px', lineHeight: '16px', padding: '0 5px', borderRadius: '4px',
      color: secondary, background: 'var(--dsw-alias-fill-tsp-secondary)',
      flex: '0 0 auto',
    },
    form: {
      border: '0.5px dashed var(--dsw-alias-border-l3)', borderRadius: '8px',
      padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
    },
    fields: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    input: {
      font: 'inherit', fontSize: '13px', lineHeight: '20px', padding: '5px 9px',
      minWidth: 0, flex: '1 1 160px', borderRadius: '6px', color: label,
      border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)',
      outline: 'none',
    },
    inputLabel: { flex: '1 1 120px', minWidth: 0 },
    formFoot: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    hint: { fontSize: '12px', lineHeight: '18px', color: tertiary, margin: 0 },
    warn: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' },
    infoRow: {
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      background: 'var(--dsw-alias-fill-tsp-secondary)', borderRadius: '8px', padding: '8px 10px',
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
    emptyTitle: { margin: 0, fontSize: '13px', lineHeight: '18px', fontWeight: 500, color: secondary },
    error: { margin: 0, fontSize: '12px', lineHeight: '18px', color: danger },
    notice: { margin: 0, fontSize: '12px', lineHeight: '18px', color: success },
    empty: { margin: 0, fontSize: '12px', lineHeight: '18px', color: tertiary },
  }

  /** 面板内容宽低于这个值就换手机排版：DSH Go 竖屏约 330–420，横屏也不会超过 720。 */
  const NARROW_MAX = 600

  /**
   * 手机（DSH Go 的网页岛屿）与窄窗口的排版覆盖。
   * 三条原则：并列改成竖排、触摸目标抬到 36px 以上、输入框 16px 以避开 iOS 聚焦缩放。
   * 只在窄屏生效，`s` 里桌面那套值原样保留给宽屏用。
   * @param base - 桌面样式表。
   * @returns 覆盖后的字段，与 `base` 浅合并即可。
   */
  function narrowStyles(base) {
    const touch = { minHeight: '36px', fontSize: '14px', padding: '7px 12px' }
    return {
      page: {
        ...base.page,
        // 四个方向分开写：万一宿主 WebView 不认 env()，只丢底部那一句，
        // 不会像 padding 简写那样整条失效、内容贴到屏幕边上。
        paddingTop: '16px',
        paddingLeft: '14px',
        paddingRight: '14px',
        paddingBottom: 'calc(26px + env(safe-area-inset-bottom, 0px))',
        // 滚到头时不把滚动传给外层，手机上不然会连整页一起弹。
        overscrollBehaviorY: 'contain',
        // 横竖屏切换时 iOS 会擅自放大字号，锁住。
        WebkitTextSizeAdjust: '100%',
      },
      pageInner: { ...base.pageInner, gap: '12px' },
      headRow: { ...base.headRow, gap: '10px' },
      headText: { ...base.headText, flexBasis: '100%' },
      title: { ...base.title, fontSize: '19px', lineHeight: '26px' },
      intro: { ...base.intro, fontSize: '13px', lineHeight: '19px' },
      version: { ...base.version, fontSize: '12px' },
      // 主操作按钮独占一行，手指好按，也不会把标题挤扁。
      block: { flexBasis: '100%', width: '100%', minHeight: '40px' },
      card: { ...base.card, padding: '12px', gap: '9px' },
      cardHead: { ...base.cardHead, gap: '8px' },
      cardHeadTop: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0 },
      cardTitle: { ...base.cardTitle, fontSize: '16px' },
      ref: { ...base.ref, flex: '1 1 auto', maxWidth: '100%' },
      headStatus: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%' },
      currentLabel: { ...base.currentLabel, fontSize: '12px' },
      currentMask: { ...base.currentMask, fontSize: '13px' },
      // 卡片头按钮整行等分：`gridAutoFlow: column` 不需要知道有几个按钮。
      headActions: {
        ...base.headActions, marginLeft: 0, width: '100%',
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: '8px',
      },
      // 账号行改成两列网格：圆点 + 内容一行，动作按钮另起一行跨满。
      row: {
        ...base.row, display: 'grid', gridTemplateColumns: '7px minmax(0, 1fr)',
        columnGap: '9px', rowGap: '9px', alignItems: 'start', padding: '10px',
      },
      rowActive: {
        ...base.rowActive, display: 'grid', gridTemplateColumns: '7px minmax(0, 1fr)',
        columnGap: '9px', rowGap: '9px', alignItems: 'start', padding: '10px',
      },
      // 「添加提供商」候选行没有圆点，不能套上面的网格。
      rowPlain: {
        ...base.row, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '9px', padding: '10px',
      },
      dot: on => ({ ...base.dot(on), alignSelf: 'start', marginTop: '5px' }),
      rowMain: { ...base.rowMain, flex: '1 1 auto' },
      rowLabel: { ...base.rowLabel, fontSize: '14px' },
      rowMask: { ...base.rowMask, fontSize: '12px' },
      actions: {
        ...base.actions, gridColumn: '1 / -1', marginLeft: 0, width: '100%',
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: '8px',
      },
      primary: { ...base.primary, ...touch },
      ghost: { ...base.ghost, ...touch },
      ghostDanger: { ...base.ghostDanger, ...touch },
      toggleOn: { ...base.toggleOn, ...touch },
      // 16px 是关键：iOS WebView 对小于 16px 的输入框会在聚焦时放大整个页面。
      input: { ...base.input, fontSize: '16px', lineHeight: '22px', padding: '9px 10px' },
      inputLabel: { ...base.inputLabel, flexBasis: '100%' },
      fields: { ...base.fields, gap: '9px' },
      formFoot: { ...base.formFoot, gap: '9px' },
      hint: { ...base.hint, fontSize: '13px', lineHeight: '19px' },
      error: { ...base.error, fontSize: '13px', lineHeight: '19px' },
      notice: { ...base.notice, fontSize: '13px', lineHeight: '19px' },
      warn: { ...base.warn, fontSize: '13px', lineHeight: '19px' },
      empty: { ...base.empty, fontSize: '13px', lineHeight: '19px' },
      emptyTitle: { ...base.emptyTitle, fontSize: '14px', lineHeight: '20px' },
      okInline: { ...base.okInline, fontSize: '13px', lineHeight: '19px' },
      // 「查看」这类链接在手机上也得好点。
      link: { ...base.link, fontSize: '13px', padding: '4px 0' },
      footnote: { ...base.footnote, flexBasis: '100%', fontSize: '13px', lineHeight: '19px' },
      footer: { ...base.footer, gap: '10px', rowGap: '10px' },
      spacer: { display: 'none' },
      infoRow: { ...base.infoRow, gap: '10px' },
      confirmBox: { ...base.confirmBox, gap: '9px' },
      confirmActions: {
        ...base.confirmActions, display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)',
      },
      tag: { ...base.tag, fontSize: '12px' },
      badge: { ...base.badge, fontSize: '12px' },
      emptyBox: { ...base.emptyBox, padding: '16px', gap: '10px' },
      // 首开岛屿要等 1–3 秒，先摆一副卡片骨架，比一行「读取中…」踏实。
      skeletonCard: { ...base.card, gap: '10px', minHeight: '92px' },
      skeletonBar: { height: '10px', borderRadius: '5px', background: 'var(--dsw-alias-fill-tsp-secondary)' },
    }
  }

  /**
   * 按当前宽度给出样式表。窄屏时是「桌面基准 + 手机覆盖」，宽屏时原样返回。
   * @param narrow - 是否用手机排版。
   * @returns 样式表。
   */
  function stylesFor(narrow) {
    if (!narrow) return s
    return { ...s, ...narrowStyles(s) }
  }

  /**
   * 判断该用手机排版还是桌面排版。
   * 用 ResizeObserver 量容器实际宽度，而不是只看窗口——网页岛屿可能嵌在更窄的容器里。
   * 宿主没设 viewport 时 `innerWidth` 会虚高到 980，所以再用 `screen.width` 兜一层。
   * @returns `[ref, narrow]`：ref 挂到页面根节点。
   */
  function useNarrow() {
    const ref = React.useRef(null)
    const [narrow, setNarrow] = React.useState(false)
    React.useEffect(() => {
      const phoneScreen = () => {
        if (typeof window === 'undefined') return false
        const screen = window.screen
        return screen !== undefined && screen !== null
          && typeof screen.width === 'number' && screen.width > 0 && screen.width <= 520
      }
      const decide = width => {
        if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return
        setNarrow(width < NARROW_MAX || phoneScreen())
      }
      const node = ref.current
      if (node !== null && node !== undefined && typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(entries => {
          const entry = entries[0]
          decide(entry === undefined ? node.clientWidth : entry.contentRect.width)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }
      // 没有 ResizeObserver（或还没拿到节点）就退回窗口宽度。
      const measure = () => decide(typeof window === 'undefined' ? 0 : window.innerWidth)
      measure()
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }
      return undefined
    }, [])
    return [ref, narrow]
  }

  /** 键帽样式的小按钮。 */
  function button(style, text, onClick, options = {}) {
    return h('button', {
      type: options.type ?? 'button',
      style: {
        ...style,
        opacity: options.disabled === true ? 0.5 : 1,
        cursor: options.disabled === true ? 'default' : 'pointer',
        // 手机上点按钮不该闪一块灰，也不要双击缩放。
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
      },
      disabled: options.disabled === true,
      title: options.title,
      onClick: options.disabled === true ? undefined : onClick,
    }, text)
  }

  /**
   * 会话路由开启后的说明：把「不带后缀那组到底是哪把」直接写成账号备注，
   * 省得用户自己去核对掩码。分组数也在这里算清楚——它应当等于钥匙数。
   * @param provider - 一张卡片。
   * @returns 一句给用户看的说明。
   */
  function routesHint(provider) {
    const accounts = provider.accounts ?? []
    const anchor = accounts.find(row => row.active === true)
    const baseTag = typeof provider.routes?.baseTag === 'string' && provider.routes.baseTag !== ''
      ? provider.routes.baseTag
      : null
    if (baseTag !== null) {
      return `模型框里共 ${accounts.length} 组，全部带尾号，每组对应一把钥匙；其中「${provider.label} · ${baseTag}」就是新对话默认用的那把。不同对话各选一组，就各走各的钥匙。`
    }
    const groups = accounts.length + (anchor === undefined ? 1 : 0)
    const head = anchor === undefined
      ? `模型框里共 ${groups} 组：不带后缀的「${provider.label}」用的是当前密钥（还没存成账号）`
      : `模型框里共 ${groups} 组：不带后缀的「${provider.label}」就是标着「使用中」的 ${anchor.label}`
    return `${head}，其余各账号一组带后缀。不同对话各选一组，就各走各的钥匙。`
  }

  /**
   * 主面板主体：从左侧栏「密钥切换」进入时渲染这一页。
   * @returns 密钥切换页面。
   */
  function KeySwitchSection() {
    // 先定排版：手机（DSH Go）与窄窗口走分行布局，其余与原来完全一致。
    const [pageRef, narrow] = useNarrow()
    const s = stylesFor(narrow)
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

    /** 开关会话级路由：开了以后每个账号在「模型」里各是一条路由。 */
    const toggleRoutes = (provider) => {
      const next = provider?.routes?.enabled !== true
      void run(`${provider.id}:routes`, () => call('session-routes', { provider: provider.id, enabled: next }),
        next ? '会话路由已开启：模型框里每个账号一组，去选一条试试' : '会话路由已关闭，复制出来的路由已删除')
    }

    /** 从「模型」的配置里挑提供商加进来。 */
    const renderPicker = () => h('section', { style: s.card },
      h('header', { style: s.cardHead },
        h('span', { style: s.cardTitle }, '添加提供商'),
        // 包一层 headActions：宽屏靠 marginLeft 推到右边（等于原来的 spacer），窄屏整行等分。
        h('span', { style: s.headActions },
          button(s.ghost, '重新读取', () => { void load() }),
          button(s.ghost, '关闭', () => setPicking(false)),
        ),
      ),
      h('p', { style: s.hint }, '从「模型」里选一个用 API Key 认证的提供商：'),
      available.length === 0
        ? h('p', { style: s.empty }, state?.reason === 'settings-unavailable'
            ? '读不到 Harness 的配置服务（settings 不可用），暂时拿不到提供商清单。'
            : '「模型」里没有还能添加的提供商了。要加新的，先去「模型」页添加一个填了 API Key 的，回来点「重新读取」。')
        : h('ul', { style: s.list }, available.map(item => h('li', {
            key: item.id,
            // 这一行没有圆点，套不了账号行那套两列网格。
            style: narrow ? s.rowPlain : s.row,
          },
            h('div', { style: s.rowMain },
              h('div', { style: s.rowLabel }, item.label),
              h('div', { style: s.rowMask, title: item.hint === null ? item.ref : `${item.hint} · 引用 ${item.ref}` },
                item.hint ?? item.ref),
            ),
            h('div', { style: s.actions },
              button({ ...s.primary, ...s.block }, busy === `provider:${item.id}:add` ? '添加中…' : '添加',
                () => addProvider(item.id), { disabled: busy === `provider:${item.id}:add` }),
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
          // 手机上别自动首字母大写、别自动纠错——存手机号时会被改坏。
          autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off',
          onChange: (event) => setDraft({ ...form, label: event.target.value }),
        }),
        h('input', {
          style: s.input, value: form.key, placeholder: '粘贴 API Key，如 sk-…', spellCheck: false,
          // 手机上别自动弹键盘：键盘会把刚露出来的表单顶走一半。
          autoFocus: !narrow,
          // 关键：iOS 默认把句首字母大写，`sk-…` 会变成 `Sk-…`，Key 直接失效。
          autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', inputMode: 'text',
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
      // 会话路由开着时每把钥匙各有一条路由，全局「切换」已经没有意义，
      // 而且真去切会让别的对话里选好的那组凭空少一条——所以这里直接禁用。
      const routesOn = provider?.routes?.enabled === true

      if (editingThis) {
        return h('li', { key: account.id, style: account.active ? s.rowActive : s.row },
          h('input', {
            // 窄屏时这行是网格，输入框要跨满两列；宽屏是 flex，这个属性会被忽略。
            style: { ...s.input, flex: 1, gridColumn: '1 / -1' }, value: editing.label, autoFocus: true,
            'aria-label': '账号备注名',
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
            typeof account.tag === 'string' && account.tag !== ''
              ? h('span', {
                  style: s.tag,
                  title: typeof account.route === 'string'
                    ? `会话路由：${account.route}`
                    : '这一把就是不带后缀的那组路由（模型框里的「' + provider.label + '」）',
                }, account.tag)
              : null,
          ),
          h('div', { style: s.rowMask },
            account.missing === true ? '密钥已丢失，请删除后重新添加' : (account.masked ?? '••••••'),
          ),
        ),
        h('div', { style: s.actions },
          account.active === true || account.missing === true ? null
            : routesOn
              ? button(s.ghost, '切换', undefined, {
                  disabled: true,
                  title: '会话路由开着时不用切换：每个对话在模型框里各选一组。要换默认那把，先关掉这张卡上的「会话路由」。',
                })
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
      const routes = provider.routes ?? { enabled: false, supported: false, reason: null }
      const routesBusy = busy === `${provider.id}:routes`
      // 卡片头拆成三块再组装：窄屏能排成三行，宽屏还是原来那一行。
      const statusNode = provider.current.configured
        ? h('span', { style: s.currentGroup },
            h('span', { style: s.currentLabel }, '当前'),
            h('span', { style: s.currentMask }, provider.current.masked ?? '已配置'),
          )
        : h('span', { style: s.error }, '未配置')
      const refNode = provider.hint === null && provider.ref === null ? null : h('code', {
        style: s.ref,
        title: provider.hint === null ? provider.ref : `${provider.hint} · 引用 ${provider.ref}`,
      }, provider.hint ?? provider.ref)
      const routeNode = routes.enabled
        ? button(s.toggleOn, routesBusy ? '关闭中…' : '会话路由 · 开', () => toggleRoutes(provider), {
            disabled: routesBusy,
            title: '关闭后，这个提供商名下复制出来的路由会从「模型」里删掉，账号与密钥都保留',
          })
        : routes.supported
          ? button(s.ghost, routesBusy ? '开启中…' : '会话路由', () => toggleRoutes(provider), {
              disabled: routesBusy,
              title: '每个账号在模型框里各成一组，不同对话可以各用各的密钥',
            })
          : null
      const removeNode = removingThis ? null : button(s.ghost, '移除', () => {
        setRemoving(provider.id)
        setDraft(null)
        setConfirming(null)
        setEditing(null)
      })
      return h('section', { key: provider.id, style: s.card },
        h('header', { style: s.cardHead },
          narrow
            ? [
                h('div', { key: 'top', style: s.cardHeadTop },
                  h('span', { style: s.cardTitle }, provider.label),
                  refNode,
                ),
                h('div', { key: 'status', style: s.headStatus }, statusNode),
                h('div', { key: 'acts', style: s.headActions }, routeNode, removeNode),
              ]
            : [
                h('span', { key: 'title', style: s.cardTitle }, provider.label),
                refNode,
                h('span', { key: 'acts', style: s.headActions }, statusNode, routeNode, removeNode),
              ],
        ),
        removingThis ? h('div', { style: s.confirmBox },
          h('span', { style: s.hint }, '只从这个页面移除，不动「模型」里的配置。这里保存的账号会一起删掉，当前正在用的那把密钥不受影响。'),
          h('div', { style: s.confirmActions },
            button(s.ghost, '取消', () => setRemoving(null)),
            button(s.ghostDanger, busy === `provider:${provider.id}:remove` ? '移除中…' : '确认移除',
              () => removeProvider(provider.id), { disabled: busy === `provider:${provider.id}:remove` }),
          ),
        ) : null,
        routes.enabled && routes.supported
          ? h('div', { style: s.infoRow },
              h('span', { style: s.hint }, routesHint(provider)),
            )
          : null,
        routes.enabled && routes.supported === false
          ? h('p', { style: s.warn },
              `${routes.reason ?? '这个提供商暂时复制不出来'}。要是之前复制过，下次同步会清掉那些路由，账号与密钥都还在。`)
          : null,
        provider.available === false
          ? h('p', { style: s.warn }, '「模型」里已经找不到这个提供商了。账号还留着，要清理就移除。')
          : null,
        provider.claiming
          ? h('div', { style: s.infoRow },
              h('span', { style: s.hint }, '当前密钥还没存成账号，存一份以后就能一键切回来。'),
              h('span', { style: s.spacer }),
              button({ ...s.ghost, ...s.block }, '存为账号', () => {
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

    /** 手机首开岛屿要等 1–3 秒，先摆两副卡片骨架，比一行「读取中…」踏实。 */
    const renderSkeleton = () => h('div', { style: s.pageInner, 'aria-hidden': 'true' },
      [0, 1].map(index => h('div', { key: `skeleton-${index}`, style: s.skeletonCard },
        h('div', { style: { ...s.skeletonBar, width: '38%' } }),
        h('div', { style: { ...s.skeletonBar, width: '72%' } }),
        h('div', { style: { ...s.skeletonBar, width: '54%' } }),
      )))

    /** 一个提供商都还没加时说清楚下一步。 */
    const renderEmpty = () => h('div', { style: s.emptyBox },
      h('p', { style: s.emptyTitle }, '还没有添加提供商'),
      h('p', { style: s.empty },
        state?.reason === 'settings-unavailable'
          ? '读不到 Harness 的配置服务（settings 不可用），暂时没法添加提供商。'
          : '从「模型」的配置里挑一个需要换 Key 的提供商加进来，再在它下面保存多个账号。只有添加过的才会显示在这一页，不会把「模型」里的配置全部铺出来。'),
      h('div', { style: s.formFoot },
        button({ ...s.primary, ...s.block }, '+ 添加提供商', openPicker),
      ),
    )

    return h('div', { style: s.page, ref: pageRef },
      h('div', { style: s.pageInner },
        h('div', { style: s.headRow },
          h('div', { style: s.headText },
            h('div', { style: s.titleRow },
              h('h1', { style: s.title }, '密钥切换'),
              meta.version === null ? null : h('span', { style: s.version }, `v${meta.version}`),
            ),
            h('p', { style: s.intro },
              '同一个提供商可以保存多把 API Key，额度用完点一下就能换下一个。想让不同对话各用一把，在卡片上打开「会话路由」。切换立即生效，不用重启。'),
          ),
          providers.length === 0 || picking ? null : button({ ...s.primary, ...s.block }, '+ 添加提供商', openPicker),
        ),
        error !== null ? h('p', { style: s.error, role: 'alert' }, error) : null,
        notice !== null ? h('p', { style: s.notice, role: 'status' }, notice) : null,
        state === null && error === null
          ? (narrow ? renderSkeleton() : h('p', { style: s.hint }, '读取中…'))
          : null,
        picking ? renderPicker() : null,
        state !== null && providers.length === 0 && !picking ? renderEmpty() : providers.map(renderProvider),
        h('div', { style: s.footer },
          h('p', { style: s.footnote },
            '密钥存放在 Harness 的凭据存储里，每个账号一把独立引用；切换只替换当前生效的那把，随时可以切回来。会话路由只复制路由，不复制密钥。'),
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
