// dsh-side-chat client: only the split shell and side-chat-specific controls are custom.
// Transcript, header, composer, approvals, questions, attachments and controls stay in DSH slots.

const CSS = `
.dsh-sc-root{display:flex;height:100%;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}
.dsh-sc-column{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;background:var(--dsw-alias-bg-base)}
.dsh-sc-column-main{flex:1 1 0}
.dsh-sc-column-side{flex:0 0 var(--dsh-sc-side-width,50%)}
.dsh-sc-column>[data-phase]{flex:1;min-height:0}
.dsh-sc-column-side [data-conversation-scroll]>[data-composer-seat]{margin-top:auto}
.dsh-sc-resizer{position:relative;z-index:40;flex:0 0 7px;margin:0 -3px;cursor:col-resize;touch-action:none;outline:none}
.dsh-sc-resizer::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:1px;background:var(--dsw-alias-border-l2);transition:width .12s,background .12s}
.dsh-sc-resizer:hover::after,.dsh-sc-resizer:focus-visible::after{left:2px;width:3px;background:var(--dsw-alias-state-business-primary)}
.dsh-sc-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-sc-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-sc-action:disabled{opacity:.5;cursor:default}
.dsh-sc-icon-action{width:30px;padding:0}
.dsh-sc-side-actions{position:absolute;top:10px;right:12px;z-index:30;display:flex;gap:4px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated)}
.dsh-sc-selection{position:fixed;z-index:1000;transform:translate(-50%,-100%);padding-bottom:8px}
.dsh-sc-selection .dsh-sc-action{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-elevated);box-shadow:0 6px 22px rgba(0,0,0,.16);white-space:nowrap}
.dsh-sc-modal-backdrop{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;background:rgba(0,0,0,.36)}
.dsh-sc-modal{width:min(420px,calc(100vw - 32px));padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-elevated);box-shadow:0 18px 60px rgba(0,0,0,.24)}
.dsh-sc-modal h3{margin:0 0 8px;color:var(--dsw-alias-label-primary);font-size:16px}.dsh-sc-modal p{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.6}
.dsh-sc-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.dsh-sc-danger{background:var(--dsw-alias-error-bg,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-error,var(--dsw-alias-label-primary))}
.dsh-sc-error{position:absolute;right:14px;bottom:14px;z-index:20;max-width:360px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-elevated);color:var(--dsw-alias-label-secondary);font-size:12px}
@media(max-width:980px){.dsh-sc-root{overflow-x:auto}.dsh-sc-column{min-width:440px}.dsh-sc-column-side{flex-basis:var(--dsh-sc-side-width,50%)}}
`

const initialState = Object.freeze({ open: false, hidden: false, busy: false, dialog: false, sideRatio: 50, parentId: null, sideId: null, anchorText: '', error: '' })
let uiState = initialState
const subscribers = new Set()
let sessionsService = null
let NativeConversationRoot = null
let projectedSideSessions = new WeakMap()

function update(patch) {
  uiState = Object.freeze({ ...uiState, ...patch })
  for (const subscriber of subscribers) subscriber()
}

