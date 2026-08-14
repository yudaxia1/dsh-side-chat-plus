// dsh-side-chat — code.client（浏览器半边，动态 Cordis 插件）
// 版本：pkg-2（UI polish + 流式状态修复）
// 用途：
//   - conversation.session.header.actions   “侧聊”开关按钮（会话作用域，负责回传主聊天输入框）
//   - conversation.chat.assistant-actions  每条助手消息上的“在侧聊中询问”
//   - shell.overlay                        右侧可拖宽的侧聊面板（根作用域）
// 数据流：
//   - 面板/列表/消息全部来自宿主 RPC（host.call('sideChat.*')）
//   - 流式期间客户端以 ~400ms 轮询 sideChat.poll（RPC 是 Client→Host 请求/响应，无反向推送通道）
//   - “插入主聊天输入框”通过共享 store 的 pendingInsert 桥接到 header 按钮（它持有 inputActions）
// 用法：把本文件内容作为 cordis_define 的 code.client。

const NS_PREFIX = 'dsh_sc_'

// ── 共享 store（跨三个 slot 入口的视图状态；不包含会话业务数据）──────────────
const ui = {
  open: false,
  sessionId: null,          // 面板当前绑定的父会话
  sideChats: [],            // 当前会话的侧聊列表（来自宿主）
  activeSideChatId: null,
  listError: null,
  pendingInsert: null,      // { sessionId, text } —— header 按钮消费
  listeners: new Set(),
  notify() {
    for (const fn of this.listeners) fn()
  },
  subscribe(fn) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  },
  setOpen(open) {
    if (this.open === open) return
    this.open = open
    this.notify()
  },
  toggleOpen() {
    this.open = !this.open
    this.notify()
  },
  setSession(sessionId) {
    if (this.sessionId === sessionId) return
    this.sessionId = sessionId
    this.sideChats = []
    this.activeSideChatId = null
    this.listError = null
    this.notify()
  },
  setSideChats(list, error) {
    this.sideChats = Array.isArray(list) ? list : []
    this.listError = error === undefined || error === null ? null : String(error)
    if (this.activeSideChatId !== null
      && !this.sideChats.some((s) => s.sideChatId === this.activeSideChatId)) {
      this.activeSideChatId = this.sideChats.length > 0 ? this.sideChats[0].sideChatId : null
    }
    this.notify()
  },
  patchSideChat(sideChatId, patch) {
    if (typeof sideChatId !== 'string' || patch === null || typeof patch !== 'object') return
    let changed = false
    this.sideChats = this.sideChats.map((sideChat) => {
      if (sideChat.sideChatId !== sideChatId) return sideChat
      changed = true
      return { ...sideChat, ...patch }
    })
    if (changed) this.notify()
  },
  setActive(sideChatId) {
    if (this.activeSideChatId === sideChatId) return
    this.activeSideChatId = sideChatId
    this.notify()
  },
  requestInsert(sessionId, text) {
    this.pendingInsert = { sessionId, text }
    this.notify()
  },
  clearPendingInsert() {
    if (this.pendingInsert === null) return
    this.pendingInsert = null
    this.notify()
  },
}

function useUi() {
  const [, setTick] = React.useState(0)
  React.useEffect(() => ui.subscribe(() => setTick((t) => t + 1)), [])
}

// ── 工具 ────────────────────────────────────────────────────────────────────
let pluginCtx = null

const cleanError = (e) => {
  const raw = e instanceof Error ? e.message : String(e)
  const m = raw.match(/failed inside the host handler:\s*([\s\S]*)$/)
  return m ? m[1].trim() : raw
}

const fmtTime = (ts) => {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

const cssEscape = (value) => {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
  return String(value).replace(/["\\]/g, '\\$&')
}

function focusSideChatToggle() {
  try {
    const button = document.querySelector('[data-dsh-side-chat-toggle="true"]')
    if (button !== null && typeof button.focus === 'function') button.focus()
  } catch (error) {
    // 面板卸载时 DOM 可能已经被宿主重建，焦点恢复失败不应影响关闭。
  }
}

function svg(paths, size) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  }, ...paths)
}

