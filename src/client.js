// dsh-side-chat client: a right-Sidebar tab hosting an independent, archived
// side Session beside the main conversation.
//
// DSH 0.1.6-alpha.2 ships the seam for this: `SessionProvider` accepts a
// `session` reference (`sessions.retain(id, { source })`) and rebinds its
// subtree to that Session, so the tab renders the shipped conversation —
// transcript, composer, model picker — for the side Session natively.

const CSS = `
.dsh-sc-panel{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px)}
.dsh-sc-panel-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dsh-sc-head{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;min-width:0}
.dsh-sc-head-title{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-spacer{flex:1 1 auto}
.dsh-sc-icon-button{display:grid;place-items:center;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-sc-icon-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-sc-icon-button:disabled{opacity:.5;cursor:default}
.dsh-sc-empty{margin:auto;max-width:270px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.75}
.dsh-sc-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-sc-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-action:disabled{opacity:.5;cursor:default}
.dsh-sc-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-sc-error{margin:0;padding:6px 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.dsh-sc-modal-backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.52)}
.dsh-sc-modal{box-sizing:border-box;width:min(420px,100%);padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-elevated);box-shadow:var(--dsw-elevation-soft)}
.dsh-sc-modal h3{margin:0 0 8px;font-size:16px}.dsh-sc-modal p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dsh-sc-modal-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}
.dsh-sc-remember-choice{display:inline-flex;align-items:center;gap:7px;margin-right:auto;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.dsh-sc-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-sc-settings{width:min(760px,100%);padding:8px 0 40px}
.dsh-sc-settings-head{padding:0 0 20px}.dsh-sc-settings-head h2{margin:0;font-size:20px;font-weight:600}
.dsh-sc-settings-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px;min-height:72px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-sc-settings-title{font-size:14px;font-weight:500}.dsh-sc-settings-desc{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dsh-sc-settings-select{min-width:148px;height:34px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-sc-switch{position:relative;width:36px;height:20px;flex:none}.dsh-sc-switch input{position:absolute;opacity:0;pointer-events:none}.dsh-sc-switch span{display:block;width:100%;height:100%;border-radius:10px;background:var(--dsw-alias-border-l2);transition:background .15s}.dsh-sc-switch span::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-elevated);box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .15s}.dsh-sc-switch input:checked+span{background:var(--dsw-alias-state-business-primary)}.dsh-sc-switch input:checked+span::after{transform:translateX(16px)}
`

const PREFERENCE_KEY = 'dsh-side-chat.preferences.v1'
const TAB_ID = 'side-chat'
const TAB_KIND = 'side-chat'
/** Keyed child slot declared by the tab body; the native conversation lives in it. */
const CONVERSATION_SLOT = 'sidechat.conversation'
const PRESET_OPTIONS = Object.freeze([
  { id: 'standard', label: '标准模式' },
  { id: 'ptc', label: 'PTC 模式' },
  { id: 'minimal', label: '极简模式' },
  { id: 'cordis', label: '创造模式' },
])
const CLOSE_BEHAVIOR_OPTIONS = Object.freeze([
  { id: 'ask', label: '每次询问' },
  { id: 'keep', label: '始终保留' },
  { id: 'delete', label: '始终删除' },
])

function storedPreferences() {
  const fallback = { enabled: true, preset: 'standard', closeBehavior: 'ask', readOnly: true }
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(PREFERENCE_KEY) ?? 'null')
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
      preset: PRESET_OPTIONS.some(option => option.id === parsed?.preset) ? parsed.preset : fallback.preset,
      closeBehavior: CLOSE_BEHAVIOR_OPTIONS.some(option => option.id === parsed?.closeBehavior) ? parsed.closeBehavior : fallback.closeBehavior,
      readOnly: typeof parsed?.readOnly === 'boolean' ? parsed.readOnly : fallback.readOnly,
    }
  } catch (_error) {
    return fallback
  }
}

const initialState = Object.freeze({
  sides: new Map(),
  busy: false,
  dialog: null,
  error: '',
  errorParentId: null,
  ...storedPreferences(),
})
let uiState = initialState
const subscribers = new Set()
let sessionsService = null
let conversationService = null
let sidebarRight = null
let uiWorkspace = null
let workspaces = null

