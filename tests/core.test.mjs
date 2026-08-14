/**
 * src/core.mjs 单元测试：纯函数 + 核心工厂（内存 domain / 假 llm 流）。
 * 运行方式（沙箱内避免子进程管道）：node tests/core.test.mjs
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  eventPlainText,
  boundText,
  findMessageInLog,
  adjacentUserContext,
  recentMessages,
  modelConfigFromLog,
  systemPrompt,
  defaultTitle,
  buildModelMessages,
  createSideChatCore,
} from '../src/core.mjs'

/** 构造一条会话事件。 */
function event(type, data, seq = 0, time = 1000) {
  return { type, seq, time, data }
}

const userEvent = (id, text, seq) => event('user/message', {
  id, content: [{ type: 'text', text }], source: { kind: 'user' },
}, seq)
const assistantEvent = (id, text, turn, step, seq) => event('assistant/message', {
  turn, step,
  message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } },
}, seq)

describe('文本工具', () => {
  test('eventPlainText 只提取 text 块', () => {
    assert.equal(eventPlainText({ content: [
      { type: 'text', text: '你好' },
      { type: 'reasoning', text: '思考' },
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
    ] }), '你好')
  })

  test('boundText 超长保留头尾', () => {
    const out = boundText('a'.repeat(5000), 100)
    assert.equal(out.length, 100)
    assert.ok(out.startsWith('aaaa'))
    assert.ok(out.endsWith('aaa'))
    assert.ok(out.includes('…'))
  })

  test('boundText 短文本原样返回', () => {
    assert.equal(boundText('短', 100), '短')
  })
})

describe('锚点提取', () => {
  const events = [
    userEvent('u1', '帮我看看这个报错', 0),
    assistantEvent('a1', '这是分析：xxx', 0, 0, 1),
    userEvent('u2', '继续', 2),
    assistantEvent('a2', '结论：yyy', 1, 1, 3),
  ]

  test('findMessageInLog 找到助手消息并推导 nodeKey', () => {
    const found = findMessageInLog(events, 'a2')
    assert.ok(found !== undefined)
    assert.equal(found.role, 'assistant')
    assert.equal(found.nodeKey, 'assistant-step:1:1')
    assert.ok(found.text.includes('结论'))
    assert.equal(found.seq, 3)
  })

  test('findMessageInLog 找到用户消息并推导 input-message nodeKey', () => {
    const found = findMessageInLog(events, 'u1')
    assert.ok(found !== undefined)
    assert.equal(found.role, 'user')
    assert.equal(found.nodeKey, 'input-message:u1')
    assert.equal(found.text, '帮我看看这个报错')
  })

  test('findMessageInLog 找不到时返回 undefined', () => {
    assert.equal(findMessageInLog(events, 'nope'), undefined)
  })

  test('adjacentUserContext 取锚点前的最近用户消息', () => {
    const adjacent = adjacentUserContext(events, 3)
    assert.ok(adjacent !== undefined)
    assert.equal(adjacent.text, '继续')
  })

  test('recentMessages 倒序返回最近消息（跳过空文本）', () => {
    const withEmpty = [
      userEvent('u0', '开头', 0),
      assistantEvent('a0', '', 0, 0, 1),
      userEvent('u1', '第二句', 2),
    ]
    const recent = recentMessages(withEmpty, 10)
    assert.equal(recent.length, 2)
    assert.equal(recent[0].messageId, 'u1')
    assert.equal(recent[1].messageId, 'u0')
  })

  test('modelConfigFromLog 取最后一个 request/header', () => {
    const log = [
      event('request/header', { header: { config: { provider: 'deepseek', model: 'old' } }, reason: 'initial' }, 0),
      event('request/header', { header: { config: { provider: 'deepseek', model: 'new', reasoningEffort: 'high' } }, reason: 'change' }, 1),
    ]
    assert.deepEqual(modelConfigFromLog(log), {
      provider: 'deepseek', model: 'new', reasoningEffort: 'high',
    })
  })

  test('modelConfigFromLog 无 header 时返回 undefined', () => {
    assert.equal(modelConfigFromLog([userEvent('u1', 'x', 0)]), undefined)
  })
})

