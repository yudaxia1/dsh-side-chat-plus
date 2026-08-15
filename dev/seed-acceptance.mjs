import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
const root = 'E:/DSH_Work/dsh-side-chat/dev/dsh-home/sessions'
const cwd = 'E:/DSH_Work/dsh-side-chat'
const id = SessionId('session-sidechat-acceptance-main')
const time = Date.now()

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })

if ((await ctx.sessionPersistence.list()).some(header => header.id === id)) {
  await ctx.fiber.dispose()
  process.stdout.write(`${id}\n`)
  process.exit(0)
}

await ctx.sessionPersistence.create({
  version: 0,
  id,
  createdAt: time,
  cwd,
  delegationDepth: 0,
  agentPreset: 'cordis',
})
await ctx.sessionPersistence.append(id, [
  {
    type: 'turn/start',
    seq: 0,
    time,
    data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'side-chat-acceptance' } } },
  },
  {
    type: 'user/message',
    seq: 1,
    time: time + 1,
    data: {
      content: [{ type: 'text', text: '侧聊界面验收样本：这是主会话中的一段文字。' }],
      source: { kind: 'user', rpcId: 'side-chat-acceptance' },
    },
    surfaceOp: 'append',
  },
  {
    type: 'session/title',
    seq: 2,
    time: time + 2,
    data: { title: '侧聊界面验收', messageSeqs: [1], source: { kind: 'fallback' } },
  },
  {
    type: 'turn/end',
    seq: 3,
    time: time + 3,
    data: { turn: 1, reason: { kind: 'completed' } },
  },
])

await ctx.fiber.dispose()
process.stdout.write(`${id}\n`)