function subscribe(listener) {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

function useSideState() {
  return React.useSyncExternalStore(subscribe, () => uiState, () => uiState)
}

function useObservable(source, selector, fallback) {
  return React.useSyncExternalStore(
    listener => source === undefined ? () => {} : source.subscribe(listener),
    () => source === undefined ? fallback : selector(source.getSnapshot()),
    () => source === undefined ? fallback : selector(source.getSnapshot()),
  )
}

function h(type, props, ...children) {
  return React.createElement(type, props, ...children)
}

async function rpc(method, input) {
  return host.call(method, input)
}

async function openSide(parentId, anchorText = '') {
  if (uiState.busy) return
  update({ busy: true, error: '' })
  try {
    const result = await rpc('sideChat.open', { parentSessionId: parentId, anchorText })
    update({ open: true, hidden: false, dialog: false, busy: false, parentId, sideId: result.sessionId, anchorText })
  } catch (error) {
    update({ busy: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function finishClose(mode) {
  const sideId = uiState.sideId
  if (sideId === null || uiState.busy) return
  update({ busy: true, error: '' })
  try {
    await rpc('sideChat.close', { sessionId: sideId, mode })
    update({ ...initialState })
  } catch (error) {
    update({ busy: false, dialog: false, error: error instanceof Error ? error.message : String(error) })
  }
}

function ActionButton({ children, onClick, disabled, className = '' }) {
  return h('button', { type: 'button', className: `dsh-sc-action ${className}`, onClick, disabled }, children)
}

function PanelRightIcon() {
  return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true },
    h('rect', { x: 1.5, y: 2, width: 13, height: 12, rx: 2.25, stroke: 'currentColor', strokeWidth: 1.4 }),
    h('path', { d: 'M10.25 2.25v11.5', stroke: 'currentColor', strokeWidth: 1.4 }),
  )
}

// Same message-plus glyph used by DSH's native New Session control.
function SideChatIcon() {
  return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true },
    h('path', {
      d: 'M8.00003 .3237C3.76075.3237.32373 3.76072.32373 8c0 1.17603.265391 2.2922.73947 3.2901l.28971.6088 1.21759-.5784-.28971-.6088A6.285 6.285 0 0 1 1.67301 8c0-3.49454 2.83248-6.32702 6.32702-6.32702S14.3271 4.50546 14.3271 8s-2.8325 6.327-6.32707 6.327c-.7153 0-1.23926-.05-1.70382-.1783-.45764-.1263-.8918-.3378-1.41107-.6999-.75945-.5298-1.84736-.7172-2.74414-.151l-.02836.0193-.76378.5369.44773 1.334 1.06463-.7496c.32946-.2079.82203-.1842 1.25204.1155.61463.4287 1.18716.7185 1.82436.8945.63041.174 1.29014.2279 2.06241.2279 4.23927 0 7.67627-3.437 7.67627-7.6763S12.2393.3237 8.00003.3237Zm-.6797 4.50165v2.50001H4.82538v1.34928h2.49495v2.50006H8.6696V8.67464h2.5051V7.32536H8.6696V4.82535H7.32033Z',
      fill: 'currentColor',
    }),
  )
}

function CloseIcon() {
  return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
  )
}

function IconAction({ label, children, onClick, disabled }) {
  return h('button', {
    type: 'button',
    className: 'dsh-sc-action dsh-sc-icon-action',
    'aria-label': label,
    title: label,
    onClick,
    disabled,
  }, children)
}

function HeaderAction({ sessionId }) {
  const state = useSideState()
  if (sessionId === state.sideId) return null
  if (state.open) {
    if (sessionId !== state.parentId) return null
    if (!state.hidden) return null
    return h(IconAction, { label: '显示侧聊', onClick: () => update({ hidden: false }) }, h(SideChatIcon))
  }
  return h(IconAction, {
    label: state.busy ? '正在开启侧聊' : '打开侧聊',
    disabled: state.busy,
    onClick: () => openSide(sessionId),
  }, h(SideChatIcon))
}

function SideNativeConversation({ kit, providedInfo }) {
  const projectSession = value => {
    if (value?.composerPhase !== 'blank' || typeof value !== 'object') return value
    const cached = projectedSideSessions.get(value)
    if (cached !== undefined) return cached
    const projected = Object.freeze({ ...value, composerPhase: 'active' })
    projectedSideSessions.set(value, projected)
    return projected
  }
  const useSession = selector => useObservable(
    providedInfo?.hooks?.session,
    value => selector(projectSession(value)),
    undefined,
  )
  const useInput = selector => useObservable(providedInfo?.hooks?.input, selector, undefined)
  const useComposerBlock = selector => useObservable(providedInfo?.hooks?.composerBlock, selector, undefined)

  return h(NativeConversationRoot, {
    ...kit,
    sessionId: providedInfo.sessionId,
    useSession,
    useInput,
    useComposerBlock,
  })
}