describe('提示与模型消息构建', () => {
  test('systemPrompt 包含引用文本', () => {
    const prompt = systemPrompt({ sourceLabel: '主聊天助手消息', text: '引用内容 abc' })
    assert.ok(prompt.includes('侧边聊天'))
    assert.ok(prompt.includes('引用内容 abc'))
    assert.ok(prompt.includes('主聊天助手消息'))
  })

  test('systemPrompt 无锚点时不包含引用段', () => {
    const prompt = systemPrompt(undefined)
    assert.ok(!prompt.includes('【引用来源'))
  })

  test('buildModelMessages 按历史顺序构建 role/content 消息', () => {
    const record = {
      messages: [
        { role: 'user', text: '问题' },
        { role: 'assistant', text: '回答' },
      ],
    }
    assert.deepEqual(buildModelMessages(record, null, '追问'), [
      { role: 'user', content: [{ type: 'text', text: '问题' }] },
      { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
      { role: 'user', content: [{ type: 'text', text: '追问' }] },
    ])
  })

  test('defaultTitle 由锚点首行推导', () => {
    assert.ok(defaultTitle({ text: '这是一条很长的引用内容'.repeat(6) }).includes('追问'))
    assert.equal(defaultTitle(undefined), '新侧聊')
  })
})

// ── 内存 domain（模拟 storageDomain 的 KV 表语义）───────────────────────────
function memoryDomain() {
  const records = new Map()
  return {
    name: 'side_chat',
    table() {
      return {
        get: (key) => records.get(key),
        entries: () => records.entries(),
        keys: () => records.keys(),
        put: async (key, value) => { records.set(key, JSON.parse(JSON.stringify(value))) },
        delete: async (key) => records.delete(key),
        get size() { return records.size },
      }
    },
    snapshot: () => JSON.parse(JSON.stringify([...records.entries()])),
  }
}

/** 构造一个可注入的核心实例。 */
function makeCore(overrides = {}) {
  const domain = overrides.domain ?? memoryDomain()
  const events = overrides.events ?? [
    userEvent('u1', '请解释一下这个方案', 0),
    assistantEvent('a1', '方案解释：……', 0, 0, 1),
    event('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' }, 2),
  ]
  let randomCounter = 0
  const deps = {
    domain,
    sessionQuery: {
      readSession: async () => ({ session: { id: overrides.sessionId ?? 's1' }, events }),
    },
    sessions: { get: () => undefined },
    llm: overrides.llm,
    agentDefaultModel: overrides.agentDefaultModel,
    now: overrides.now ?? (() => 1000),
    random: overrides.random ?? (() => {
      randomCounter += 1
      return `r${randomCounter}`
    }),
  }
  const core = createSideChatCore(deps)
  return { core, domain, events, deps }
}

