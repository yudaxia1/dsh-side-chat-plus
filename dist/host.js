// dsh-side-chat — code.host（Node 进程半边，动态 Cordis 插件）
// 生成文件：由 build.mjs 把 src/core.mjs 内联到 __CORE_SOURCE__ 处，产出 dist/host.js。
// 用途：包私有 RPC（sideChat.*）、storageDomain 持久化、独立 llm.stream 流式生成。
// 用法：把 dist/host.js 内容作为 cordis_define 的 code.host。

return {
  apply(ctx) {
    /**
 * dsh-side-chat — 纯宿主核心（无沙箱全局依赖，node:test 可直接测试）。
 *
 * 本模块不触碰 vm 沙箱提供的任何全局（harness / console / btoa / …），
 * 所有外部能力通过构造时传入的 `deps` 注入：
 *
 * - deps.domain       storageDomain.open() 返回的 Domain（table('chats') 为 KV 表）
 * - deps.sessionQuery 会话日志查询服务（readSession / readEvent 等）
 * - deps.sessions     SessionStore（get(id) → 实时 Session，用于 append）
 * - deps.llm          LLM 服务（stream(GenerateOptions)）
 * - deps.agentDefaultModel  默认模型选择（兜底）
 * - deps.agents       Agent 注册表（按会话 id 解析 agent）
 * - deps.now          时钟（测试注入；默认 Date.now）
 * - deps.random       随机 id 生成（测试注入；默认 Math.random 实现）
 *
 * 数据模型（与目标文档一致）：
 * {
 *   sideChatId, parentSessionId, title,
 *   anchorType, anchorId, anchorSnapshot,
 *   createdAt, updatedAt, status, error,
 *   messages: [{ id, role, text, time, seq }],
 * }
 */

const ANCHOR_TEXT_MAX = 4000
const STREAM_PERSIST_INTERVAL_MS = 2000
const RECENT_MESSAGE_LIMIT = 10
const SIDE_CHAT_ID_PREFIX = 'sc_'

/** 由事件日志构建锚点快照时的角色标签。 */
function roleLabel(role) {
  return role === 'user' ? '主聊天用户消息' : '主聊天助手消息'
}

/** 把一个主会话事件日志事件压成“最小必要快照”的纯文本（text 块）。 */
function eventPlainText(data) {
  const content = data === null || typeof data !== 'object' ? null : data.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** 截断到上限，超长时保留头尾并标注省略。 */
function boundText(text, max = ANCHOR_TEXT_MAX) {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.6)
  const tail = max - head - 1
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

/** 从事件日志里按消息 id 找一条消息事件，返回最小快照（含可定位的 nodeKey）。 */
function findMessageInLog(events, messageId) {
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const data = event !== null && typeof event === 'object' && event.data !== null && typeof event.data === 'object'
      ? event.data
      : null
    if (data !== null && event.type === 'assistant/message' && data.message && data.message.id === messageId) {
      return {
        role: 'assistant',
        messageId,
        seq: event.seq,
        time: event.time,
        turn: data.turn,
        step: data.step,
        nodeKey: `assistant-step:${data.turn}:${data.step}`,
        text: boundText(eventPlainText(data.message)),
      }
    }
    if (data !== null && event.type === 'user/message'
      && data.id === messageId
      && data.source && data.source.kind === 'user') {
      return {
        role: 'user',
        messageId,
        seq: event.seq,
        time: event.time,
        nodeKey: `input-message:${messageId}`,
        text: boundText(eventPlainText(data)),
      }
    }
  }
  return undefined
}

/** 在消息锚点之外，取其“必要的相邻上下文”：助手消息前面的最近一条用户消息文本。 */
function adjacentUserContext(events, anchorSeq) {
  let lastUser = null
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (event.seq >= anchorSeq) break
    const data = event !== null && typeof event === 'object' && event.data !== null && typeof event.data === 'object'
      ? event.data
      : null
    if (data !== null && event.type === 'user/message'
      && data.source && data.source.kind === 'user'
      && eventPlainText(data) !== '') {
      lastUser = { text: boundText(eventPlainText(data)), seq: event.seq }
    }
  }
  return lastUser
}

/** 从事件日志取最近的若干条可引用消息（用户/助手，含 nodeKey）。 */
function recentMessages(events, limit = RECENT_MESSAGE_LIMIT) {
  const out = []
  for (let i = events.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const event = events[i]
    if (event === null || typeof event !== 'object') continue
    const data = event !== null && typeof event === 'object' && event.data !== null && typeof event.data === 'object'
      ? event.data
      : null
    if (data !== null && event.type === 'assistant/message' && data.message) {
      const text = eventPlainText(data.message)
      if (text === '') continue
      out.push({
        messageId: data.message.id,
        role: 'assistant',
        seq: event.seq,
        time: event.time,
        nodeKey: `assistant-step:${data.turn}:${data.step}`,
        text: boundText(text),
      })
      continue
    }
    if (data !== null && event.type === 'user/message'
      && data.id && data.source && data.source.kind === 'user') {
      const text = eventPlainText(data)
      if (text === '') continue
      out.push({
        messageId: data.id,
        role: 'user',
        seq: event.seq,
        time: event.time,
        nodeKey: `input-message:${event.data.id}`,
        text: boundText(text),
      })
    }
  }
  return out
}

/** 从事件日志取最近一次 request/header 的 provider/model（与主会话保持一致）。 */
function modelConfigFromLog(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'request/header') continue
    const config = event.data !== null && typeof event.data === 'object'
      && event.data.header !== null && typeof event.data.header === 'object'
      ? event.data.header.config
      : undefined
    if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
      return {
        provider: config.provider,
        model: config.model,
        ...typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {},
      }
    }
  }
  return undefined
}

