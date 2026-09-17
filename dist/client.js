// dsh-side-chat client: a right-Sidebar tab hosting an independent, archived
// side Session beside the main conversation.
//
// The panel draws its own transcript over the public Session object layer
// (sessions.binding(id).session + eventSource). DSH 0.1.6 binds exactly one
// Session in the renderer tree, so the native conversation component cannot be
// rendered for a second Session; every Session capability (agent, tools,
// sandbox, prompts, streaming) stays native.

const CSS = `
.dsh-sc-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:inherit}
.dsh-sc-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-sc-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.dsh-sc-badge-readonly{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.dsh-sc-spacer{flex:1 1 auto}
.dsh-sc-model{max-width:170px;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dsh-sc-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:12px}
.dsh-sc-empty{margin:auto;max-width:290px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7}
.dsh-sc-msg{display:flex;flex-direction:column;gap:6px;max-width:100%}
.dsh-sc-msg-user{align-items:flex-end}
.dsh-sc-bubble{max-width:100%;padding:8px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-sc-msg-user .dsh-sc-bubble{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-msg-actions{display:flex;gap:4px;opacity:.55;transition:opacity .12s}
.dsh-sc-msg:hover .dsh-sc-msg-actions,.dsh-sc-msg:focus-within .dsh-sc-msg-actions{opacity:1}
.dsh-sc-tool{display:flex;align-items:baseline;gap:6px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.dsh-sc-tool-name{color:var(--dsw-alias-label-primary);font-weight:500;white-space:nowrap}
.dsh-sc-tool-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-sc-caret{display:inline-block;width:6px;height:13px;margin-left:2px;background:var(--dsw-alias-label-secondary);vertical-align:-2px;animation:dsh-sc-blink 1s steps(2,start) infinite}
@keyframes dsh-sc-blink{to{visibility:hidden}}
.dsh-sc-composer{display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-sc-input{box-sizing:border-box;width:100%;min-height:62px;max-height:200px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:13px;line-height:1.6;resize:vertical}
.dsh-sc-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsh-sc-composer-row{display:flex;align-items:center;gap:8px}
.dsh-sc-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-sc-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:4px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-sc-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-sc-action:disabled{opacity:.5;cursor:default}
.dsh-sc-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-primary:hover{background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-icon-action{width:26px;min-height:26px;padding:0}
.dsh-sc-error{margin:0;padding:7px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.dsh-sc-modal-backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.52)}
.dsh-sc-modal{box-sizing:border-box;width:min(420px,100%);padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:0 20px 64px rgba(0,0,0,.32)}
.dsh-sc-modal h3{margin:0 0 8px;font-size:16px}.dsh-sc-modal p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.dsh-sc-modal-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:18px}
.dsh-sc-remember-choice{display:inline-flex;align-items:center;gap:7px;margin-right:auto;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.dsh-sc-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-sc-settings{width:min(760px,100%);padding:8px 0 40px}
.dsh-sc-settings-head{padding:0 0 20px}.dsh-sc-settings-head h2{margin:0;font-size:20px;font-weight:600}
.dsh-sc-settings-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px;min-height:72px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-sc-settings-title{font-size:14px;font-weight:500}.dsh-sc-settings-desc{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dsh-sc-settings-select{min-width:148px;height:34px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-sc-switch{position:relative;width:36px;height:20px;flex:none}.dsh-sc-switch input{position:absolute;opacity:0;pointer-events:none}.dsh-sc-switch span{display:block;width:100%;height:100%;border-radius:10px;background:var(--dsw-alias-border-l2);transition:background .15s}.dsh-sc-switch span::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-elevated);box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .15s}.dsh-sc-switch input:checked+span{background:var(--dsw-alias-state-business-primary)}.dsh-sc-switch input:checked+span::after{transform:translateX(16px)}
`