/** 假 llm：可编排的流。 */
function fakeLlm() {
  return {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: '你好，' }
        yield { type: 'text-delta', index: 0, text: '这是回复。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** 永不结束的假流：用于测试 stop（依赖 return() 中断）。 */
function hangLlm() {
  return {
    stream() {
      return (async function* () {
        let n = 0
        while (true) {
          n += 1
          yield { type: 'text-delta', index: 0, text: `块${n}，` }
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      })()
    },
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询直到状态离开 streaming（带回最终状态与累计助手文本）。 */
async function drainToSettled(core, sideChatId, sessionId) {
  let seq = -1
  let textRev = -1
  let status = 'streaming'
  let text = ''
  for (let i = 0; i < 100; i += 1) {
    const poll = await core.poll(sideChatId, sessionId, seq, textRev)
    assert.equal(poll.ok, true)
    for (const message of poll.messages) {
      if (message.role === 'assistant') text = message.text
    }
    seq = poll.seq
    textRev = poll.textRev
    status = poll.status
    if (status !== 'streaming') break
    await wait(10)
  }
  return { status, text, seq, textRev }
}

describe('createSideChatCore — 生命周期', () => {
  test('创建空白侧聊并列出', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'blank' })
    assert.equal(created.ok, true)
    assert.equal(created.sideChat.parentSessionId, 's1')
    assert.equal(created.sideChat.anchorType, 'blank')
    assert.equal(created.sideChat.status, 'idle')
    assert.deepEqual(created.sideChat.messages, [])

    const list = await core.list('s1')
    assert.equal(list.sideChats.length, 1)
    assert.equal(list.sideChats[0].sideChatId, created.sideChat.sideChatId)
  })

  test('从消息建立引用锚点（最小必要快照）', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'message', messageId: 'a1' })
    assert.equal(created.ok, true)
    const anchor = created.sideChat.anchorSnapshot
    assert.equal(anchor.messageId, 'a1')
    assert.equal(anchor.role, 'assistant')
    assert.equal(anchor.nodeKey, 'assistant-step:0:0')
    assert.ok(anchor.text.includes('方案解释'))
    assert.ok(anchor.adjacent !== undefined)
    assert.ok(anchor.adjacent.text.includes('请解释'))
    assert.equal(created.sideChat.anchorType, 'message')
  })

  test('从选中文字建立引用', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'selection', messageId: 'a1', text: '选中的片段' })
    assert.equal(created.ok, true)
    assert.ok(created.sideChat.anchorSnapshot.sourceLabel.includes('选中文字'))
    assert.equal(created.sideChat.anchorSnapshot.text, '选中的片段')
    assert.equal(created.sideChat.anchorSnapshot.nodeKey, 'assistant-step:0:0')
  })

  test('引用不存在的消息返回错误', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'message', messageId: 'missing' })
    assert.equal(created.ok, false)
    assert.equal(created.error.code, 'anchor-not-found')
  })

  test('重命名', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'blank' })
    const renamed = await core.rename(created.sideChat.sideChatId, 's1', '  新标题  ')
    assert.equal(renamed.ok, true)
    assert.equal(renamed.sideChat.title, '新标题')
  })

  test('删除', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'blank' })
    const removed = await core.remove(created.sideChat.sideChatId, 's1')
    assert.equal(removed.ok, true)
    const list = await core.list('s1')
    assert.equal(list.sideChats.length, 0)
    const again = await core.remove(created.sideChat.sideChatId, 's1')
    assert.equal(again.ok, false)
  })

  test('跨会话隔离：B 会话无法读写 A 的侧聊', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'blank' })
    const listB = await core.list('s2')
    assert.equal(listB.sideChats.length, 0)
    const pollB = await core.poll(created.sideChat.sideChatId, 's2', -1, -1)
    assert.equal(pollB.ok, false)
    assert.equal(pollB.error.code, 'cross-session')
    const sendB = await core.send(created.sideChat.sideChatId, 's2', '越权消息')
    assert.equal(sendB.ok, false)
    const removeB = await core.remove(created.sideChat.sideChatId, 's2')
    assert.equal(removeB.ok, false)
  })

  test('持久化：同一 domain 上重建核心（模拟重启）后记录仍在', async () => {
    const domain = memoryDomain()
    const events = [
      userEvent('u1', '问题', 0),
      event('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' }, 1),
    ]
    const first = createSideChatCore({
      domain,
      sessionQuery: { readSession: async () => ({ session: { id: 's1' }, events }) },
      sessions: {}, llm: fakeLlm(), now: () => 1000,
    })
    const created = await first.create('s1', { type: 'blank' })
    const sent = await first.send(created.sideChat.sideChatId, 's1', '你好')
    assert.equal(sent.ok, true)
    await drainToSettled(first, created.sideChat.sideChatId, 's1')

    // 重建核心（模拟 DSH 重启后插件重新加载）
    const second = createSideChatCore({
      domain,
      sessionQuery: { readSession: async () => ({ session: { id: 's1' }, events }) },
      sessions: {}, llm: fakeLlm(), now: () => 2000,
    })
    const list = await second.list('s1')
    assert.equal(list.sideChats.length, 1)
    assert.equal(list.sideChats[0].title, '你好')
    const poll = await second.poll(created.sideChat.sideChatId, 's1', -1, -1)
    assert.equal(poll.ok, true)
    assert.ok(poll.messages.some((m) => m.role === 'user' && m.text === '你好'))
    assert.ok(poll.messages.some((m) => m.role === 'assistant' && m.text === '你好，这是回复。'))
  })
})