const Icons = {
  chat: (s) => svg([
    React.createElement('path', { key: 'a', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }),
  ], s || 14),
  plus: (s) => svg([
    React.createElement('line', { key: 'a', x1: '12', y1: '5', x2: '12', y2: '19' }),
    React.createElement('line', { key: 'b', x1: '5', y1: '12', x2: '19', y2: '12' }),
  ], s || 14),
  close: (s) => svg([
    React.createElement('line', { key: 'a', x1: '18', y1: '6', x2: '6', y2: '18' }),
    React.createElement('line', { key: 'b', x1: '6', y1: '6', x2: '18', y2: '18' }),
  ], s || 14),
  stop: (s) => svg([
    React.createElement('rect', { key: 'a', x: '6', y: '6', width: '12', height: '12', rx: '2' }),
  ], s || 14),
  trash: (s) => svg([
    React.createElement('polyline', { key: 'a', points: '3 6 5 6 21 6' }),
    React.createElement('path', { key: 'b', d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
  ], s || 14),
  edit: (s) => svg([
    React.createElement('path', { key: 'a', d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }),
  ], s || 14),
  send: (s) => svg([
    React.createElement('line', { key: 'a', x1: '22', y1: '2', x2: '11', y2: '13' }),
    React.createElement('polygon', { key: 'b', points: '22 2 15 22 11 13 2 9 22 2' }),
  ], s || 14),
  anchor: (s) => svg([
    React.createElement('circle', { key: 'a', cx: '12', cy: '5', r: '3' }),
    React.createElement('line', { key: 'b', x1: '12', y1: '22', x2: '12', y2: '8' }),
    React.createElement('path', { key: 'c', d: 'M5 12H2a10 10 0 0 0 20 0h-3' }),
  ], s || 14),
  summary: (s) => svg([
    React.createElement('path', { key: 'a', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
    React.createElement('polyline', { key: 'b', points: '14 2 14 8 20 8' }),
    React.createElement('line', { key: 'c', x1: '16', y1: '13', x2: '8', y2: '13' }),
    React.createElement('line', { key: 'd', x1: '16', y1: '17', x2: '8', y2: '17' }),
  ], s || 14),
  copy: (s) => svg([
    React.createElement('rect', { key: 'a', x: '9', y: '9', width: '11', height: '11', rx: '2' }),
    React.createElement('path', { key: 'b', d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 1v1' }),
  ], s || 14),
  down: (s) => svg([
    React.createElement('polyline', { key: 'a', points: '6 9 12 15 18 9' }),
  ], s || 14),
}

// ── 样式（注入一次；前缀 dsh_sc_ 避免与装配后的其他插件冲突）─────────────────
const CSS = [
  `.${NS_PREFIX}panel{position:fixed;top:0;right:0;bottom:0;z-index:120;width:var(--dsh-side-chat-width,380px);min-width:280px;max-width:720px;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);border-left:1px solid var(--dsw-alias-border-l1,#e5e7eb);box-shadow:-12px 0 32px rgba(15,23,42,.12);pointer-events:auto;animation:${NS_PREFIX}slide-in .16s ease-out}`,
  `@keyframes ${NS_PREFIX}slide-in{from{opacity:.55;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}`,
  `.${NS_PREFIX}handle{position:absolute;top:0;left:-4px;bottom:0;width:8px;cursor:col-resize;z-index:1}`,
  `.${NS_PREFIX}handle:before{content:"";position:absolute;top:50%;left:2px;width:3px;height:38px;border-radius:3px;background:var(--dsw-alias-border-l1,#e5e7eb);transform:translateY(-50%);opacity:.85}`,
  `.${NS_PREFIX}handle:hover:before{background:var(--dsw-alias-state-business-primary,#4f46e5);opacity:1}`,
  `.${NS_PREFIX}header{display:flex;align-items:center;gap:6px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 94%,var(--dsw-alias-state-business-primary,#4f46e5))}`,
  `.${NS_PREFIX}title{flex:1;min-width:0;font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary,#111827);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
  `.${NS_PREFIX}ibtn{flex:none;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary)}`,
  `.${NS_PREFIX}ibtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}ibtn:disabled{opacity:.5;cursor:default}`,
  `.${NS_PREFIX}ibtn-danger{color:var(--dsw-alias-state-error-primary)}`,
  `.${NS_PREFIX}ibtn-primary{color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}list{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;max-height:156px;overflow-y:auto;background:var(--dsw-alias-bg-base,#fff)}`,
  `.${NS_PREFIX}listrow{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:4px 6px;border:0;border-radius:6px;cursor:pointer;background:transparent;text-align:left;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px}`,
  `.${NS_PREFIX}listrow:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
  `.${NS_PREFIX}listrow-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}listrow-main{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
  `.${NS_PREFIX}listrow-time{flex:none;font-size:10px;color:var(--dsw-alias-label-caption,#94a3b8)}`,
  `.${NS_PREFIX}listrow-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l1)}`,
  `.${NS_PREFIX}listrow-dot-stream{background:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}listrow-dot-error{background:var(--dsw-alias-state-error-primary)}`,
  `.${NS_PREFIX}anchor{display:flex;align-items:flex-start;gap:8px;padding:8px 11px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#64748b);background:var(--dsw-alias-bg-subtle,#f8fafc)}`,
  `.${NS_PREFIX}anchor-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;max-height:64px;overflow:hidden}`,
  `.${NS_PREFIX}anchor-source{font-size:11px;font-weight:650;color:var(--dsw-alias-label-secondary,#475569)}`,
  `.${NS_PREFIX}anchor-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:pre-wrap;text-overflow:ellipsis}`,
  `.${NS_PREFIX}anchor-go{flex:none;display:inline-flex;align-items:center;gap:3px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 6px;cursor:pointer;font-size:11px}`,
  `.${NS_PREFIX}anchor-go:hover{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}msgs{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:14px 12px;scroll-behavior:smooth;background:var(--dsw-alias-bg-base,#fff)}`,
  `.${NS_PREFIX}msg-wrap{display:flex;align-items:flex-end;gap:4px;max-width:96%}`,
  `.${NS_PREFIX}msg-wrap-user{align-self:flex-end;flex-direction:row-reverse}`,
  `.${NS_PREFIX}msg-wrap-assistant{align-self:flex-start}`,
  `.${NS_PREFIX}msg{max-width:100%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:20px;word-break:break-word;white-space:pre-wrap;box-shadow:0 1px 1px rgba(15,23,42,.04)}`,
  `.${NS_PREFIX}msg-user{background:var(--dsw-alias-state-business-primary,#4f46e5);color:var(--dsw-alias-bg-base,#fff);border-bottom-right-radius:4px}`,
  `.${NS_PREFIX}msg-assistant{background:var(--dsw-specific-tip,#f8fafc);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);color:var(--dsw-alias-label-primary,#111827);border-bottom-left-radius:4px}`,
  `.${NS_PREFIX}msg-time{display:block;font-size:10px;opacity:.6;margin-top:2px}`,
  `.${NS_PREFIX}msg-actions{display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s ease}`,
  `.${NS_PREFIX}msg-wrap:hover .${NS_PREFIX}msg-actions,.${NS_PREFIX}msg-wrap:focus-within .${NS_PREFIX}msg-actions{opacity:1}`,
  `.${NS_PREFIX}msg-action{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer}`,
  `.${NS_PREFIX}msg-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}streaming-dot{display:inline-block;width:6px;height:14px;background:var(--dsw-alias-state-business-primary);margin-left:2px;animation:${NS_PREFIX}blink 1s steps(2,start) infinite}`,
  `@keyframes ${NS_PREFIX}blink{to{visibility:hidden}}`,
  `.${NS_PREFIX}inputrow{display:flex;align-items:flex-end;gap:7px;padding:10px 11px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;background:var(--dsw-alias-bg-base,#fff)}`,
  `.${NS_PREFIX}input{flex:1;min-width:0;box-sizing:border-box;resize:none;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;outline:none;padding:7px 9px;font-size:13px;line-height:19px;font-family:inherit;max-height:120px}`,
  `.${NS_PREFIX}input:focus{border-color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}send{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-state-business-primary,#4f46e5);background:var(--dsw-alias-state-business-primary,#4f46e5);color:var(--dsw-alias-bg-base,#fff);border-radius:9px;cursor:pointer;transition:transform .12s ease,opacity .12s ease}`,
  `.${NS_PREFIX}send:not(:disabled):hover{transform:translateY(-1px)}`,
  `.${NS_PREFIX}send:disabled{opacity:.5;cursor:default}`,
  `.${NS_PREFIX}footer{display:flex;align-items:center;gap:6px;padding:7px 11px 9px;border-top:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;flex-wrap:wrap;background:var(--dsw-alias-bg-base,#fff)}`,
  `.${NS_PREFIX}btn{flex:none;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:24px;cursor:pointer;white-space:nowrap}`,
  `.${NS_PREFIX}btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}btn:disabled{opacity:.5;cursor:default}`,
  `.${NS_PREFIX}btn-primary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}`,
  `.${NS_PREFIX}error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:2px 10px}`,
  `.${NS_PREFIX}empty{padding:20px 14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:8px}`,
  `.${NS_PREFIX}menu{position:absolute;right:10px;top:38px;z-index:130;min-width:260px;max-width:calc(100% - 20px);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:var(--dsw-specific-shadow-2,none);padding:6px;display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto}`,
  `.${NS_PREFIX}menuitem{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:5px 8px;border:0;background:transparent;border-radius:6px;cursor:pointer;text-align:left;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}`,
  `.${NS_PREFIX}menuitem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}menuitem-role{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px}`,
  `.${NS_PREFIX}menuitem-main{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
  `.${NS_PREFIX}rename{flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;outline:none;padding:2px 8px;font-size:12px;line-height:20px}`,
  `.${NS_PREFIX}toggle{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid transparent;background:transparent;border-radius:7px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}`,
  `.${NS_PREFIX}toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}`,
  `.${NS_PREFIX}toggle-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}ask{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid transparent;background:transparent;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary)}`,
  `.${NS_PREFIX}ask:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}`,
  `.${NS_PREFIX}statusline{display:flex;align-items:center;gap:6px;padding:2px 10px;font-size:11px;color:var(--dsw-alias-label-caption,#94a3b8)}`,
  `.${NS_PREFIX}hint{padding:0 12px 8px;color:var(--dsw-alias-label-caption,#94a3b8);font-size:11px;line-height:16px}`,
  `@media (max-width:1024px){.${NS_PREFIX}panel{left:0;right:0;width:auto!important;max-width:none;min-width:0;border-left:none;box-shadow:none}.${NS_PREFIX}msg-actions{opacity:1}}`,
].join('\n')

// ── 组件 1：会话头部“侧聊”开关（session 作用域；同时是回传桥接器）────────────
function SideChatToggle(props) {
  useUi()
  const sessionId = props.sessionId
  const inputActions = props.inputActions
  const draftRef = React.useRef('')
  React.useEffect(() => {
    const unsub = ui.subscribe(() => {
      const pending = ui.pendingInsert
      if (pending !== null && pending.sessionId === sessionId) {
        const base = draftRef.current || ''
        const text = base.length > 0 ? `${base}\n\n${pending.text}` : pending.text
        try {
          inputActions.setDraft(text)
        } catch (error) {
          console.log('dsh-side-chat: 写入主聊天输入框失败', cleanError(error))
        }
        ui.clearPendingInsert()
      }
    })
    return unsub
  }, [sessionId, inputActions])

  const input = props.useInput
  // 会话作用域 slot 的标准 kit 恒提供 useInput（选择器钩子），
  // 无条件调用以保持钩子顺序稳定。
  if (input !== undefined) {
    // 渲染期读取当前草稿，供回传时保留用户已输入的内容。
    const draft = input((s) => (s === undefined ? '' : s.draft))
    if (draft !== draftRef.current) draftRef.current = draft
  }

  return React.createElement('button', {
    className: `${NS_PREFIX}toggle${ui.open ? ` ${NS_PREFIX}toggle-active` : ''}`,
    type: 'button',
    'aria-label': '侧边聊天',
    'aria-expanded': ui.open,
    'data-dsh-side-chat-toggle': 'true',
    title: '打开 / 关闭侧边聊天',
    onClick: () => {
      if (!ui.open && typeof sessionId === 'string' && sessionId.length > 0) {
        ui.setSession(sessionId)
      }
      ui.toggleOpen()
    },
  }, Icons.chat(15), React.createElement('span', null, '侧聊'))
}

// ── 组件 2：每条助手消息上的“在侧聊中询问” ───────────────────────────────────
function SideChatAskAction(props) {
  const sessionId = props.sessionId
  const messageId = props.messageId
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)

  const ask = () => {
    if (busy || typeof messageId !== 'string' || messageId.length === 0) return
    setBusy(true)
    setError(null)
    let selectionText = ''
    try {
      const selection = window.getSelection()
      if (selection !== null) selectionText = selection.toString().trim()
    } catch (error) {
      selectionText = ''
    }
    const anchor = selectionText !== ''
      ? { type: 'selection', messageId, text: selectionText }
      : { type: 'message', messageId }
    host.call('sideChat.create', { sessionId, anchor }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.setSession(sessionId)
        ui.setSideChats([res.sideChat, ...ui.sideChats])
        ui.setActive(res.sideChat.sideChatId)
        ui.setOpen(true)
      } else {
        setError(res !== null && res !== undefined && res.error !== undefined
          ? res.error.message
          : '创建侧聊失败')
      }
    }).catch((e) => setError(cleanError(e))).finally(() => setBusy(false))
  }

  return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center' } },
    React.createElement('button', {
      className: `${NS_PREFIX}ask`,
      type: 'button',
      'aria-label': '在侧聊中询问',
      title: error === null ? '在侧聊中询问（选中文字则引用选中内容）' : error,
      disabled: busy,
      onClick: ask,
    }, Icons.chat(14)))
}