const PREFERENCE_KEY = 'dsh-side-chat.preferences.v1'
const TAB_ID = 'side-chat'
const TAB_KIND = 'side-chat'
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
let modelDirectories = null
let sidebarRight = null

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
  if (uiState.sides.has(parentId)) {
    update({ error: '', errorParentId: null })
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

/* ---------------------------------------------------------------- projection */

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

function toolCallsOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return []
  return blocks
    .filter(block => block?.type === 'tool-call')
    .map(block => ({ id: String(block.id ?? ''), name: String(block.name ?? 'tool'), args: String(block.arguments ?? '') }))
}

function argumentHint(args) {
  const trimmed = String(args ?? '').trim()
  if (trimmed === '' || trimmed === '{}') return ''
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object') {
      const parts = []
      for (const key of ['file_path', 'path', 'pattern', 'query', 'command', 'url']) {
        if (typeof parsed[key] === 'string') parts.push(parsed[key])
      }
      if (parts.length > 0) return parts.join(' · ').slice(0, 120)
      const first = Object.values(parsed).find(value => typeof value === 'string')
      if (typeof first === 'string') return first.slice(0, 120)
    }
  } catch (_error) {
    // Not JSON: fall through to the raw excerpt.
  }
  return trimmed.slice(0, 120)
}

/** Fold the side Session's event window into render rows. */
function projectSideMessages(entries) {
  const rows = []
  let streaming = ''
  for (const entry of entries) {
    const event = entry?.event ?? entry
    const type = event?.type
    if (type === 'user/message') {
      const message = event.data?.message ?? event.data
      const text = textOfBlocks(message?.content)
      if (text !== '') rows.push({ kind: 'user', id: String(message?.id ?? `u${event.seq}`), text })
      continue
    }
    if (type === 'assistant/message') {
      const message = event.data?.message
      const text = textOfBlocks(message?.content)
      const tools = toolCallsOfBlocks(message?.content)
      if (text !== '' || tools.length > 0) {
        rows.push({ kind: 'assistant', id: String(message?.id ?? `a${event.seq}`), text, tools })
      }
      streaming = ''
      continue
    }
    if (type === 'tool/result') {
      const block = event.data?.message?.content?.[0]
      rows.push({
        kind: 'tool-result',
        id: `r${event.seq}`,
        isError: block?.isError === true || event.data?.error !== undefined,
        text: textOfBlocks(block?.content).slice(0, 400),
      })
      continue
    }
    if (type === 'assistant/live-chunk') {
      const chunk = event.data?.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') streaming += chunk.text
      continue
    }
  }
  if (streaming.trim() !== '') rows.push({ kind: 'assistant', id: 'streaming', text: streaming, tools: [], streaming: true })
  return rows
}

/* ---------------------------------------------------------------- promotion */

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

/* ------------------------------------------------------------------- pieces */

function IconArrowUpRight() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('path', { d: 'M3 10.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.5' }),
    h('path', { d: 'M8 10V2M5 5l3-3 3 3' }),
  )
}

function IconPanelRight() {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }),
    h('path', { d: 'M10 2.5v11' }),
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

function ActionButton({ children, onClick, disabled, className = '', title }) {
  return h('button', { type: 'button', className: `dsh-sc-action ${className}`, onClick, disabled, title }, children)
}

function Toggle({ checked, onChange, label }) {
  return h('label', { className: 'dsh-sc-switch', title: label },
    h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked), 'aria-label': label }),
    h('span', { 'aria-hidden': true }),
  )
}