describe('createSideChatCore — 流式生成', () => {
  test('send → 独立流 → poll 增量 → finish 后 idle', async () => {
    const { core } = makeCore({ llm: fakeLlm() })
    const created = await core.create('s1', { type: 'blank' })
    const sent = await core.send(created.sideChat.sideChatId, 's1', '你好')
    assert.equal(sent.ok, true)
    assert.equal(sent.status, 'streaming')

    const settled = await drainToSettled(core, created.sideChat.sideChatId, 's1')
    assert.equal(settled.status, 'idle')
    assert.equal(settled.text, '你好，这是回复。')
  })

  test('空白侧聊第一次发送后自动使用首句作为标题', async () => {
    const { core } = await makeCore()
    const created = await core.create('s1', { type: 'blank' })
    const sent = await core.send(created.sideChat.sideChatId, 's1', '  请解释这个错误\n第二行上下文  ')
    assert.equal(sent.ok, true)
    assert.equal(sent.title, '请解释这个错误 第二行上下文')
    await core.stop(created.sideChat.sideChatId, 's1')
  })

  test('stop 中止流并置 stopped', async () => {
    const { core } = makeCore({ llm: hangLlm() })
    const created = await core.create('s1', { type: 'blank' })
    const sent = await core.send(created.sideChat.sideChatId, 's1', '开始')
    assert.equal(sent.ok, true)
    await wait(30)
    const stopped = await core.stop(created.sideChat.sideChatId, 's1')
    assert.equal(stopped.ok, true)
    let finalStatus = 'streaming'
    for (let i = 0; i < 100; i += 1) {
      const poll = await core.poll(created.sideChat.sideChatId, 's1', -1, -1)
      finalStatus = poll.status
      if (finalStatus !== 'streaming') break
      await wait(10)
    }
    assert.equal(finalStatus, 'stopped')
  })

  test('两个侧聊可同时独立流式生成（互不影响）', async () => {
    let callCount = 0
    const llm = {
      stream() {
        callCount += 1
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '独立回复' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    const { core } = makeCore({ llm })
    const a = await core.create('s1', { type: 'blank' })
    const b = await core.create('s1', { type: 'blank' })
    const sendA = await core.send(a.sideChat.sideChatId, 's1', '侧聊A')
    const sendB = await core.send(b.sideChat.sideChatId, 's1', '侧聊B')
    assert.equal(sendA.ok, true)
    assert.equal(sendB.ok, true)
    const settledA = await drainToSettled(core, a.sideChat.sideChatId, 's1')
    const settledB = await drainToSettled(core, b.sideChat.sideChatId, 's1')
    assert.equal(settledA.status, 'idle')
    assert.equal(settledB.status, 'idle')
    assert.equal(settledA.text, '独立回复')
    assert.equal(settledB.text, '独立回复')
    assert.equal(callCount, 2)
  })

  test('busy 时拒绝再次发送', async () => {
    const { core } = makeCore({ llm: hangLlm() })
    const created = await core.create('s1', { type: 'blank' })
    await core.send(created.sideChat.sideChatId, 's1', '第一次')
    await wait(10)
    const second = await core.send(created.sideChat.sideChatId, 's1', '第二次')
    assert.equal(second.ok, false)
    assert.equal(second.error.code, 'busy')
    await core.stop(created.sideChat.sideChatId, 's1')
  })

  test('模型配置缺失时置 error 并说明原因', async () => {
    const { core } = makeCore({ events: [userEvent('u1', 'x', 0)] })
    const created = await core.create('s1', { type: 'blank' })
    const sent = await core.send(created.sideChat.sideChatId, 's1', '你好')
    assert.equal(sent.ok, true)
    let finalStatus = 'streaming'
    let error = null
    for (let i = 0; i < 100; i += 1) {
      const poll = await core.poll(created.sideChat.sideChatId, 's1', -1, -1)
      finalStatus = poll.status
      error = poll.error
      if (finalStatus !== 'streaming') break
      await wait(10)
    }
    assert.equal(finalStatus, 'error')
    assert.ok(error.includes('模型配置'))
  })
})

describe('createSideChatCore — 摘要与最近消息', () => {
  test('summarize 用模型生成摘要', async () => {
    const { core } = makeCore({
      llm: {
        stream() {
          return (async function* () {
            yield { type: 'text-delta', index: 0, text: '摘要：' }
            yield { type: 'text-delta', index: 0, text: '这是结论。' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    })
    const created = await core.create('s1', { type: 'blank' })
    await core.send(created.sideChat.sideChatId, 's1', '帮我分析')
    await drainToSettled(core, created.sideChat.sideChatId, 's1')
    const summary = await core.summarize(created.sideChat.sideChatId, 's1')
    assert.equal(summary.ok, true)
    assert.equal(summary.text, '摘要：这是结论。')
  })

  test('空侧聊 summarize 返回错误', async () => {
    const { core } = makeCore()
    const created = await core.create('s1', { type: 'blank' })
    const summary = await core.summarize(created.sideChat.sideChatId, 's1')
    assert.equal(summary.ok, false)
    assert.equal(summary.error.code, 'empty-side-chat')
  })

  test('recent 返回最近的用户/助手消息', async () => {
    const { core } = makeCore()
    const recent = await core.recent('s1', 5)
    assert.equal(recent.ok, true)
    assert.equal(recent.messages[0].messageId, 'a1')
    assert.equal(recent.messages[1].messageId, 'u1')
    assert.equal(recent.messages[0].nodeKey, 'assistant-step:0:0')
  })

  test('parentExists 检测会话存在性', async () => {
    const { core } = makeCore()
    assert.equal(await core.parentExists('s1'), true)
    const missing = createSideChatCore({
      domain: memoryDomain(),
      sessionQuery: { readSession: async () => { throw new Error('not found') } },
      sessions: {}, llm: fakeLlm(), now: () => 1,
    })
    assert.equal(await missing.parentExists('zzz'), false)
  })
})