/** 侧聊专用系统提示（分析/讨论空间，只读，不做修改类操作）。 */
function systemPrompt(anchorSnapshot) {
  const lines = [
    '你是一个运行在 DeepSeek Harness “侧边聊天”面板中的分析助手。',
    '这是一个独立的讨论空间，与主会话隔离：你只看到本侧聊的对话历史和明确的引用快照，看不到主会话的其他内容。',
    '你只做分析、解释、讨论、总结；不要修改文件、执行命令、提交代码或产生任何副作用。',
    '如果用户提出了需要修改文件或执行操作的需求，请在回答末尾明确建议“转到主会话”执行，并把要点整理清楚。',
    '回答使用与提问一致的语言。',
  ]
  if (anchorSnapshot !== undefined && anchorSnapshot !== null) {
    const source = typeof anchorSnapshot.sourceLabel === 'string' ? anchorSnapshot.sourceLabel : '引用内容'
    lines.push(`\n【引用来源：${source}】`)
    if (typeof anchorSnapshot.text === 'string' && anchorSnapshot.text !== '') {
      lines.push(`\n${anchorSnapshot.text}`)
    }
    if (anchorSnapshot.adjacent && typeof anchorSnapshot.adjacent.text === 'string' && anchorSnapshot.adjacent.text !== '') {
      lines.push(`\n【相邻上下文（发起引用消息前的用户提问）】\n${anchorSnapshot.adjacent.text}`)
    }
  }
  return lines.join('\n')
}

/** 把侧聊记录压成给模型的消息序列（只保留 text 角色消息）。 */
function buildModelMessages(record, anchorSnapshot, newText) {
  const messages = []
  for (const message of record.messages) {
    messages.push({
      role: message.role,
      content: [{ type: 'text', text: message.text }],
    })
  }
  if (newText !== undefined && newText !== null && newText !== '') {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: newText }],
    })
  }
  return messages
}

/** 汇总提示：把侧聊压缩成可带回主会话的摘要。 */
function summarizePrompt(record) {
  const lines = [
    '请把下面这段“侧边聊天”对话整理成一段带回主会话的摘要，要求：',
    '1. 开头一行给出结论或要点；',
    '2. 分条列出关键分析、事实与讨论结果；',
    '3. 若讨论产生了对主会话的建议，单列“建议下一步”；',
    '4. 总长度不超过 600 字，使用与对话一致的语言；',
    '5. 只输出摘要本身，不要额外寒暄。',
    '\n对话：',
  ]
  for (const message of record.messages) {
    lines.push(`\n[${message.role === 'user' ? '用户' : '助手'}] ${message.text}`)
  }
  return lines.join('\n')
}