function MessageRow({ row, parentId, onPromoted }) {
  const [promoted, setPromoted] = React.useState(false)
  if (row.kind === 'tool-result') {
    return h('div', { className: `dsh-sc-tool ${row.isError ? 'dsh-sc-tool-error' : ''}` },
      h('span', { className: 'dsh-sc-tool-name' }, row.isError ? '工具失败' : '工具结果'),
      h('span', null, row.text === '' ? '(无输出)' : row.text),
    )
  }
  if (row.kind === 'user') {
    return h('div', { className: 'dsh-sc-msg dsh-sc-msg-user' }, h('div', { className: 'dsh-sc-bubble' }, row.text))
  }
  return h('div', { className: 'dsh-sc-msg' },
    ...row.tools.map(tool => h('div', { className: 'dsh-sc-tool', key: tool.id },
      h('span', { className: 'dsh-sc-tool-name' }, tool.name),
      h('span', null, argumentHint(tool.args)),
    )),
    row.text === '' ? null : h('div', { className: 'dsh-sc-bubble' },
      row.text,
      row.streaming ? h('span', { className: 'dsh-sc-caret' }) : null,
    ),
    row.streaming || row.text === '' ? null : h('div', { className: 'dsh-sc-msg-actions' },
      h(ActionButton, {
        className: 'dsh-sc-icon-action',
        title: promoted ? '已带到主会话' : '带到主会话',
        'aria-label': '带到主会话',
        onClick: () => {
          if (promoteToMain(parentId, row.text)) {
            setPromoted(true)
            onPromoted?.()
            setTimeout(() => setPromoted(false), 1600)
          }
        },
      }, h(IconArrowUpRight)),
    ),
  )
}