function update(patch) {
  uiState = Object.freeze({ ...uiState, ...patch })
  for (const subscriber of subscribers) subscriber()
}

function setSide(parentId, side) {
  const sides = new Map(uiState.sides)
  sides.set(parentId, Object.freeze(side))
  update({ sides })
}

function dropSide(parentId) {
  const sides = new Map(uiState.sides)
  sides.delete(parentId)
  update({ sides, dialog: null })
}

function findSideOwner(state, sideId) {
  for (const [parentId, side] of state.sides) {
    if (side.sideId === sideId) return { parentId, side }
  }
  return undefined
}

function updatePreferences(patch) {
  update(patch)
  try {
    globalThis.localStorage?.setItem(PREFERENCE_KEY, JSON.stringify({
      enabled: uiState.enabled,
      preset: uiState.preset,
      closeBehavior: uiState.closeBehavior,
      readOnly: uiState.readOnly,
    }))
  } catch (_error) {}
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

/** Open (or reveal) the side Session for one main Session and focus its tab. */
async function openSide(parentId) {
  if (!uiState.enabled || uiState.busy) return
  const existing = uiState.sides.get(parentId)
  if (existing !== undefined) {
    update({ error: '', errorParentId: null })
    archiveIfPresent(existing.sideId)
    focusSideTab()
    return
  }
  update({ busy: true, error: '', errorParentId: null })
  try {
    const result = await rpc('sideChat.open', {
      parentSessionId: parentId,
      preset: uiState.preset,
      readOnly: uiState.readOnly,
    })
    setSide(parentId, { sideId: result.sessionId, readOnly: result.readOnly !== false })
    update({ busy: false })
    focusSideTab()
  } catch (error) {
    update({ busy: false, error: error instanceof Error ? error.message : String(error), errorParentId: parentId })
  }
}

function focusSideTab() {
  try {
    sidebarRight?.openTab?.(TAB_KIND)
  } catch (error) {
    // No session surface is mounted yet; the tab still shows the panel.
    void error
  }
}

/**
 * Select the side Session in the main area, where the shipped conversation
 * renders it. A workspace Session must not be archived to be selected there,
 * so this un-archives first; the panel re-archives on the way back.
 */
async function openInMainArea(sideId) {
  try {
    await workspaces?.unarchiveSession?.(sideId)
    uiWorkspace?.openSession?.(sideId)
  } catch (error) {
    console.error('[dsh-side-chat] opening the side session in the main area failed', error)
  }
}

/** Return the side Session to the hidden pool once the panel is on screen again. */
function archiveIfPresent(sideId) {
  if (sideId === undefined) return
  void workspaces?.archiveSession?.(sideId)?.catch?.(() => {})
}

async function closeSide(parentId, sideId, mode) {
  if (uiState.busy) return
  update({ busy: true, error: '', errorParentId: null })
  try {
    await rpc('sideChat.close', { sessionId: sideId, mode })
    dropSide(parentId)
    update({ busy: false })
  } catch (error) {
    update({ busy: false, dialog: null, error: error instanceof Error ? error.message : String(error), errorParentId: parentId })
  }
}

/** Ask, or apply, the configured close behavior. */
function requestClose(parentId, sideId) {
  if (uiState.closeBehavior === 'ask') update({ dialog: { parentId, sideId } })
  else void closeSide(parentId, sideId, uiState.closeBehavior)
}

/* ---------------------------------------------------------------- promotion */

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

/** Read one finalized assistant answer from a Session's event window. */
function findAssistantMessageText(sessionId, messageId) {
  const entries = sessionsService?.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries
  if (!Array.isArray(entries)) return ''
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i]?.event ?? entries[i]
    if (event?.type !== 'assistant/message') continue
    const message = event.data?.message ?? event.data
    const id = message?.id ?? event.messageId ?? event.id
    if (id !== messageId) continue
    return textOfBlocks(message?.content)
  }
  return ''
}

function quoteBlock(text) {
  return ['**来自旁聊：**', '', ...String(text).split('\n').map(line => `> ${line}`)].join('\n')
}