/** 默认侧聊标题（由锚点推导）。 */
function defaultTitle(anchorSnapshot) {
  if (anchorSnapshot === undefined || anchorSnapshot === null) return '新侧聊'
  const text = typeof anchorSnapshot.text === 'string' ? anchorSnapshot.text.trim() : ''
  if (text === '') return '引用侧聊'
  const firstLine = text.split('\n')[0] ?? ''
  const compact = firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine
  return `追问：${compact}`
}

/** 空白侧聊第一次发送后使用首句作为标题，避免所有会话都显示“新侧聊”。 */
function titleFromFirstMessage(text) {
  const compact = text.trim().replace(/\s+/g, ' ').split('\n')[0] ?? ''
  if (compact === '') return '新侧聊'
  return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact
}

/** 创建侧聊核心工厂。 */
function createSideChatCore(deps) {
  const now = deps.now ?? (() => Date.now())
  const randomId = deps.random ?? (() => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let out = ''
    for (let i = 0; i < 12; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return out
  })
  const controllers = new Map()
  const domain = deps.domain
  const table = domain.table('chats')

  // 取消机制说明：沙箱 vm 没有 AbortController 全局（AbortSignal.any 需要宿主真实
  // 信号实例），因此“停止”通过调用流迭代器的 return() 级联关闭生成器链，最终触发
  // DeepSeek 适配器 finally 里的 consumer.abort() 取消 fetch。见 docs/RESEARCH.md。
  /** 记录一个运行中的流：{ stopped, iterator }。 */
  function runHandleOf(sideChatId) {
    let handle = controllers.get(sideChatId)
    if (handle === undefined) {
      handle = { stopped: false, iterator: null }
      controllers.set(sideChatId, handle)
    }
    return handle
  }

  function abortRun(sideChatId) {
    const handle = controllers.get(sideChatId)
    if (handle === undefined) return
    handle.stopped = true
    const iterator = handle.iterator
    if (iterator !== null && iterator !== undefined && typeof iterator.return === 'function') {
      try {
        void iterator.return()
      } catch (error) {
        // 迭代器已关闭时 return() 可能抛错，忽略。
      }
    }
  }

  /** 记录 → 对外视图（浅拷贝 + 规范字段）。 */
  function toView(record) {
    return {
      sideChatId: record.sideChatId,
      parentSessionId: record.parentSessionId,
      title: record.title,
      anchorType: record.anchorType,
      anchorId: record.anchorId,
      anchorSnapshot: record.anchorSnapshot,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: record.status,
      error: record.error === undefined ? null : record.error,
      messages: record.messages,
    }
  }

  /** 全量读取（按 updatedAt 倒序）。 */
  async function loadAll(parentSessionId) {
    const rows = []
    for (const [, record] of table.entries()) {
      if (record.parentSessionId !== parentSessionId) continue
      rows.push(toView(record))
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    return rows
  }

  /** 读写校验：sideChatId 必须属于 parentSessionId。 */
  function requireOwned(record, parentSessionId) {
    if (record === undefined) {
      return { ok: false, error: { code: 'side-chat-not-found', message: '侧聊不存在或已被删除' } }
    }
    if (record.parentSessionId !== parentSessionId) {
      return { ok: false, error: { code: 'cross-session', message: '侧聊不属于该会话' } }
    }
    return null
  }

  /** 解析父会话的模型配置：先读日志里的 request/header，再兜底默认选择。 */
  async function resolveModelConfig(parentSessionId) {
    try {
      const snapshot = await deps.sessionQuery.readSession(parentSessionId)
      const fromLog = modelConfigFromLog(snapshot.events)
      if (fromLog !== undefined) return fromLog
    } catch (error) {
      // 日志读取失败不影响兜底路径。
    }
    const defaultModel = deps.agentDefaultModel === undefined ? undefined : deps.agentDefaultModel.currentSelection()
    if (defaultModel !== undefined
      && typeof defaultModel.provider === 'string'
      && typeof defaultModel.model === 'string') {
      return {
        provider: defaultModel.provider,
        model: defaultModel.model,
        ...typeof defaultModel.reasoningEffort === 'string'
          ? { reasoningEffort: defaultModel.reasoningEffort }
          : {},
      }
    }
    return undefined
  }

  /** 读取父会话事件日志（live-preferred）。 */
  async function readParentEvents(parentSessionId) {
    const snapshot = await deps.sessionQuery.readSession(parentSessionId)
    return Array.isArray(snapshot.events) ? snapshot.events : []
  }

  /** 由锚点请求构造最小必要快照。 */
  async function buildAnchorSnapshot(parentSessionId, anchor) {
    if (anchor === undefined || anchor === null || anchor.type === 'blank' || anchor.type === undefined) {
      return undefined
    }
    const events = await readParentEvents(parentSessionId)
    if (anchor.type === 'selection' && typeof anchor.text === 'string' && anchor.text !== '') {
      const found = typeof anchor.messageId === 'string' ? findMessageInLog(events, anchor.messageId) : undefined
      return {
        sourceLabel: '主聊天选中文字',
        text: boundText(anchor.text),
        ...(found !== undefined
          ? { messageId: found.messageId, role: found.role, seq: found.seq, time: found.time, nodeKey: found.nodeKey }
          : {}),
      }
    }
    if (typeof anchor.messageId === 'string') {
      const found = findMessageInLog(events, anchor.messageId)
      if (found === undefined) {
        return { error: { code: 'anchor-not-found', message: '在主会话日志中找不到该消息' } }
      }
      const adjacent = found.role === 'assistant' ? adjacentUserContext(events, found.seq) : undefined
      return {
        sourceLabel: roleLabel(found.role),
        messageId: found.messageId,
        role: found.role,
        seq: found.seq,
        time: found.time,
        nodeKey: found.nodeKey,
        text: found.text,
        ...(adjacent !== null && adjacent !== undefined ? { adjacent } : {}),
      }
    }
    return undefined
  }

  /** 持久化一个记录（幂等；streaming 期间由调用方节流）。 */
  async function persist(record) {
    await table.put(record.sideChatId, record)
  }

  /** 启动一次流式生成（fire-and-forget，独立于主会话 Agent 循环）。 */
  function startStream(record, anchorSnapshot, newText) {
    const handle = runHandleOf(record.sideChatId)
    void (async () => {
      let lastPersistedAt = now()
      const assistantId = `scm_${randomId()}`
      record.messages.push({ id: assistantId, role: 'assistant', text: '', time: now(), seq: record.messages.length })
      record.status = 'streaming'
      record.error = undefined
      record.textRev = 0
      record.updatedAt = now()
      try {
        await persist(record)
      } catch (error) {
        // 持久化失败不阻断流式主流程。
      }
      if (handle.stopped) {
        record.status = 'stopped'
        record.updatedAt = now()
        await persist(record).catch(() => {})
        controllers.delete(record.sideChatId)
        return
      }
      const modelConfig = await resolveModelConfig(record.parentSessionId)
      if (modelConfig === undefined) {
        record.status = 'error'
        record.error = '无法解析模型配置：父会话没有 request/header，且没有默认模型'
        record.updatedAt = now()
        await persist(record).catch(() => {})
        controllers.delete(record.sideChatId)
        return
      }
      if (handle.stopped) {
        record.status = 'stopped'
        record.updatedAt = now()
        await persist(record).catch(() => {})
        controllers.delete(record.sideChatId)
        return
      }
      const assistantIndex = record.messages.length - 1
      try {
        // 请求里的对话历史 = 全部已有消息去掉最后这条空的助手占位（它正是本次要生成的内容）。
        const history = { messages: record.messages.slice(0, assistantIndex) }
        const stream = deps.llm.stream({
          provider: modelConfig.provider,
          model: modelConfig.model,
          ...typeof modelConfig.reasoningEffort === 'string' ? { reasoningEffort: modelConfig.reasoningEffort } : {},
          system: systemPrompt(anchorSnapshot),
          messages: buildModelMessages(history, anchorSnapshot, undefined),
        })
        handle.iterator = stream[Symbol.asyncIterator]()
        for await (const chunk of handle.iterator) {
          if (handle.stopped) break
          if (chunk.type === 'text-delta') {
            const message = record.messages[assistantIndex]
            if (message !== undefined) {
              message.text += chunk.text
              record.textRev += 1
            }
            record.updatedAt = now()
            const elapsed = now() - lastPersistedAt
            if (elapsed >= STREAM_PERSIST_INTERVAL_MS) {
              lastPersistedAt = now()
              await persist(record).catch(() => {})
            }
            continue
          }
          if (chunk.type === 'reasoning-delta') {
            // 侧聊不展示推理过程，直接丢弃。
            continue
          }
          if (chunk.type === 'finish') {
            const reason = chunk.reason
            const kind = reason !== null && typeof reason === 'object' && typeof reason.kind === 'string'
              ? reason.kind
              : 'stop'
            if (kind === 'aborted' || kind === 'error') {
              if (!handle.stopped) {
                record.status = kind === 'aborted' ? 'stopped' : 'error'
                if (kind === 'error' && reason.failure && typeof reason.failure.message === 'string') {
                  record.error = reason.failure.message
                }
              }
            } else if (kind === 'max-tokens') {
              record.status = 'stopped'
              record.error = '输出达到长度上限，已停止'
            } else {
              record.status = 'idle'
            }
          }
        }
        if (handle.stopped) record.status = 'stopped'
        // 流自然结束时补一个终态（finish 未到达时兜底）。
        if (record.status === 'streaming') record.status = 'idle'
      } catch (error) {
        if (handle.stopped) {
          record.status = 'stopped'
        } else {
          record.status = 'error'
          record.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        record.updatedAt = now()
        controllers.delete(record.sideChatId)
        try {
          await persist(record)
        } catch (error) {
          // 终态持久化失败：记录留在内存，下次 poll 仍可读到。
        }
      }
    })()
  }

  /** 校验并返回侧聊记录（按 parentSessionId 归属）。 */
  function getOwned(sideChatId, parentSessionId) {
    const record = table.get(sideChatId)
    if (record === undefined) {
      return { error: { code: 'side-chat-not-found', message: '侧聊不存在或已被删除' } }
    }
    if (record.parentSessionId !== parentSessionId) {
      return { error: { code: 'cross-session', message: '侧聊不属于该会话' } }
    }
    return { record }
  }

  return {
    /** 列出一个父会话的全部侧聊（倒序）。 */
    async list(parentSessionId) {
      return { ok: true, sideChats: await loadAll(parentSessionId) }
    },

    /** 创建侧聊（空白或携带引用锚点）。 */
    async create(parentSessionId, anchor) {
      const snapshot = await buildAnchorSnapshot(parentSessionId, anchor)
      if (snapshot !== undefined && snapshot !== null && snapshot.error !== undefined) {
        return { ok: false, error: snapshot.error }
      }
      const sideChatId = `${SIDE_CHAT_ID_PREFIX}${randomId()}`
      const stamp = now()
      const record = {
        sideChatId,
        parentSessionId,
        title: defaultTitle(snapshot),
        anchorType: snapshot === undefined ? 'blank' : (anchor !== undefined && anchor.type === 'selection' ? 'selection' : 'message'),
        anchorId: snapshot === undefined ? null : (snapshot.messageId ?? null),
        anchorSnapshot: snapshot === undefined ? null : snapshot,
        createdAt: stamp,
        updatedAt: stamp,
        status: 'idle',
        error: undefined,
        messages: [],
      }
      await persist(record)
      return { ok: true, sideChat: toView(record) }
    },

    /** 重命名。 */
    async rename(sideChatId, parentSessionId, title) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      const record = owned.record
      const clean = typeof title === 'string' ? title.trim().slice(0, 80) : ''
      if (clean === '') return { ok: false, error: { code: 'empty-title', message: '标题不能为空' } }
      record.title = clean
      record.updatedAt = now()
      await persist(record)
      return { ok: true, sideChat: toView(record) }
    },

    /** 删除（同时中止其流）。 */
    async remove(sideChatId, parentSessionId) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      abortRun(sideChatId)
      controllers.delete(sideChatId)
      await table.delete(sideChatId)
      return { ok: true }
    },

    /** 发送一条用户消息并启动独立流式生成。 */
    async send(sideChatId, parentSessionId, text) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      const record = owned.record
      const clean = typeof text === 'string' ? text.trim() : ''
      if (clean === '') return { ok: false, error: { code: 'empty-message', message: '消息不能为空' } }
      const running = controllers.get(sideChatId)
      if (running !== undefined) {
        return { ok: false, error: { code: 'busy', message: '该侧聊正在生成，请先停止' } }
      }
      if (record.title === '新侧聊' && record.anchorType === 'blank'
        && !record.messages.some((message) => message.role === 'user')) {
        record.title = titleFromFirstMessage(clean)
      }
      record.messages.push({ id: `scm_${randomId()}`, role: 'user', text: clean, time: now(), seq: record.messages.length })
      record.updatedAt = now()
      await persist(record)
      const anchorSnapshot = record.anchorSnapshot
      startStream(record, anchorSnapshot, clean)
      return { ok: true, status: 'streaming', title: record.title }
    },

    /** 停止当前生成。 */
    async stop(sideChatId, parentSessionId) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      const handle = controllers.get(sideChatId)
      if (handle === undefined) {
        return { ok: true, status: owned.record.status }
      }
      abortRun(sideChatId)
      return { ok: true, status: 'stopping' }
    },

    /** 增量拉取（sinceSeq 之后的新消息 + 文本修订过的当前助手消息 + 状态）。 */
    async poll(sideChatId, parentSessionId, sinceSeq, sinceTextRev) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      const record = owned.record
      // 负数（含 -1）表示“从头开始”，用于首次加载；消息 seq 从 0 起。
      const after = typeof sinceSeq === 'number' && Number.isSafeInteger(sinceSeq) && sinceSeq >= 0 ? sinceSeq : -1
      const messages = []
      for (const message of record.messages) {
        if (message.seq > after) messages.push(message)
      }
      // 同一助手消息只增不改（seq 不变），所以文本修订必须单独追踪：
      // 修订号变化时把“当前最后一条助手消息”整体带回去，由客户端按 id 覆盖。
      const textRev = typeof record.textRev === 'number' ? record.textRev : 0
      if (textRev !== (typeof sinceTextRev === 'number' ? sinceTextRev : -1)) {
        for (let i = record.messages.length - 1; i >= 0; i -= 1) {
          const message = record.messages[i]
          if (message.role === 'assistant' && message.text !== '') {
            if (!messages.some((m) => m.id === message.id)) messages.push(message)
            break
          }
        }
      }
      return {
        ok: true,
        status: record.status,
        error: record.error === undefined ? null : record.error,
        messages,
        seq: record.messages.length,
        textRev,
        title: record.title,
        anchorSnapshot: record.anchorSnapshot,
      }
    },

    /** 生成摘要（带回主会话用）。 */
    async summarize(sideChatId, parentSessionId) {
      const owned = getOwned(sideChatId, parentSessionId)
      if (owned.error !== undefined) return { ok: false, error: owned.error }
      const record = owned.record
      if (record.messages.length === 0) {
        return { ok: false, error: { code: 'empty-side-chat', message: '侧聊还没有消息，无法生成摘要' } }
      }
      const modelConfig = await resolveModelConfig(record.parentSessionId)
      if (modelConfig === undefined) {
        return { ok: false, error: { code: 'no-model', message: '无法解析模型配置' } }
      }
      try {
        let text = ''
        const stream = deps.llm.stream({
          provider: modelConfig.provider,
          model: modelConfig.model,
          ...typeof modelConfig.reasoningEffort === 'string' ? { reasoningEffort: modelConfig.reasoningEffort } : {},
          system: '你是一个摘要助手，只输出摘要本身。',
          messages: [{ role: 'user', content: [{ type: 'text', text: summarizePrompt(record) }] }],
        })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
        }
        return { ok: true, text: text.trim() }
      } catch (error) {
        return { ok: false, error: { code: 'summarize-failed', message: error instanceof Error ? error.message : String(error) } }
      }
    },

    /** 最近可引用消息列表（面板“引用最近消息”用）。 */
    async recent(parentSessionId, limit) {
      const events = await readParentEvents(parentSessionId)
      const parsed = typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? limit : RECENT_MESSAGE_LIMIT
      return { ok: true, messages: recentMessages(events, parsed) }
    },

    /** 会话是否仍存在（孤儿检测）。 */
    async parentExists(parentSessionId) {
      try {
        const snapshot = await deps.sessionQuery.readSession(parentSessionId)
        return snapshot !== undefined && snapshot.session !== undefined
      } catch (error) {
        return false
      }
    },

    /** 卸载时中止所有流。 */
    dispose() {
      for (const sideChatId of [...controllers.keys()]) abortRun(sideChatId)
      controllers.clear()
    },
  }
}


    const storageDomain = ctx.get('storageDomain')
    const sessionQuery = ctx.get('sessionQuery')
    const sessions = ctx.get('sessions')
    const llm = ctx.get('llm')
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const agents = ctx.get('agents')

    if (storageDomain === undefined || sessionQuery === undefined || sessions === undefined || llm === undefined) {
      console.log('dsh-side-chat: 必需服务不可用（storageDomain/sessionQuery/sessions/llm），宿主半边停用')
      return
    }

    // 沙箱不能 import zod；storageDomain.open 只在装载边界调用 schema.parse(raw)。
    // 结构性透传 schema 保留记录原样（记录由本插件构造，天然是合法 JSON）。
    // 缺口与替代方案见 docs/RESEARCH.md「持久化缺口」。
    const passthroughSchema = {
      parse: (value) => value,
      safeParse: (value) => ({ success: true, data: value }),
    }

    let core = null
    let ready = null

    const openDomain = async () => {
      let domain
      try {
        domain = await storageDomain.open({
          name: 'side_chat',
          version: 1,
          tables: { chats: { valueSchema: passthroughSchema } },
        })
      } catch (error) {
        // 另一个会话的实例已打开同一 domain：共享它（记录按 parentSessionId 隔离）。
        const name = error !== null && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : ''
        const existing = name === 'already-open' ? storageDomain.get('side_chat') : undefined
        if (existing === undefined) throw error
        domain = existing
      }
      core = createSideChatCore({ domain, sessionQuery, sessions, llm, agentDefaultModel, agents })
      return core
    }

    ready = openDomain()
    ready.catch((error) => {
      console.log('dsh-side-chat: storage domain 打开失败', error instanceof Error ? error.message : String(error))
    })

    const withCore = async (op) => {
      const opened = core !== null ? core : await ready
      return op(opened)
    }

    const fail = (error) => ({
      ok: false,
      error: {
        code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    })

    const sessionIdOf = (args) => (
      args !== null && typeof args === 'object' && typeof args.sessionId === 'string' ? args.sessionId : ''
    )
    const sideChatIdOf = (args) => (
      args !== null && typeof args === 'object' && typeof args.sideChatId === 'string' ? args.sideChatId : ''
    )

    harness.handle('sideChat.list', async (args) => {
      const sessionId = sessionIdOf(args)
      if (sessionId === '') return { ok: false, error: { code: 'no-session', message: '缺少 sessionId' } }
      try {
        return await withCore((c) => c.list(sessionId))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.create', async (args) => {
      const sessionId = sessionIdOf(args)
      if (sessionId === '') return { ok: false, error: { code: 'no-session', message: '缺少 sessionId' } }
      const anchor = args !== null && typeof args === 'object' && args.anchor !== undefined ? args.anchor : undefined
      try {
        return await withCore((c) => c.create(sessionId, anchor))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.rename', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      const title = args !== null && typeof args === 'object' ? args.title : undefined
      try {
        return await withCore((c) => c.rename(sideChatId, sessionId, title))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.delete', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      try {
        return await withCore((c) => c.remove(sideChatId, sessionId))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.send', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      const text = args !== null && typeof args === 'object' ? args.text : undefined
      try {
        return await withCore((c) => c.send(sideChatId, sessionId, text))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.stop', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      try {
        return await withCore((c) => c.stop(sideChatId, sessionId))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.poll', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      const sinceSeq = args !== null && typeof args === 'object' ? args.sinceSeq : undefined
      const sinceTextRev = args !== null && typeof args === 'object' ? args.sinceTextRev : undefined
      try {
        return await withCore((c) => c.poll(sideChatId, sessionId, sinceSeq, sinceTextRev))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.summarize', async (args) => {
      const sessionId = sessionIdOf(args)
      const sideChatId = sideChatIdOf(args)
      if (sessionId === '' || sideChatId === '') {
        return { ok: false, error: { code: 'no-session', message: '缺少 sessionId 或 sideChatId' } }
      }
      try {
        return await withCore((c) => c.summarize(sideChatId, sessionId))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.recent', async (args) => {
      const sessionId = sessionIdOf(args)
      if (sessionId === '') return { ok: false, error: { code: 'no-session', message: '缺少 sessionId' } }
      const limit = args !== null && typeof args === 'object' ? args.limit : undefined
      try {
        return await withCore((c) => c.recent(sessionId, limit))
      } catch (error) {
        return fail(error)
      }
    })

    harness.handle('sideChat.ping', async () => ({ ok: true, pong: Date.now() }))

    ctx.effect(() => () => {
      if (core !== null) core.dispose()
    }, 'dsh-side-chat: abort running streams')
  }
}
