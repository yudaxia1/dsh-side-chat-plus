/**
 * 集成测试：在 vm 沙箱中求值 dist/host.js，用假服务调用 apply(ctx)，再通过
 * 记录下来的 harness.handle 处理器走完整 RPC 流程（创建/锚点/独立流式/停止/
 * 隔离/持久化/回传摘要）。验证“构建后的宿主半边”接线正确。
 * 运行方式：node tests/integration.test.mjs
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostCode = readFileSync(join(root, 'dist', 'host.js'), 'utf8')

// ── 内存 domain ─────────────────────────────────────────────────────────────
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
  }
}

// ── 假 llm ──────────────────────────────────────────────────────────────────
function fakeLlm(options = {}) {
  return {
    stream(request) {
      const record = options.recordCalls === true ? request : undefined
      if (record !== undefined) options.calls.push(request)
      return (async function* () {
        if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
        for (const chunk of options.chunks ?? [
          { type: 'text-delta', index: 0, text: '侧聊回复：' },
          { type: 'text-delta', index: 0, text: '独立于主会话。' },
          { type: 'finish', reason: { kind: 'stop' } },
        ]) yield chunk
      })()
    },
  }
}

/** 组装：求值 host.js → apply(fakeCtx) → 返回 handlers。 */
async function bootHost(options = {}) {
  const handlers = {}
  const domain = memoryDomain()
  const events = options.events ?? [
    { type: 'user/message', seq: 0, time: 1000, data: { id: 'u1', content: [{ type: 'text', text: '主会话提问' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 1, time: 1100, data: { turn: 0, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '主会话回答' }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } } } },
    { type: 'request/header', seq: 2, time: 1200, data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' } },
  ]
  const llm = options.llm ?? fakeLlm()
  const calls = []
  const services = {
    storageDomain: {
      open: async (spec) => {
        assert.equal(spec.name, 'side_chat')
        assert.equal(spec.version, 1)
        assert.ok(spec.tables.chats.valueSchema !== undefined)
        return domain
      },
      get: (name) => (name === 'side_chat' ? domain : undefined),
    },
    sessionQuery: {
      readSession: async (id) => {
        if (options.missingSessions?.includes(id)) throw new Error(`no such session: ${id}`)
        return { session: { id }, events }
      },
    },
    sessions: { get: () => undefined },
    llm,
    agentDefaultModel: options.agentDefaultModel ?? {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    },
    agents: { get: () => undefined },
  }
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => { const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {} },
  }
  const sandbox = {
    console,
    btoa: (s) => Buffer.from(s, 'utf-8').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('utf-8'),
    TextEncoder,
    TextDecoder,
    harness: { handle: (method, fn) => { handlers[method] = fn } },
  }
  vm.createContext(sandbox)
  const plugin = await vm.runInContext(`(async () => {\n${hostCode}\n})()`, sandbox, { timeout: 10000 })
  plugin.apply(ctx)
  return { handlers, calls, domain, events }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 通过 sideChat.poll 轮询到状态离开 streaming。 */
async function drain(handlers, args) {
  let seq = -1
  let textRev = -1
  let status = 'streaming'
  let text = ''
  for (let i = 0; i < 100; i += 1) {
    const res = await handlers['sideChat.poll']({ sessionId: args.sessionId, sideChatId: args.sideChatId, sinceSeq: seq, sinceTextRev: textRev })
    assert.equal(res.ok, true)
    for (const message of res.messages) {
      if (message.role === 'assistant') text = message.text
    }
    seq = res.seq
    textRev = res.textRev
    status = res.status
    if (status !== 'streaming') break
    await wait(10)
  }
  return { status, text }
}

describe('dist/host.js 集成', () => {
  test('完整 RPC 流程：创建 → 引用 → 发送 → 流式 → 停止/完成 → 列表', async () => {
    const { handlers } = await bootHost()
    const sessionId = 's1'

    // 空白侧聊
    const blank = await handlers['sideChat.create']({ sessionId, anchor: { type: 'blank' } })
    assert.equal(blank.ok, true)
    assert.equal(blank.sideChat.anchorType, 'blank')

    // 从消息引用
    const anchored = await handlers['sideChat.create']({ sessionId, anchor: { type: 'message', messageId: 'a1' } })
    assert.equal(anchored.ok, true)
    assert.equal(anchored.sideChat.anchorSnapshot.messageId, 'a1')
    assert.equal(anchored.sideChat.anchorSnapshot.nodeKey, 'assistant-step:0:0')

    // 发送并等待完成
    const sent = await handlers['sideChat.send']({ sessionId, sideChatId: anchored.sideChat.sideChatId, text: '请继续分析' })
    assert.equal(sent.ok, true)
    assert.equal(sent.status, 'streaming')
    const settled = await drain(handlers, { sessionId, sideChatId: anchored.sideChat.sideChatId })
    assert.equal(settled.status, 'idle')
    assert.ok(settled.text.includes('侧聊回复'))

    // 列表包含两个侧聊，且消息不进入主会话（readSession 事件数不变）
    const list = await handlers['sideChat.list']({ sessionId })
    assert.equal(list.sideChats.length, 2)

    // 重命名 + 删除
    const renamed = await handlers['sideChat.rename']({ sessionId, sideChatId: blank.sideChat.sideChatId, title: '重命名侧聊' })
    assert.equal(renamed.ok, true)
    assert.equal(renamed.sideChat.title, '重命名侧聊')
    const removed = await handlers['sideChat.delete']({ sessionId, sideChatId: blank.sideChat.sideChatId })
    assert.equal(removed.ok, true)
    const listAfter = await handlers['sideChat.list']({ sessionId })
    assert.equal(listAfter.sideChats.length, 1)
  })

  test('缺少必要参数返回结构化错误', async () => {
    const { handlers } = await bootHost()
    const noSession = await handlers['sideChat.list']({})
    assert.equal(noSession.ok, false)
    assert.equal(noSession.error.code, 'no-session')
    const noId = await handlers['sideChat.poll']({ sessionId: 's1' })
    assert.equal(noId.ok, false)
    assert.equal(noId.error.code, 'no-session')
  })

  test('模型流携带引用快照与独立历史（不包含主会话全量）', async () => {
    const calls = []
    const { handlers } = await bootHost({
      llm: fakeLlm({ recordCalls: true, calls }),
    })
    const sessionId = 's1'
    const anchored = await handlers['sideChat.create']({ sessionId, anchor: { type: 'message', messageId: 'a1' } })
    await handlers['sideChat.send']({ sessionId, sideChatId: anchored.sideChat.sideChatId, text: '追问一句' })
    await drain(handlers, { sessionId, sideChatId: anchored.sideChat.sideChatId })

    assert.equal(calls.length, 1)
    const request = calls[0]
    assert.equal(request.provider, 'deepseek')
    assert.equal(request.model, 'deepseek-chat')
    assert.ok(request.system.includes('主会话回答'))
    assert.ok(request.system.includes('主会话提问'))
    // 沙箱 realm 的对象与宿主字面量在 Node deepStrictEqual 下会报
    // “same structure but not reference-equal”；RPC 只承载 JSON，两边都做
    // 无损 JSON 归一化后再比较。
    const asJson = (value) => JSON.parse(JSON.stringify(value))
    assert.deepEqual(asJson(request.messages), [
      { role: 'user', content: [{ type: 'text', text: '追问一句' }] },
    ])
  })

  test('poll 正确使用 textRev 游标，不重复返回已消费的流式文本', async () => {
    const { handlers } = await bootHost()
    const sessionId = 's1'
    const created = await handlers['sideChat.create']({ sessionId, anchor: { type: 'blank' } })
    await handlers['sideChat.send']({ sessionId, sideChatId: created.sideChat.sideChatId, text: '游标测试' })

    let first = null
    for (let i = 0; i < 100; i += 1) {
      first = await handlers['sideChat.poll']({
        sessionId,
        sideChatId: created.sideChat.sideChatId,
        sinceSeq: -1,
        sinceTextRev: -1,
      })
      if (first.status !== 'streaming' && first.textRev >= 0) break
      await wait(5)
    }
    assert.equal(first.ok, true)
    const again = await handlers['sideChat.poll']({
      sessionId,
      sideChatId: created.sideChat.sideChatId,
      sinceSeq: first.seq,
      sinceTextRev: first.textRev,
    })
    assert.equal(again.ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(again.messages)), [])
  })

  test('跨会话隔离：s2 无法访问 s1 的侧聊', async () => {
    const { handlers } = await bootHost()
    const created = await handlers['sideChat.create']({ sessionId: 's1', anchor: { type: 'blank' } })
    const poll = await handlers['sideChat.poll']({ sessionId: 's2', sideChatId: created.sideChat.sideChatId, sinceSeq: -1, sinceTextRev: -1 })
    assert.equal(poll.ok, false)
    assert.equal(poll.error.code, 'cross-session')
    const list2 = await handlers['sideChat.list']({ sessionId: 's2' })
    assert.equal(list2.sideChats.length, 0)
  })

  test('总结到主聊天（summarize）返回模型摘要', async () => {
    const { handlers } = await bootHost()
    const sessionId = 's1'
    const created = await handlers['sideChat.create']({ sessionId, anchor: { type: 'blank' } })
    await handlers['sideChat.send']({ sessionId, sideChatId: created.sideChat.sideChatId, text: '分析这段代码' })
    await drain(handlers, { sessionId, sideChatId: created.sideChat.sideChatId })
    const summary = await handlers['sideChat.summarize']({ sessionId, sideChatId: created.sideChat.sideChatId })
    assert.equal(summary.ok, true)
    assert.ok(summary.text.length > 0)
  })

  test('recent 返回主会话最近消息（含 nodeKey）', async () => {
    const { handlers } = await bootHost()
    const recent = await handlers['sideChat.recent']({ sessionId: 's1', limit: 5 })
    assert.equal(recent.ok, true)
    assert.equal(recent.messages[0].messageId, 'a1')
    assert.equal(recent.messages[1].messageId, 'u1')
  })

  test('停止生成：hang 流被 return() 级联中止', async () => {
    const { handlers } = await bootHost({
      llm: {
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
      },
    })
    const sessionId = 's1'
    const created = await handlers['sideChat.create']({ sessionId, anchor: { type: 'blank' } })
    const sent = await handlers['sideChat.send']({ sessionId, sideChatId: created.sideChat.sideChatId, text: '开始' })
    assert.equal(sent.ok, true)
    await wait(30)
    const stopped = await handlers['sideChat.stop']({ sessionId, sideChatId: created.sideChat.sideChatId })
    assert.equal(stopped.ok, true)
    let status = 'streaming'
    for (let i = 0; i < 100; i += 1) {
      const poll = await handlers['sideChat.poll']({ sessionId, sideChatId: created.sideChat.sideChatId, sinceSeq: -1, sinceTextRev: -1 })
      status = poll.status
      if (status !== 'streaming') break
      await wait(10)
    }
    assert.equal(status, 'stopped')
  })

  test('同一 storageDomain 被第二个实例共享（already-open 走 get）', async () => {
    // 模拟“另一个会话的插件实例已打开 domain”：storageDomain.open 抛 already-open，
    // 宿主应回退到 storageDomain.get('side_chat')。
    const handlers1 = {}
    const handlers2 = {}
    const domain = memoryDomain()
    const events = [
      { type: 'request/header', seq: 0, time: 1000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' } },
    ]
    let opened = false
    const storageDomain = {
      open: async (spec) => {
        if (opened) {
          const error = new Error('already open')
          error.code = 'already-open'
          throw error
        }
        opened = true
        return domain
      },
      get: (name) => (name === 'side_chat' ? domain : undefined),
    }
    const sessionQuery = { readSession: async () => ({ session: { id: 's1' }, events }) }
    const ctx = {
      get: (name) => (name === 'storageDomain' ? storageDomain
        : name === 'sessionQuery' ? sessionQuery
          : name === 'sessions' ? {}
            : name === 'llm' ? fakeLlm()
              : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
                : undefined),
      effect: (fn) => { const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {} },
    }
    const boot = async (handlers) => {
      const sandbox = {
        console, btoa: (s) => Buffer.from(s).toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('utf8'),
        TextEncoder, TextDecoder,
        harness: { handle: (method, fn) => { handlers[method] = fn } },
      }
      vm.createContext(sandbox)
      const plugin = await vm.runInContext(`(async () => {\n${hostCode}\n})()`, sandbox, { timeout: 10000 })
      plugin.apply(ctx)
    }
    await boot(handlers1)
    await boot(handlers2)
    const created = await handlers1['sideChat.create']({ sessionId: 's1', anchor: { type: 'blank' } })
    assert.equal(created.ok, true)
    const list2 = await handlers2['sideChat.list']({ sessionId: 's1' })
    assert.equal(list2.ok, true)
    assert.equal(list2.sideChats.length, 1)
    assert.equal(list2.sideChats[0].sideChatId, created.sideChat.sideChatId)
  })
})
