// dsh-side-chat — code.host（Node 进程半边，动态 Cordis 插件）
// 生成文件：由 build.mjs 把 src/core.mjs 内联到 __CORE_SOURCE__ 处，产出 dist/host.js。
// 用途：包私有 RPC（sideChat.*）、storageDomain 持久化、独立 llm.stream 流式生成。
// 用法：把 dist/host.js 内容作为 cordis_define 的 code.host。

return {
  apply(ctx) {
    /*__CORE_SOURCE__*/

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