function CloseDialog() {
  const state = useSideState()
  if (!state.dialog) return null
  return h('div', { className: 'dsh-sc-modal-backdrop', role: 'presentation', onMouseDown: event => {
    if (event.target === event.currentTarget && !state.busy) update({ dialog: false })
  } },
  h('div', { className: 'dsh-sc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-sc-close-title' },
    h('h3', { id: 'dsh-sc-close-title' }, '关闭侧聊？'),
    h('p', null, '默认关闭后会删除这段侧聊，不留记录、不存档。你也可以选择保留，以便稍后从当前主会话重新打开。'),
    h('div', { className: 'dsh-sc-modal-actions' },
      h(ActionButton, { disabled: state.busy, onClick: () => update({ dialog: false }) }, '取消'),
      h(ActionButton, { disabled: state.busy, onClick: () => finishClose('keep') }, '保留对话'),
      h(ActionButton, { disabled: state.busy, className: 'dsh-sc-danger', onClick: () => finishClose('delete') }, state.busy ? '正在删除…' : '删除并关闭'),
    ),
  ))
}

function ParallelConversation(props) {
  const state = useSideState()
  const splitRef = React.useRef(null)
  const mainRef = React.useRef(null)
  const [selection, setSelection] = React.useState(null)
  const SessionProvider = props.SessionProvider

  // DSH currently exposes only a current-session SessionProvider. Calling its stable
  // component unconditionally reveals the framework-owned BindingContext.Provider;
  // we then supply the arbitrary child SessionProvideInfo without copying any UI.
  const providerProbe = SessionProvider({ empty: () => null, children: () => null })
  const BindingProvider = providerProbe.type
  const sideInfo = state.sideId === null ? undefined : sessionsService?.provideInfo?.(state.sideId)

  React.useEffect(() => {
    if (!state.open || state.sideId === null || state.anchorText === '') return
    let cancelled = false
    let attempts = 0
    const applyDraft = () => {
      if (cancelled) return
      const info = sessionsService?.provideInfo?.(state.sideId)
      const setDraft = info?.props?.inputActions?.setDraft
      if (typeof setDraft === 'function') {
        setDraft(`请围绕主对话中选中的这段文字继续讨论：\n\n> ${state.anchorText.replaceAll('\n', '\n> ')}`)
        update({ anchorText: '' })
        return
      }
      attempts += 1
      if (attempts < 40) setTimeout(applyDraft, 100)
    }
    applyDraft()
    return () => { cancelled = true }
  }, [state.open, state.sideId, state.anchorText])

  React.useEffect(() => {
    const root = mainRef.current
    if (root === null) return undefined
    const onMouseUp = event => {
      const target = event.target
      if (!(target instanceof Node) || !root.contains(target)) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.closest?.('[contenteditable="true"]')) return
      const selected = window.getSelection()
      const text = selected?.toString().trim() ?? ''
      if (text.length < 2 || selected.rangeCount === 0) {
        setSelection(null)
        return
      }
      const range = selected.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) return
      const rect = range.getBoundingClientRect()
      setSelection({ text: text.slice(0, 8000), x: rect.left + rect.width / 2, y: Math.max(8, rect.top) })
    }
    root.addEventListener('mouseup', onMouseUp)
    return () => root.removeEventListener('mouseup', onMouseUp)
  }, [])

  const selectionButton = selection === null ? null : h('div', {
    className: 'dsh-sc-selection',
    style: { left: `${selection.x}px`, top: `${selection.y}px` },
  }, h(ActionButton, { onClick: () => {
    const text = selection.text
    setSelection(null)
    window.getSelection()?.removeAllRanges()
    void openSide(props.sessionId, text)
  } }, '在侧聊中对话'))

  const main = h('section', { ref: mainRef, className: 'dsh-sc-column dsh-sc-column-main', 'data-side-chat-main': '' },
    h(NativeConversationRoot, props),
  )
  const resize = event => {
    const root = splitRef.current
    if (root === null) return
    event.preventDefault()
    const rect = root.getBoundingClientRect()
    const move = moveEvent => {
      const ratio = Math.min(70, Math.max(25, ((rect.right - moveEvent.clientX) / rect.width) * 100))
      update({ sideRatio: Math.round(ratio * 10) / 10 })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const resizeKey = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.shiftKey ? 5 : 2
    update({ sideRatio: Math.min(70, Math.max(25, state.sideRatio + (event.key === 'ArrowLeft' ? delta : -delta))) })
  }
  const divider = state.open && !state.hidden
    ? h('div', {
      className: 'dsh-sc-resizer',
      role: 'separator',
      tabIndex: 0,
      'aria-label': '调整主对话与侧聊宽度',
      'aria-orientation': 'vertical',
      'aria-valuemin': 25,
      'aria-valuemax': 70,
      'aria-valuenow': Math.round(state.sideRatio),
      onPointerDown: resize,
      onKeyDown: resizeKey,
    })
    : null
  let side = null
  if (state.open && !state.hidden) {
    side = h('section', { className: 'dsh-sc-column dsh-sc-column-side', 'data-side-chat-side': '' },
      h('div', { className: 'dsh-sc-side-actions' },
        h(IconAction, { label: '隐藏侧聊', onClick: () => update({ hidden: true }) }, h(PanelRightIcon)),
        h(IconAction, {
          label: '关闭侧聊',
          disabled: state.busy,
          onClick: () => update({ dialog: true }),
        }, h(CloseIcon)),
      ),
      sideInfo === undefined
        ? h('div', { className: 'dsh-sc-error' }, '正在连接原生侧聊会话…')
        : h(BindingProvider, { value: sideInfo, key: state.sideId },
          h(SideNativeConversation, { kit: props, providedInfo: sideInfo }),
        ),
    )
  }
  return h(React.Fragment, null,
    h('div', {
      ref: splitRef,
      className: 'dsh-sc-root',
      style: { '--dsh-sc-side-width': `${state.sideRatio}%` },
    }, main, divider, side),
    selectionButton,
    state.error === '' ? null : h('div', { className: 'dsh-sc-error' }, state.error),
    h(CloseDialog),
  )
}