/** Write one side answer into the main conversation's composer draft. */
function promoteToMain(parentId, text) {
  const body = String(text ?? '').trim()
  if (body === '') return false
  try {
    const scope = sessionsService?.scope?.(parentId)
    const input = scope === undefined || scope === null ? undefined : conversationService?.input?.for?.(scope)
    if (input === undefined || typeof input.setDraft !== 'function') return false
    input.setDraft(quoteBlock(body))
    return true
  } catch (error) {
    console.error('[dsh-side-chat] promote failed', error)
    return false
  }
}

/** The promote entry inside the native transcript's assistant action row. */
function PromoteToMainAction({ sessionId, messageId }) {
  const state = useSideState()
  const owner = findSideOwner(state, sessionId)
  if (owner === undefined) return null
  const [promoted, setPromoted] = React.useState(false)
  return h('button', {
    type: 'button',
    className: 'dsh-sc-icon-button',
    title: promoted ? '已带到主会话' : '带到主会话',
    'aria-label': '带到主会话',
    onClick: () => {
      const text = findAssistantMessageText(sessionId, messageId)
      if (promoteToMain(owner.parentId, text)) {
        setPromoted(true)
        setTimeout(() => setPromoted(false), 1600)
      }
    },
  }, h(IconArrowUpRight))
}

/* ------------------------------------------------------------------- pieces */

function IconArrowUpRight() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M3 10.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.5' }),
    h('path', { d: 'M8 10V2M5 5l3-3 3 3' }),
  )
}

function IconExpand() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M6.5 3.5H3.5v3M9.5 12.5h3v-3M13 6.5v-3h-3M3 9.5v3h2.5' }),
  )
}

function IconClose() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M4 4l8 8M12 4l-8 8' }),
  )
}

function IconChat() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M2 3.5h9a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 11 11.5H6l-3.5 2.5v-2.5H3A1 1 0 0 1 2 10.5v-7Z' }),
  )
}

function IconPanelRight() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }),
    h('path', { d: 'M10 2.5v11' }),
  )
}

function ActionButton({ children, onClick, disabled, className = '', title }) {
  return h('button', { type: 'button', className: `dsh-sc-action ${className}`, onClick, disabled, title }, children)
}

function Toggle({ checked, onChange, label }) {
  return h('label', { className: 'dsh-sc-switch', title: label },
    h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked), 'aria-label': label }),
    h('span', { 'aria-hidden': true }),
  )
}

function CloseDialog() {
  const state = useSideState()
  const [remember, setRemember] = React.useState(false)
  const dialog = state.dialog
  React.useEffect(() => { setRemember(false) }, [dialog?.sideId])
  if (dialog === null || dialog === undefined) return null
  const choose = mode => {
    if (remember) updatePreferences({ closeBehavior: mode })
    void closeSide(dialog.parentId, dialog.sideId, mode)
  }
  return ReactDOM.createPortal(h('div', {
    className: 'dsh-sc-modal-backdrop',
    role: 'presentation',
    onMouseDown: event => { if (event.target === event.currentTarget && !state.busy) update({ dialog: null }) },
  },
  h('div', { className: 'dsh-sc-modal', role: 'dialog', 'aria-modal': 'true' },
    h('h3', null, '关闭旁聊'),
    h('p', null, '「保留对话」会释放当前 agent 但保留磁盘上的会话，下次可继续；「删除并关闭」会彻底删除这段旁聊且无法恢复。'),
    h('div', { className: 'dsh-sc-modal-actions' },
      h('label', { className: 'dsh-sc-remember-choice' },
        h('input', { type: 'checkbox', checked: remember, onChange: event => setRemember(event.target.checked) }),
        h('span', null, '记住此选择'),
      ),
      h(ActionButton, { disabled: state.busy, onClick: () => update({ dialog: null }) }, '取消'),
      h(ActionButton, { disabled: state.busy, onClick: () => choose('keep') }, '保留对话'),
      h(ActionButton, { disabled: state.busy, className: 'dsh-sc-danger', onClick: () => choose('delete') }, state.busy ? '正在删除…' : '删除并关闭'),
    ),
  )), document.body)
}

/* ------------------------------------------------- native conversation seam */

/** Lock the embedded conversation to the chat view (no trajectory tabs). */
function FixedChatConversationView(props) {
  return props.renderSlot('conversation.session', { view: 'chat' })
}