function ModelPicker({ sessionId }) {
  const directoryRef = React.useRef(null)
  const [snapshot, setSnapshot] = React.useState(undefined)
  React.useEffect(() => {
    if (sessionId === undefined) return undefined
    const directory = modelDirectories?.directoryFor?.(sessionId)
    if (directory === undefined) return undefined
    directoryRef.current = directory
    const read = () => setSnapshot(directory.store.getSnapshot())
    read()
    void directory.load?.()
    const off = directory.store.subscribe(read)
    return () => { off?.(); directoryRef.current = null }
  }, [sessionId])
  const groups = snapshot?.groups ?? []
  const current = snapshot?.current
  if (groups.length === 0) return null
  const value = current === null || current === undefined ? '' : `${current.provider}\u0000${current.model}`
  return h('select', {
    className: 'dsh-sc-model',
    value,
    'aria-label': '旁聊模型',
    title: '旁聊使用的模型',
    onChange: event => {
      const [provider, model] = String(event.target.value).split('\u0000')
      if (provider === undefined || model === undefined) return
      void directoryRef.current?.select?.({ provider, model })
    },
  },
  value === '' ? h('option', { value: '' }, '默认模型') : null,
  ...groups.flatMap(group => (group.models ?? []).map(model => h('option', {
    key: `${group.id}/${model.id}`,
    value: `${group.id}\u0000${model.id}`,
  }, `${group.name} · ${model.name}`))),
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

/** The tab body: transcript, model picker, composer, lifecycle controls. */
function SideChatPanel(props) {
  const state = useSideState()
  const activeId = props.sessionId ?? useObservable(sessionsService?.list, list => list.current, undefined)
  const side = activeId === undefined ? undefined : state.sides.get(activeId)
  const sideId = side?.sideId
  const binding = sideId === undefined ? undefined : sessionsService?.binding?.(sideId)
  const session = binding?.session

  // Staging is what opens an event window, so open this one explicitly; the
  // call is idempotent and the window then follows the side Session.
  React.useEffect(() => {
    if (session === undefined || typeof session.open !== 'function') return undefined
    let cancelled = false
    void session.open()?.catch?.(error => {
      if (!cancelled) console.error('[dsh-side-chat] side session open failed', error)
    })
    return () => { cancelled = true }
  }, [session])

  const revision = useObservable(binding?.eventSource, window => window?.revision, 0)
  const entries = React.useMemo(
    () => binding?.eventSource?.getSnapshot?.()?.entries ?? [],
    [binding, revision],
  )
  const rows = React.useMemo(() => projectSideMessages(entries), [entries])
  const running = useObservable(session, snapshot => snapshot?.running === true, false)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const scrollRef = React.useRef(null)
  const onPromoted = React.useCallback(() => { update({ error: '', errorParentId: null }) }, [])

  React.useEffect(() => {
    const node = scrollRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [rows.length, rows[rows.length - 1]?.text])

  if (!state.enabled) {
    return h('div', { className: 'dsh-sc-panel' }, h('div', { className: 'dsh-sc-empty' }, '旁聊已在设置中停用。'))
  }

  if (sideId === undefined || session === undefined) {
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
        h('div', { className: 'dsh-sc-hint', style: { marginTop: 10 } },
          state.readOnly ? '只读模式：可以读文件和搜索，不能修改工作区。' : '可写模式：旁聊拥有完整工具能力。'),
      ),
      state.error === '' ? null : h('div', { style: { padding: 12 } }, h('p', { className: 'dsh-sc-error' }, state.error)),
      h(CloseDialog, null),
    )
  }

  const send = async () => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    try {
      const handle = session.beginSubmission?.({ mode: 'queue', text, attachments: [] })
      const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle?.requestId)
      if (result?.ok === false) {
        handle?.abandon?.()
        update({ error: result.error?.message ?? '发送失败', errorParentId: activeId })
      } else {
        setDraft('')
        update({ error: '', errorParentId: null })
      }
    } catch (error) {
      update({ error: error instanceof Error ? error.message : String(error), errorParentId: activeId })
    } finally {
      setSending(false)
    }
  }

  return h('div', { className: 'dsh-sc-panel' },
    h('div', { className: 'dsh-sc-toolbar' },
      h('span', { className: `dsh-sc-badge ${side?.readOnly === false ? '' : 'dsh-sc-badge-readonly'}` },
        side?.readOnly === false ? '可写' : '只读',
      ),
      h('span', { className: 'dsh-sc-spacer' }),
      h(ModelPicker, { sessionId: sideId }),
      h(ActionButton, {
        className: 'dsh-sc-icon-action',
        title: '关闭旁聊',
        'aria-label': '关闭旁聊',
        disabled: state.busy,
        onClick: () => requestClose(activeId, sideId),
      }, h(IconClose)),
    ),
    h('div', { className: 'dsh-sc-scroll', ref: scrollRef },
      rows.length === 0
        ? h('div', { className: 'dsh-sc-empty' }, '这是一个独立的只读会话。需要主会话的背景时，它会用 side_chat_context 工具按需检索。')
        : rows.map(row => h(MessageRow, { key: row.id, row, parentId: activeId, onPromoted })),
    ),
    state.error === '' || state.errorParentId !== activeId ? null : h('div', { style: { padding: '0 10px 8px' } }, h('p', { className: 'dsh-sc-error' }, state.error)),
    h('div', { className: 'dsh-sc-composer' },
      h('textarea', {
        className: 'dsh-sc-input',
        value: draft,
        placeholder: '问点什么…… Enter 发送，Shift+Enter 换行',
        'aria-label': '旁聊输入框',
        onChange: event => setDraft(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        },
      }),
      h('div', { className: 'dsh-sc-composer-row' },
        h(ActionButton, { className: 'dsh-sc-primary', disabled: sending || draft.trim() === '', onClick: () => void send() }, sending ? '发送中…' : '发送'),
        running ? h(ActionButton, { onClick: () => { void session.cancel?.() } }, '中断') : null,
        h('span', { className: 'dsh-sc-spacer' }),
        h('span', { className: 'dsh-sc-hint' }, '旁聊不会进入主会话上下文'),
      ),
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
    className: 'dsh-sc-action dsh-sc-icon-action',
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
  inject: ['slots', 'timer', 'sessions', 'conversation', 'remote', 'remote.session'],
  apply(ctx) {
    const slots = ctx.get('slots')
    sessionsService = ctx.get('sessions')
    conversationService = ctx.get('conversation')
    modelDirectories = ctx.get('modelDirectories')
    sidebarRight = ctx.get('sidebarRight')
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
    }, SideChatPanel)), 'dsh-side-chat: tab body')

    ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: TAB_ID,
    }, SideChatTitle)), 'dsh-side-chat: tab title')

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
      modelDirectories = null
      sidebarRight = null
      uiState = initialState
    }, 'dsh-side-chat: client state')
  },
}