function adoptNativeConversation(slots) {
  // ui-slots intentionally exposes child rendering only to the entry that owns
  // the declarations. Preserve that exact native entry and change only its face.
  // `_core` is the current DSH runtime adapter seam; fail loud if upstream moves it.
  const core = slots?._core
  const entries = core?.entries?.('conversation')
  const nativeEntry = Array.isArray(entries)
    ? entries.find(entry => entry?.children?.['conversation.session'] !== undefined
      && entry?.children?.['conversation.composer.bar'] !== undefined)
    : undefined
  if (nativeEntry === undefined) {
    throw new Error('dsh-side-chat: native conversation entry is unavailable')
  }
  const previous = nativeEntry.component
  NativeConversationRoot = previous
  nativeEntry.component = ParallelConversation
  // A transient lower-priority occupant changes the conversation version once,
  // so an already-mounted page adopts the new face without owning child slots.
  const pulse = slots.register({ name: 'conversation', priority: -100 }, () => null)
  pulse()
  return () => {
    if (nativeEntry.component === ParallelConversation) nativeEntry.component = previous
    NativeConversationRoot = null
    const refresh = slots.register({ name: 'conversation', priority: -100 }, () => null)
    refresh()
  }
}

return {
  inject: ['slots', 'timer', 'sessions'],
  apply(ctx) {
    const slots = ctx.get('slots')
    sessionsService = ctx.get('sessions')
    styles.insert(CSS)

    const releaseConversation = adoptNativeConversation(slots)

    slots.register({
      name: 'conversation.session.header.actions',
      id: 'side-chat',
      order: 90,
    }, HeaderAction)

    ctx.effect(() => () => {
      releaseConversation()
      subscribers.clear()
      sessionsService = null
      projectedSideSessions = new WeakMap()
      uiState = initialState
    }, 'dsh-side-chat: client state')
  },
}