// ── 组件 3：右侧面板（shell.overlay，根作用域） ─────────────────────────────
function SideChatPanel(props) {
  useUi()
  const currentSessionId = props.useSessions((s) => (s === undefined ? undefined : s.current))

  const [messages, setMessages] = React.useState([])
  const [status, setStatus] = React.useState('idle')
  const [liveError, setLiveError] = React.useState(null)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [showRecent, setShowRecent] = React.useState(false)
  const [recentList, setRecentList] = React.useState(null)
  const [panelError, setPanelError] = React.useState(null)
  const [copiedMessageId, setCopiedMessageId] = React.useState(null)
  const inputRef = React.useRef(null)
  const renameInputRef = React.useRef(null)
  const messagesRef = React.useRef(null)
  const messagesEndRef = React.useRef(null)
  const lastSeqRef = React.useRef(0)
  const lastTextRevRef = React.useRef(-1)
  const loadedRef = React.useRef(false)
  const statusRef = React.useRef('idle')
  const stickToBottomRef = React.useRef(true)

  statusRef.current = status
  const streaming = status === 'streaming' || status === 'stopping'

  /** 把增量消息并入现有列表（按 id 覆盖/追加，再按 seq 排序）。 */
  const mergeMessages = (prev, incoming) => {
    if (incoming.length === 0) return prev
    const byId = new Map()
    for (const message of prev) byId.set(message.id, message)
    for (const message of incoming) byId.set(message.id, message)
    return [...byId.values()].sort((a, b) => a.seq - b.seq)
  }

  // 打开 / 会话切换时：绑定会话 + 加载列表
  React.useEffect(() => {
    if (!ui.open) return
    if (typeof currentSessionId !== 'string' || currentSessionId.length === 0) {
      ui.setSession(null)
      setMessages([])
      setStatus('idle')
      loadedRef.current = false
      return
    }
    ui.setSession(currentSessionId)
    loadedRef.current = false
    setMessages([])
    setStatus('idle')
    setPanelError(null)
    host.call('sideChat.list', { sessionId: currentSessionId }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.setSideChats(res.sideChats, null)
      } else {
        ui.setSideChats([], res !== null && res !== undefined && res.error !== undefined
          ? res.error.message
          : '加载侧聊列表失败')
      }
    }).catch((e) => {
      ui.setSideChats([], cleanError(e))
    })
  }, [ui.open, currentSessionId])

  // 激活侧聊变化时：加载消息
  React.useEffect(() => {
    if (!ui.open || ui.activeSideChatId === null || typeof currentSessionId !== 'string') return
    const sideChatId = ui.activeSideChatId
    const sessionId = currentSessionId
    loadedRef.current = false
    lastSeqRef.current = -1
    lastTextRevRef.current = -1
    setMessages([])
    setStatus('idle')
    setLiveError(null)
    setConfirmDelete(false)
    setRenaming(false)
    setCopiedMessageId(null)
    stickToBottomRef.current = true
    host.call('sideChat.poll', { sessionId, sideChatId, sinceSeq: -1, sinceTextRev: -1 }).then((res) => {
      if (ui.activeSideChatId !== sideChatId) return
      if (res !== null && res !== undefined && res.ok === true) {
        setMessages(res.messages === undefined ? [] : res.messages)
        const initialStatus = res.status === undefined ? 'idle' : res.status
        setStatus(initialStatus)
        ui.patchSideChat(sideChatId, { status: initialStatus, error: res.error === undefined ? null : res.error })
        lastSeqRef.current = typeof res.seq === 'number' ? res.seq : 0
        lastTextRevRef.current = typeof res.textRev === 'number' ? res.textRev : -1
        loadedRef.current = true
      } else {
        setLiveError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '加载消息失败')
      }
    }).catch((e) => setLiveError(cleanError(e)))
  }, [ui.open, ui.activeSideChatId, currentSessionId])

  // 流式轮询：仅在 streaming 或尚未加载时轮询
  React.useEffect(() => {
    if (!ui.open || typeof currentSessionId !== 'string') return undefined
    if (pluginCtx === null) return undefined
    return pluginCtx.interval(() => {
      const sideChatId = ui.activeSideChatId
      if (sideChatId === null || typeof currentSessionId !== 'string') return
       if (statusRef.current !== 'streaming' && statusRef.current !== 'stopping' && loadedRef.current) return
      host.call('sideChat.poll', {
        sessionId: currentSessionId, sideChatId, sinceSeq: lastSeqRef.current, sinceTextRev: lastTextRevRef.current,
      }).then((res) => {
        if (ui.activeSideChatId !== sideChatId) return
        if (res !== null && res !== undefined && res.ok === true) {
          const incoming = res.messages === undefined ? [] : res.messages
          if (incoming.length > 0) {
            setMessages((prev) => mergeMessages(prev, incoming))
          }
          lastSeqRef.current = typeof res.seq === 'number' ? res.seq : lastSeqRef.current
          lastTextRevRef.current = typeof res.textRev === 'number' ? res.textRev : lastTextRevRef.current
          const nextStatus = res.status === undefined ? 'idle' : res.status
          ui.patchSideChat(sideChatId, { status: nextStatus, error: res.error === undefined ? null : res.error })
          if (nextStatus !== statusRef.current) {
            setStatus(nextStatus)
            loadedRef.current = true
          }
          if (res.error !== null && res.error !== undefined) setLiveError(res.error)
        } else if (res !== null && res !== undefined && res.ok === false) {
          setStatus('error')
          ui.patchSideChat(sideChatId, { status: 'error', error: res.error === undefined ? null : res.error })
          setLiveError(res.error !== undefined ? res.error.message : '轮询失败')
        }
      }).catch((e) => {
        setLiveError(cleanError(e))
      })
    }, 400)
  }, [ui.open, currentSessionId])

  // 打开时聚焦输入框；Escape 关闭面板
  React.useEffect(() => {
    if (!ui.open) return undefined
    const focusTimer = window.setTimeout(() => {
      if (inputRef.current !== null) inputRef.current.focus()
    }, 60)
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        ui.setOpen(false)
        focusSideChatToggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [ui.open])

  // 记忆面板宽度（注意：必须放在任何早退 return 之前，保持钩子顺序稳定）
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem('dsh-side-chat-width')
      if (saved !== null) {
        const n = Number(saved)
        if (Number.isFinite(n) && n >= 280 && n <= 720) {
          document.documentElement.style.setProperty('--dsh-side-chat-width', `${n}px`)
        }
      }
    } catch (error) {
      // 忽略。
    }
  }, [])

  // 只在用户仍停留在底部时跟随流式输出，避免打断用户回看历史消息。
  const lastMessageText = messages.length === 0 ? '' : messages[messages.length - 1].text
  React.useEffect(() => {
    if (!ui.open || !stickToBottomRef.current || messagesEndRef.current === null) return
    const frame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }))
      : null
    return () => {
      if (frame !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
    }
  }, [ui.open, messages.length, lastMessageText, streaming])

  // 让输入框随内容增长，保持 Codex 式紧凑 composer。
  React.useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [draft, ui.open, ui.activeSideChatId])

  React.useEffect(() => {
    if (!renaming || renameInputRef.current === null) return
    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [renaming])

  if (!ui.open) return null

  const sessionId = currentSessionId
  const activeSideChat = ui.sideChats.find((s) => s.sideChatId === ui.activeSideChatId) || null
  const anchor = activeSideChat === null ? null : activeSideChat.anchorSnapshot
  const closePanel = () => {
    ui.setOpen(false)
    focusSideChatToggle()
  }
  const onMessagesScroll = () => {
    const node = messagesRef.current
    if (node === null) return
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 72
  }
  const copyMessage = (message) => {
    if (message === null || typeof message.text !== 'string' || message.text === '') return
    const done = () => {
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400)
    }
    try {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(message.text).then(done).catch(() => setPanelError('复制失败'))
        return
      }
    } catch (error) {
      // 继续走兼容回退。
    }
    try {
      const helper = document.createElement('textarea')
      helper.value = message.text
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.appendChild(helper)
      helper.focus()
      helper.select()
      const ok = document.execCommand('copy')
      helper.remove()
      if (ok) done()
      else setPanelError('复制失败')
    } catch (error) {
      setPanelError('复制失败')
    }
  }

  const refreshList = () => {
    if (typeof sessionId !== 'string') return
    host.call('sideChat.list', { sessionId }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) ui.setSideChats(res.sideChats, null)
      else ui.setSideChats([], res !== null && res !== undefined && res.error !== undefined ? res.error.message : '刷新失败')
    }).catch((e) => ui.setSideChats([], cleanError(e)))
  }

  const createBlank = () => {
    if (typeof sessionId !== 'string') return
    setBusy(true)
    setPanelError(null)
    host.call('sideChat.create', { sessionId, anchor: { type: 'blank' } }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.setSideChats([res.sideChat, ...ui.sideChats])
        ui.setActive(res.sideChat.sideChatId)
        setDraft('')
      } else {
        setPanelError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '创建失败')
      }
    }).catch((e) => setPanelError(cleanError(e))).finally(() => setBusy(false))
  }

  const toggleRecent = () => {
    if (showRecent) {
      setShowRecent(false)
      return
    }
    if (typeof sessionId !== 'string') return
    setShowRecent(true)
    setRecentList(null)
    host.call('sideChat.recent', { sessionId, limit: 10 }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) setRecentList(res.messages)
      else setRecentList([])
    }).catch(() => setRecentList([]))
  }

  const createFromRecent = (item) => {
    if (typeof sessionId !== 'string') return
    setBusy(true)
    setPanelError(null)
    setShowRecent(false)
    host.call('sideChat.create', { sessionId, anchor: { type: 'message', messageId: item.messageId } }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.setSideChats([res.sideChat, ...ui.sideChats])
        ui.setActive(res.sideChat.sideChatId)
        setDraft('')
      } else {
        setPanelError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '创建失败')
      }
    }).catch((e) => setPanelError(cleanError(e))).finally(() => setBusy(false))
  }

  const send = () => {
    const text = draft.trim()
    if (text === '' || activeSideChat === null || typeof sessionId !== 'string' || streaming) return
    setDraft('')
    setBusy(true)
    setLiveError(null)
    host.call('sideChat.send', { sessionId, sideChatId: activeSideChat.sideChatId, text }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        setStatus('streaming')
        ui.patchSideChat(activeSideChat.sideChatId, {
          status: 'streaming',
          error: null,
          ...(typeof res.title === 'string' ? { title: res.title } : {}),
        })
        loadedRef.current = false
        host.call('sideChat.poll', {
          sessionId, sideChatId: activeSideChat.sideChatId, sinceSeq: lastSeqRef.current, sinceTextRev: lastTextRevRef.current,
        }).then((pollRes) => {
          if (pollRes !== null && pollRes !== undefined && pollRes.ok === true) {
            const incoming = pollRes.messages === undefined ? [] : pollRes.messages
            setMessages((prev) => mergeMessages(prev, incoming))
            lastSeqRef.current = typeof pollRes.seq === 'number' ? pollRes.seq : lastSeqRef.current
            lastTextRevRef.current = typeof pollRes.textRev === 'number' ? pollRes.textRev : lastTextRevRef.current
          }
        }).catch(() => {})
      } else {
        setLiveError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '发送失败')
      }
    }).catch((e) => setLiveError(cleanError(e))).finally(() => setBusy(false))
  }

  const stop = () => {
    if (activeSideChat === null || typeof sessionId !== 'string' || !streaming) return
    setStatus('stopping')
    ui.patchSideChat(activeSideChat.sideChatId, { status: 'stopping' })
    host.call('sideChat.stop', { sessionId, sideChatId: activeSideChat.sideChatId }).then((res) => {
      if (res !== null && res !== undefined && res.ok === false) {
        setStatus('error')
        ui.patchSideChat(activeSideChat.sideChatId, { status: 'error', error: res.error === undefined ? null : res.error })
        setLiveError(res.error !== undefined ? res.error.message : '停止失败')
      }
    }).catch((e) => setLiveError(cleanError(e)))
  }

  const removeSideChat = () => {
    if (activeSideChat === null || typeof sessionId !== 'string') return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setPanelError(null)
    const sideChatId = activeSideChat.sideChatId
    host.call('sideChat.delete', { sessionId, sideChatId }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        setConfirmDelete(false)
        refreshList()
      } else {
        setPanelError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '删除失败')
      }
    }).catch((e) => setPanelError(cleanError(e))).finally(() => setBusy(false))
  }

  const saveRename = () => {
    const title = renameDraft.trim()
    if (activeSideChat === null || title === '' || typeof sessionId !== 'string') return
    host.call('sideChat.rename', { sessionId, sideChatId: activeSideChat.sideChatId, title }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.setSideChats(ui.sideChats.map((s) => (
          s.sideChatId === res.sideChat.sideChatId ? res.sideChat : s
        )))
        setRenaming(false)
      } else {
        setPanelError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '重命名失败')
      }
    }).catch((e) => setPanelError(cleanError(e)))
  }

  const insertToMain = () => {
    if (activeSideChat === null || typeof sessionId !== 'string' || streaming) return
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const reply = lastAssistant !== undefined ? lastAssistant.text : ''
    const question = lastUser !== undefined ? lastUser.text : ''
    const lines = [`【侧聊 · ${activeSideChat.title}】`]
    if (question !== '') lines.push(`\n用户：${question}`)
    if (reply !== '') lines.push(`\n回复：${reply}`)
    else lines.push('\n（侧聊暂无回复）')
    ui.requestInsert(sessionId, lines.join(''))
  }

  const summarizeToMain = () => {
    if (activeSideChat === null || typeof sessionId !== 'string' || streaming || messages.length === 0) return
    setBusy(true)
    setPanelError(null)
    host.call('sideChat.summarize', { sessionId, sideChatId: activeSideChat.sideChatId }).then((res) => {
      if (res !== null && res !== undefined && res.ok === true) {
        ui.requestInsert(sessionId, `【侧聊摘要 · ${activeSideChat.title}】\n\n${res.text}`)
      } else {
        setPanelError(res !== null && res !== undefined && res.error !== undefined ? res.error.message : '生成摘要失败')
      }
    }).catch((e) => setPanelError(cleanError(e))).finally(() => setBusy(false))
  }

  const scrollToAnchor = () => {
    if (anchor === null || anchor === undefined) return
    const nodeKey = anchor.nodeKey
    if (typeof nodeKey !== 'string' || nodeKey === '') return
    const el = document.querySelector(`[data-chat-anchor-key="${cssEscape(nodeKey)}"]`)
    if (el !== null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const onResizeStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = document.documentElement.clientWidth - e.clientX
    const onMove = (ev) => {
      const width = Math.max(280, Math.min(720, startWidth + (startX - ev.clientX)))
      document.documentElement.style.setProperty('--dsh-side-chat-width', `${width}px`)
      try {
        window.localStorage.setItem('dsh-side-chat-width', String(width))
      } catch (error) {
        // localStorage 不可用时忽略宽度记忆。
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const children = []

  // 头部
  children.push(React.createElement('div', { key: 'header', className: `${NS_PREFIX}header` },
    React.createElement('span', { className: `${NS_PREFIX}title` }, '侧边聊天'),
    React.createElement('button', {
      className: `${NS_PREFIX}ibtn ${NS_PREFIX}ibtn-primary`,
      type: 'button',
      'aria-label': '新建空白侧聊',
      title: '新建空白侧聊',
      disabled: busy,
      onClick: createBlank,
    }, Icons.plus(14)),
    React.createElement('button', {
      className: `${NS_PREFIX}ibtn`,
      type: 'button',
      'aria-label': '从主聊天消息新建侧聊',
      title: '引用最近的主聊天消息',
      disabled: busy,
      onClick: toggleRecent,
    }, Icons.anchor(14)),
    React.createElement('button', {
      className: `${NS_PREFIX}ibtn`,
      type: 'button',
      'aria-label': '关闭侧边聊天面板',
      title: '关闭面板',
      onClick: closePanel,
    }, Icons.close(14)),
  ))

  // 最近消息菜单
  if (showRecent) {
    const menuItems = []
    if (recentList === null) {
      menuItems.push(React.createElement('div', { key: 'loading', className: `${NS_PREFIX}menuitem` }, '加载中…'))
    } else if (recentList.length === 0) {
      menuItems.push(React.createElement('div', { key: 'empty', className: `${NS_PREFIX}menuitem` }, '主会话还没有可引用的消息'))
    } else {
      for (const item of recentList) {
        menuItems.push(React.createElement('button', {
          key: item.messageId,
          className: `${NS_PREFIX}menuitem`,
          type: 'button',
          title: `引用这条${item.role === 'user' ? '用户消息' : '助手消息'}`,
          onClick: () => createFromRecent(item),
        },
          React.createElement('span', { className: `${NS_PREFIX}menuitem-role` }, item.role === 'user' ? '用户' : '助手'),
          React.createElement('span', { className: `${NS_PREFIX}menuitem-main` }, item.text),
        ))
      }
    }
    children.push(React.createElement('div', { key: 'menu', className: `${NS_PREFIX}menu` }, ...menuItems))
  }

  // 侧聊列表（切换）
  if (ui.sideChats.length > 0) {
    const rows = []
    for (const sideChat of ui.sideChats) {
      const dotClass = sideChat.status === 'streaming' || sideChat.status === 'stopping'
        ? `${NS_PREFIX}listrow-dot ${NS_PREFIX}listrow-dot-stream`
        : sideChat.status === 'error'
          ? `${NS_PREFIX}listrow-dot ${NS_PREFIX}listrow-dot-error`
          : `${NS_PREFIX}listrow-dot`
      rows.push(React.createElement('button', {
        key: sideChat.sideChatId,
        className: `${NS_PREFIX}listrow${sideChat.sideChatId === ui.activeSideChatId ? ` ${NS_PREFIX}listrow-active` : ''}`,
        type: 'button',
        'aria-current': sideChat.sideChatId === ui.activeSideChatId ? 'true' : undefined,
        'aria-label': `${sideChat.title}${sideChat.status === 'streaming' || sideChat.status === 'stopping' ? '（生成中）' : ''}`,
        onClick: () => ui.setActive(sideChat.sideChatId),
      },
         React.createElement('span', { className: dotClass }),
         React.createElement('span', { className: `${NS_PREFIX}listrow-main` }, sideChat.title),
         React.createElement('span', { className: `${NS_PREFIX}listrow-time` }, fmtTime(sideChat.updatedAt)),
         React.createElement('span', null, sideChat.status === 'streaming' ? '生成中' : sideChat.status === 'stopping' ? '停止中' : ''),
      ))
    }
    children.push(React.createElement('div', { key: 'list', className: `${NS_PREFIX}list`, role: 'list', 'aria-label': '侧聊列表' }, ...rows))
  }

  // 当前侧聊：锚点 + 重命名
  if (activeSideChat !== null) {
    if (anchor !== null && anchor !== undefined) {
      const anchorText = typeof anchor.text === 'string' ? anchor.text : ''
      const sourceLabel = typeof anchor.sourceLabel === 'string' ? anchor.sourceLabel : '引用内容'
      children.push(React.createElement('div', { key: 'anchor', className: `${NS_PREFIX}anchor` },
        React.createElement('div', { className: `${NS_PREFIX}anchor-body`, title: anchorText },
          React.createElement('span', { className: `${NS_PREFIX}anchor-source` }, sourceLabel),
          React.createElement('span', { className: `${NS_PREFIX}anchor-text` }, anchorText === '' ? '（无文本）' : anchorText),
        ),
        typeof anchor.nodeKey === 'string' && anchor.nodeKey !== ''
          ? React.createElement('button', {
            className: `${NS_PREFIX}anchor-go`,
            type: 'button',
            'aria-label': '在主聊天中定位该消息',
            onClick: scrollToAnchor,
          }, Icons.anchor(11), React.createElement('span', null, '定位'))
          : null,
      ))
    }
    if (renaming) {
      children.push(React.createElement('div', { key: 'rename', className: `${NS_PREFIX}header` },
        React.createElement('input', {
          ref: renameInputRef,
          className: `${NS_PREFIX}rename`,
          value: renameDraft,
          'aria-label': '侧聊标题',
          onChange: (e) => setRenameDraft(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') saveRename()
            if (e.key === 'Escape') setRenaming(false)
          },
        }),
        React.createElement('button', { className: `${NS_PREFIX}btn ${NS_PREFIX}btn-primary`, type: 'button', onClick: saveRename }, '保存'),
        React.createElement('button', { className: `${NS_PREFIX}btn`, type: 'button', onClick: () => setRenaming(false) }, '取消'),
      ))
    } else {
      children.push(React.createElement('div', { key: 'titlebar', className: `${NS_PREFIX}header` },
        React.createElement('span', { className: `${NS_PREFIX}title`, title: activeSideChat.title }, activeSideChat.title),
        React.createElement('button', {
          className: `${NS_PREFIX}ibtn`,
          type: 'button',
          'aria-label': '重命名侧聊',
          title: '重命名',
          onClick: () => { setRenameDraft(activeSideChat.title); setRenaming(true) },
        }, Icons.edit(14)),
        React.createElement('button', {
          className: `${NS_PREFIX}ibtn ${NS_PREFIX}ibtn-danger${confirmDelete ? ` ${NS_PREFIX}ibtn-primary` : ''}`,
          type: 'button',
          'aria-label': confirmDelete ? '再次点击确认删除侧聊' : '删除侧聊',
          title: confirmDelete ? '再次点击确认删除' : '删除侧聊',
          disabled: busy,
          onClick: removeSideChat,
        }, Icons.trash(14)),
      ))
    }
  }

  // 消息列表
  if (activeSideChat !== null) {
    const msgEls = []
    if (messages.length === 0 && !streaming) {
      msgEls.push(React.createElement('div', { key: 'empty', className: `${NS_PREFIX}empty` },
        React.createElement('span', null, anchor === null || anchor === undefined ? '空白侧聊 — 直接提问开始讨论。' : '引用已就绪 — 就此内容提问。'),
      ))
    }
    for (const message of messages) {
      const isUser = message.role === 'user'
      const copied = copiedMessageId === message.id
      msgEls.push(React.createElement('div', {
        key: message.id,
        className: `${NS_PREFIX}msg-wrap ${isUser ? `${NS_PREFIX}msg-wrap-user` : `${NS_PREFIX}msg-wrap-assistant`}`,
      },
        React.createElement('div', { className: `${NS_PREFIX}msg ${isUser ? `${NS_PREFIX}msg-user` : `${NS_PREFIX}msg-assistant`}` },
          message.text,
          React.createElement('span', { className: `${NS_PREFIX}msg-time` }, fmtTime(message.time)),
        ),
        React.createElement('div', { className: `${NS_PREFIX}msg-actions` },
          React.createElement('button', {
            className: `${NS_PREFIX}msg-action`,
            type: 'button',
            'aria-label': copied ? '已复制' : '复制消息',
            title: copied ? '已复制' : '复制消息',
            onClick: () => copyMessage(message),
          }, copied ? '✓' : Icons.copy(12)),
        ),
      ))
    }
    if (streaming) {
      msgEls.push(React.createElement('div', { key: 'streaming', className: `${NS_PREFIX}msg ${NS_PREFIX}msg-assistant` },
        React.createElement('span', { className: `${NS_PREFIX}streaming-dot` }),
      ))
    }
    msgEls.push(React.createElement('div', { key: 'messages-end', ref: messagesEndRef, 'aria-hidden': true }))
    children.push(React.createElement('div', {
      key: 'msgs',
      ref: messagesRef,
      className: `${NS_PREFIX}msgs`,
      role: 'log',
      'aria-live': 'polite',
      'aria-label': '侧聊消息',
      onScroll: onMessagesScroll,
    }, ...msgEls))
  } else {
    children.push(React.createElement('div', { key: 'empty', className: `${NS_PREFIX}empty` },
      React.createElement('span', null, '还没有侧聊。'),
      React.createElement('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center' } },
        React.createElement('button', { className: `${NS_PREFIX}btn ${NS_PREFIX}btn-primary`, type: 'button', disabled: busy, onClick: createBlank }, '新建空白侧聊'),
        React.createElement('button', { className: `${NS_PREFIX}btn`, type: 'button', disabled: busy, onClick: toggleRecent }, '引用主聊天消息'),
      ),
    ))
  }

  if (liveError !== null) {
    children.push(React.createElement('div', { key: 'liveerror', className: `${NS_PREFIX}error` }, liveError))
  }
  if (panelError !== null) {
    children.push(React.createElement('div', { key: 'panelerror', className: `${NS_PREFIX}error` }, panelError))
  }
  if (ui.listError !== null) {
    children.push(React.createElement('div', { key: 'listerror', className: `${NS_PREFIX}error` }, ui.listError))
  }

  // 输入区 + 停止
  if (activeSideChat !== null) {
    children.push(React.createElement('div', { key: 'input', className: `${NS_PREFIX}inputrow` },
      React.createElement('textarea', {
        ref: inputRef,
        className: `${NS_PREFIX}input`,
        rows: 2,
        value: draft,
        placeholder: streaming ? '正在生成…' : '在侧聊中提问…',
        'aria-label': '侧聊消息输入',
        disabled: streaming,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        },
      }),
      streaming
        ? React.createElement('button', {
          className: `${NS_PREFIX}send`,
          type: 'button',
          'aria-label': '停止生成',
          title: '停止生成',
          onClick: stop,
        }, Icons.stop(14))
        : React.createElement('button', {
          className: `${NS_PREFIX}send`,
          type: 'button',
          'aria-label': '发送',
          title: '发送',
          disabled: draft.trim() === '' || busy,
          onClick: send,
      }, Icons.send(14)),
    ))
    children.push(React.createElement('div', { key: 'hint', className: `${NS_PREFIX}hint` }, 'Enter 发送 · Shift+Enter 换行 · Esc 关闭侧聊'))
  }

  // 底部：回传主聊天
  if (activeSideChat !== null) {
    const statusText = status === 'streaming' ? '生成中…'
      : status === 'stopping' ? '停止中…'
        : status === 'stopped' ? '已停止'
        : status === 'error' ? '出错'
          : ''
    const hasAssistantReply = messages.some((message) => message.role === 'assistant' && message.text.trim() !== '')
    children.push(React.createElement('div', { key: 'footer', className: `${NS_PREFIX}footer` },
      React.createElement('button', {
        className: `${NS_PREFIX}btn`,
        type: 'button',
        disabled: busy || streaming || !hasAssistantReply,
        title: '把侧聊最后一条回复放入主聊天输入框（不会自动发送）',
        onClick: insertToMain,
      }, '插入主聊天输入框'),
      React.createElement('button', {
        className: `${NS_PREFIX}btn ${NS_PREFIX}btn-primary`,
        type: 'button',
        disabled: busy || streaming || messages.length === 0,
        title: '让模型总结本侧聊，结果放入主聊天输入框（不会自动发送）',
        onClick: summarizeToMain,
      }, Icons.summary(12), ' 总结到主聊天'),
      statusText !== '' ? React.createElement('span', { className: `${NS_PREFIX}statusline`, role: 'status', 'aria-live': 'polite' }, statusText) : null,
    ))
  }

  return React.createElement('div', {
    className: `${NS_PREFIX}panel`,
    role: 'complementary',
    'aria-label': '侧边聊天',
  },
    React.createElement('div', { className: `${NS_PREFIX}handle`, onPointerDown: onResizeStart }),
    ...children)
}

// ── 插件出口 ────────────────────────────────────────────────────────────────
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    pluginCtx = ctx
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert(CSS)

    slots.inject('conversation.session.header.actions', () => slots.register(
      { name: 'conversation.session.header.actions', id: 'side-chat-toggle', order: 30, label: '侧聊' },
      (props) => React.createElement(SideChatToggle, props),
    ))

    slots.inject('conversation.chat.assistant-actions', () => slots.register(
      { name: 'conversation.chat.assistant-actions', id: 'side-chat-ask', order: 40, label: '侧聊' },
      (props) => React.createElement(SideChatAskAction, props),
    ))

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'side-chat-panel', order: 0, label: '侧边聊天' },
      (props) => React.createElement(SideChatPanel, props),
    ))
  },
}