/** Host the shared conversation content for the side Session in our child slot. */
function SideChatConversationPanel({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedChatConversationView },
  })
}

/** The tab body: retain the side Session and bind the subtree to it. */
function SideChatTab(props) {
  const { SessionProvider, renderSlot } = props
  const state = useSideState()
  const activeId = props.sessionId ?? useObservable(sessionsService?.list, list => list.current, undefined)
  const side = activeId === undefined ? undefined : state.sides.get(activeId)
  const sideId = side?.sideId

  // One reference per live side Session; releasing it returns the binding.
  const [reference, setReference] = React.useState(undefined)
  React.useEffect(() => {
    if (sideId === undefined) {
      setReference(undefined)
      return undefined
    }
    let retained
    try {
      retained = sessionsService?.retain?.(sideId, { source: 'sideChatPanel' })
    } catch (error) {
      console.error('[dsh-side-chat] retain failed', error)
      retained = undefined
    }
    setReference(retained ?? null)
    return () => { retained?.release?.() }
  }, [sideId])

  if (!state.enabled) {
    return h('div', { className: 'dsh-sc-panel' }, h('div', { className: 'dsh-sc-empty' }, '旁聊已在设置中停用。'))
  }

  if (sideId === undefined) {
    return h('div', { className: 'dsh-sc-panel' },
      h('div', { className: 'dsh-sc-empty' },
        h('div', null, '在这个主会话旁边开一个独立的只读会话。'),
        h('div', { style: { marginTop: 12 } },
          h(ActionButton, {
            className: 'dsh-sc-primary',
            disabled: state.busy || activeId === undefined,
            onClick: () => { if (activeId !== undefined) void openSide(activeId) },
          }, state.busy ? '正在开启…' : '开启旁聊'),
        ),
        h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          state.readOnly ? '只读模式：可以读文件和搜索，不能修改工作区。' : '可写模式：旁聊拥有完整工具能力。'),
      ),
      state.error === '' ? null : h('p', { className: 'dsh-sc-error' }, state.error),
      h(CloseDialog, null),
    )
  }

  return h('div', { className: 'dsh-sc-panel' },
    h('div', { className: 'dsh-sc-head' },
      h('span', { className: 'dsh-sc-head-title' }, `旁聊 · 独立会话（${side?.readOnly === false ? '可写' : '只读'}）`),
      h('span', { className: 'dsh-sc-spacer' }),
      h('button', {
        type: 'button',
        className: 'dsh-sc-icon-button',
        title: '在主窗口打开',
        'aria-label': '在主窗口打开',
        onClick: () => void openInMainArea(sideId),
      }, h(IconExpand)),
      h('button', {
        type: 'button',
        className: 'dsh-sc-icon-button',
        title: '关闭旁聊',
        'aria-label': '关闭旁聊',
        disabled: state.busy,
        onClick: () => requestClose(activeId, sideId),
      }, h(IconClose)),
    ),
    h('div', { className: 'dsh-sc-panel-body' },
      reference === undefined || reference === null || SessionProvider === undefined
        ? h('div', { className: 'dsh-sc-empty' }, '正在连接旁聊会话…')
        : h(SessionProvider, { session: reference }, renderSlot(CONVERSATION_SLOT, {})),
    ),
    h(CloseDialog, null),
  )
}

function SideChatTitle() {
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(IconChat), '旁聊')
}

/** Header entry on the main conversation: open the side chat and its tab. */
function HeaderAction({ sessionId }) {
  const state = useSideState()
  if (!state.enabled) return null
  const side = state.sides.get(sessionId)
  return h('button', {
    type: 'button',
    className: 'dsh-sc-icon-button',
    'aria-label': side === undefined ? '打开旁聊' : '显示旁聊',
    title: side === undefined ? '打开旁聊' : '显示旁聊',
    disabled: state.busy,
    onClick: () => { void openSide(sessionId) },
  }, h(IconPanelRight))
}

