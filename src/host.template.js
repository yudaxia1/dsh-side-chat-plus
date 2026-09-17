// dsh-side-chat host: an archived root Session plus a scoped parent-context tool.
// Core helpers are inlined at build time because the dynamic Cordis host cannot import.

return {
  inject: ['sessionQuery', 'sessionPersistence', 'sessions', 'agents', 'agentPresets', 'workspaceRegistry'],
  apply(ctx) {
    /*__CORE_SOURCE__*/

    const sessionQuery = ctx.get('sessionQuery')
    const persistence = ctx.get('sessionPersistence')
    const sessions = ctx.get('sessions')
    const agents = ctx.get('agents')
    const agentPresets = ctx.get('agentPresets')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const handles = new Map()
    const byParent = new Map()

    function requireService(value, name) {
      if (value === undefined || value === null) {
        throw new SideChatError('capability-unavailable', `DSH 服务 ${name} 不可用`)
      }
      return value
    }

    async function parentAgent(parentSessionId) {
      const live = requireService(agents, 'agents').get(parentSessionId)
      if (live !== undefined) return live
      if (persistence !== undefined && typeof persistence.list === 'function') {
        const header = (await persistence.list()).find(item => item.id === parentSessionId)
        if (header !== undefined) {
          // A historical main conversation does not need to be resumed just to
          // establish a side Session. Its durable header carries the cwd,
          // preset and ancestry needed by the child composition.
          return { id: parentSessionId, session: { header }, options: {} }
        }
      }
      throw new SideChatError('parent-unavailable', '找不到主会话，无法开启侧聊')
    }

    function safeAgentOptions(parent) {
      const options = parent.options ?? {}
      const next = {}
      for (const key of ['provider', 'model', 'maxTokens', 'temperature', 'reasoningEffort']) {
        if (options[key] !== undefined) next[key] = options[key]
      }
      return next
    }

    function sidePrompt(parentSessionId, preset, readOnly) {
      return [
        'You are running in a side conversation beside a main DeepSeek Harness conversation.',
        'This is a real independent Session. Never claim that the main transcript was copied into this Session.',
        `The read-only main Session is ${parentSessionId}.`,
        'When the user refers to the main conversation, selected text, earlier decisions, files, tool results, or unresolved work, call side_chat_context with a focused query before answering.',
        'Use the returned excerpts as runtime context only. Do not repeat them unless the answer requires it.',
        `Use the DSH ${preset} agent preset while keeping its native tools, skills, approval rules, and composer behavior unchanged.`,
        ...(readOnly
          ? ['This Session runs in a read-only sandbox: you may read and search files, but every write, edit, and mutating command is denied. Answer with analysis and suggestions; never claim you changed anything.']
          : []),
      ].join('\n')
    }

    // Pin the sandbox/approval knobs through the same durable session events the
    // native /permission flow uses; the session projection folds the last switch,
    // so re-asserting on every open (create or resume) honors the latest toggle.
    // A host whose Session lacks either event reports it instead of silently
    // running the side chat with the deployment's default permission.
    function pinReadOnly(session, readOnly) {
      const appended = []
      const errors = []
      const attempts = [
        ['sandbox/mode', { mode: readOnly ? 'read-only' : 'workspace-write' }],
        ['approval/policy', { policy: readOnly ? 'never' : 'ask' }],
      ]
      for (const [type, payload] of attempts) {
        try {
          session.append(type, payload)
          appended.push(type)
        } catch (error) {
          errors.push(`${type}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { readOnly, appended, errors }
    }

    // Read the pinned knobs back off the log so a caller can verify the pin
    // without decompressing the session artifact.
    function readPinState(session) {
      try {
        const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
        const modes = events.filter(event => event?.type === 'sandbox/mode').map(event => event?.data?.mode)
        const policies = events.filter(event => event?.type === 'approval/policy').map(event => event?.data?.policy)
        return { eventCount: events.length, sandboxMode: modes.at(-1) ?? null, approvalPolicy: policies.at(-1) ?? null }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }

    async function readParentContext(parentSessionId, request) {
      const normalized = normalizeContextRequest(request)
      const snapshot = await requireService(sessionQuery, 'sessionQuery').readSession(parentSessionId)
      const events = Array.isArray(snapshot?.events) ? snapshot.events : []
      const selected = selectContextEvents(events, normalized.query, normalized.limit)
      return {
        parentSessionId,
        query: normalized.query,
        eventCount: events.length,
        selectedCount: selected.length,
        context: formatContextSnapshot(parentSessionId, selected, normalized.query),
      }
    }

    async function composeChild(childCtx, parent, preset, readOnly) {
      if (agentPresets !== undefined && typeof agentPresets.mount === 'function') {
        await agentPresets.mount(childCtx, preset)
      }
      childCtx.systemPrompt.section({
        name: 'dsh-side-chat:relationship',
        order: 85,
        text: sidePrompt(parent.id, preset, readOnly),
      })
      childCtx.tools.register({
        name: 'side_chat_context',
        description: 'Read a focused, bounded excerpt from the main conversation. Use this whenever the side-chat request depends on the main conversation, its files, tool results, decisions, or selected text.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'A focused retrieval question, keyword, file name, decision, or topic.' },
            limit: { type: 'integer', minimum: 1, maximum: 60, description: 'Maximum excerpts to return. Default 24.' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              parentSessionId: { type: 'string' },
              query: { type: 'string' },
              eventCount: { type: 'integer' },
              selectedCount: { type: 'integer' },
              context: { type: 'string' },
            },
            required: ['parentSessionId', 'query', 'eventCount', 'selectedCount', 'context'],
            additionalProperties: false,
          },
          render: (_args, value) => [{ type: 'text', text: value.context }],
        },
        execute: args => readParentContext(parent.id, args),
      })
    }

    async function retainedHeader(parentSessionId, preset) {
      if (persistence === undefined || typeof persistence.list !== 'function') return undefined
      const headers = await persistence.list()
      return latestRetainedSession(headers, parentSessionId, preset)
    }

    function remember(parentSessionId, handle) {
      handles.set(handle.agent.id, handle)
      byParent.set(parentSessionId, handle.agent.id)
      return handle
    }

    async function createOrResume(parentSessionId, preset, readOnly) {
      const knownId = byParent.get(parentSessionId)
      if (knownId !== undefined) {
        const known = handles.get(knownId)
        if (known?.agent?.session?.header?.agentPreset === preset) return { handle: known, resumed: true }
      }

      const parent = await parentAgent(parentSessionId)
      const retained = await retainedHeader(parentSessionId, preset)
      if (retained !== undefined) {
        const live = agents.get(retained.id)
        if (live !== undefined) {
          return { handle: { agent: live, dispose: async () => {} }, resumed: true, borrowed: true }
        }
        const handle = await agents.resume({
          resumeSessionId: retained.id,
          setup: childCtx => composeChild(childCtx, parent, preset, readOnly),
        })
        return { handle: remember(parentSessionId, handle), resumed: true }
      }

      const sessionId = makeSideSessionId()
      const handle = await agents.create({
        sessionId,
        meta: {
          ...(parent.session?.header?.cwd === undefined ? {} : { cwd: parent.session.header.cwd }),
          parentSession: parentSessionId,
          agentPreset: preset,
        },
        agentOptions: safeAgentOptions(parent),
        setup: childCtx => composeChild(childCtx, parent, preset, readOnly),
      })
      return { handle: remember(parentSessionId, handle), resumed: false }
    }

    async function open(input) {
      const request = normalizeOpenRequest(input)
      const result = await createOrResume(request.parentSessionId, request.preset, request.readOnly)
      const child = result.handle.agent
      const pin = pinReadOnly(child.session, request.readOnly)
      const registry = requireService(workspaceRegistry, 'workspaceRegistry')
      // The embedded conversation refuses a workspace-less session with its
      // picker, so the side Session joins the parent's workspace.
      const parentWorkspace = typeof registry.list === 'function'
        ? registry.list().find(workspace => workspace.sessionIds?.includes(request.parentSessionId))
        : undefined
      if (parentWorkspace !== undefined && !parentWorkspace.sessionIds.includes(child.id)) {
        await parentWorkspace.attachSession(child.id)
      }
      await registry.archiveSession(child.id)
      return {
        sessionId: child.id,
        parentSessionId: request.parentSessionId,
        resumed: result.resumed,
        anchorText: request.anchorText,
        readOnly: request.readOnly,
        pin,
        effective: readPinState(child.session),
      }
    }

    async function release(sessionId) {
      const handle = handles.get(sessionId)
      if (handle === undefined) return
      if (sessions !== undefined && typeof sessions.flush === 'function') {
        await sessions.flush(handle.agent.session)
      }
      await handle.dispose()
      handles.delete(sessionId)
      for (const [parent, child] of byParent) {
        if (child === sessionId) byParent.delete(parent)
      }
    }

    async function close(input) {
      const source = input !== null && typeof input === 'object' ? input : {}
      const sessionId = requireSessionId(source.sessionId)
      const mode = source.mode === 'keep' ? 'keep' : source.mode === 'delete' ? 'delete' : undefined
      if (mode === undefined) throw new SideChatError('invalid-request', 'mode 必须是 keep 或 delete')

      if (mode === 'keep') {
        await release(sessionId)
        return { sessionId, mode, deleted: false }
      }

      const handle = handles.get(sessionId)
      const live = handle?.agent ?? agents.get(sessionId)
      const header = live?.session?.header
        ?? (persistence === undefined ? undefined : (await persistence.list()).find(item => item.id === sessionId))
      if (header === undefined || !String(header.id).startsWith(SIDE_ID_PREFIX)) {
        throw new SideChatError('not-side-chat', '拒绝删除非侧聊会话')
      }
      const location = persistence?.locate?.(header)
      if (location === undefined || location.kind !== 'jsonl') {
        throw new SideChatError('delete-unsupported', '当前会话存储后端不支持逐会话彻底删除；已保留该侧聊')
      }
      if (typeof harness.deleteSessionArtifact !== 'function') {
        throw new SideChatError('delete-unsupported', '当前插件载入方式不提供安全文件删除能力；请使用正式本地插件包')
      }
      await release(sessionId)
      await harness.deleteSessionArtifact(location, sessionId)
      return { sessionId, mode, deleted: true }
    }

    harness.handle('sideChat.open', open)
    harness.handle('sideChat.close', close)
    harness.handle('sideChat.context', async input => {
      const source = input !== null && typeof input === 'object' ? input : {}
      return readParentContext(requireSessionId(source.parentSessionId, 'parentSessionId'), source)
    })
    harness.handle('sideChat.ping', async () => ({ pong: Date.now() }))

    ctx.effect(() => async () => {
      const active = [...handles.values()]
      handles.clear()
      byParent.clear()
      await Promise.allSettled(active.map(handle => handle.dispose()))
    }, 'dsh-side-chat: dispose children')
  },
}