function SettingsSection() {
  const state = useSideState()
  return h('div', { className: 'dsh-sc-settings' },
    h('div', { className: 'dsh-sc-settings-head' }, h('h2', null, '旁聊')),
    h('div', { className: 'dsh-sc-settings-row' },
      h('div', null, h('div', { className: 'dsh-sc-settings-title' }, '启用旁聊'), h('div', { className: 'dsh-sc-settings-desc' }, '关闭后隐藏会话头部的入口，右栏标签也不再提供面板。')),
      h(Toggle, { checked: state.enabled, label: '启用旁聊', onChange: enabled => updatePreferences({ enabled }) }),
    ),
    h('div', { className: 'dsh-sc-settings-row' },
      h('div', null, h('div', { className: 'dsh-sc-settings-title' }, '只读模式'), h('div', { className: 'dsh-sc-settings-desc' }, '开启后旁聊只能读取和搜索文件，不能修改工作区；对新开启或恢复的旁聊生效。')),
      h(Toggle, { checked: state.readOnly, label: '只读模式', onChange: readOnly => updatePreferences({ readOnly }) }),
    ),
    h('div', { className: 'dsh-sc-settings-row' },
      h('div', null, h('div', { className: 'dsh-sc-settings-title' }, '新旁聊模式'), h('div', { className: 'dsh-sc-settings-desc' }, '使用 DSH 原生 agent 预设；已有旁聊保持原模式。')),
      h('select', { className: 'dsh-sc-settings-select', value: state.preset, 'aria-label': '新旁聊模式', onChange: event => updatePreferences({ preset: event.target.value }) },
        ...PRESET_OPTIONS.map(option => h('option', { key: option.id, value: option.id }, option.label)),
      ),
    ),
    h('div', { className: 'dsh-sc-settings-row' },
      h('div', null, h('div', { className: 'dsh-sc-settings-title' }, '关闭旁聊时'), h('div', { className: 'dsh-sc-settings-desc' }, '可每次询问，或直接沿用上次记住的保留/删除选择。')),
      h('select', { className: 'dsh-sc-settings-select', value: state.closeBehavior, 'aria-label': '关闭旁聊时', onChange: event => updatePreferences({ closeBehavior: event.target.value }) },
        ...CLOSE_BEHAVIOR_OPTIONS.map(option => h('option', { key: option.id, value: option.id }, option.label)),
      ),
    ),
  )
}

return {
  inject: ['slots', 'timer', 'sessions', 'conversation'],
  apply(ctx) {
    const slots = ctx.get('slots')
    sessionsService = ctx.get('sessions')
    conversationService = ctx.get('conversation')
    sidebarRight = ctx.get('sidebarRight')
    uiWorkspace = ctx.get('uiWorkspace')
    workspaces = ctx.get('workspaces')
    const tabs = ctx.get('sidebarRightTabs')
    styles.insert(CSS)

    // A page-type tab: opened by kind, matching no resource address.
    ctx.effect(() => tabs?.register?.({
      id: TAB_ID,
      kind: TAB_KIND,
      priority: 'extension',
      title: () => '旁聊',
      guide: [{
        id: TAB_ID,
        order: 40,
        title: () => '旁聊',
        description: () => '在这个主会话旁开一个独立的只读会话',
      }],
    }), 'dsh-side-chat: tab type')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
    }, SideChatTab)), 'dsh-side-chat: tab body')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: TAB_ID,
    }, SideChatTitle)), 'dsh-side-chat: tab title')

    // The native conversation body, bound to the side Session.
    ctx.effect(() => slots.inject(CONVERSATION_SLOT, () => slots.register({
      name: CONVERSATION_SLOT,
    }, SideChatConversationPanel)), 'dsh-side-chat: conversation host')

    ctx.effect(() => slots.inject('conversation.chat.assistant-actions', () => slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'side-chat-promote',
      order: 90,
    }, PromoteToMainAction)), 'dsh-side-chat: promote entry')

    ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register({
      name: 'conversation.session.header.actions',
      id: 'side-chat',
      order: 90,
    }, HeaderAction)), 'dsh-side-chat: header entry')

    ctx.effect(() => slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'side-chat',
      order: 60,
      label: () => '旁聊',
    }, SettingsSection)), 'dsh-side-chat: settings section')

    ctx.effect(() => () => {
      subscribers.clear()
      sessionsService = null
      conversationService = null
      sidebarRight = null
      uiWorkspace = null
      workspaces = null
      uiState = initialState
    }, 'dsh-side-chat: client state')
  },
}
