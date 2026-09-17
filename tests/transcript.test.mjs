import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// The projection is pure, so it is extracted and executed rather than asserted
// by source shape: message folding is the part a regression breaks silently.
const client = (await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const start = client.indexOf('function textOfBlocks(')
const end = client.indexOf('/* ---------------------------------------------------------------- promotion */')
assert.notEqual(start, -1, 'projection helpers are missing')
assert.notEqual(end, -1, 'projection helpers have no boundary')
const { projectSideMessages } = new Function(`${client.slice(start, end)}
  return { projectSideMessages }`)()

const entry = event => ({ type: 'event', event })

test('user and assistant messages fold into transcript rows', () => {
  const rows = projectSideMessages([
    entry({ type: 'user/message', seq: 1, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '主会话在聊什么？' }] } }),
    entry({ type: 'assistant/message', seq: 2, data: { message: { id: 'm2', content: [{ type: 'text', text: '在聊侧聊插件。' }] } } }),
  ])
  assert.deepEqual(rows.map(row => [row.kind, row.id, row.text]), [
    ['user', 'm1', '主会话在聊什么？'],
    ['assistant', 'm2', '在聊侧聊插件。'],
  ])
})

test('tool calls render beside the answer and results render as their own row', () => {
  const rows = projectSideMessages([
    entry({
      type: 'assistant/message',
      seq: 3,
      data: {
        message: {
          id: 'm3',
          content: [
            { type: 'text', text: '让我看看。' },
            { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":"src/client.js"}' },
          ],
        },
      },
    }),
    entry({
      type: 'tool/result',
      seq: 4,
      data: { message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: '路径不存在' }] }] } },
    }),
  ])
  assert.equal(rows[0].kind, 'assistant')
  assert.deepEqual(rows[0].tools, [{ id: 'c1', name: 'read', args: '{"file_path":"src/client.js"}' }])
  assert.equal(rows[1].kind, 'tool-result')
  assert.equal(rows[1].isError, true)
  assert.equal(rows[1].text, '路径不存在')
})

test('live text deltas accumulate into one streaming row until the durable message lands', () => {
  const streaming = projectSideMessages([
    entry({ type: 'assistant/live-chunk', seq: 5, data: { chunk: { type: 'text-delta', text: '你' } } }),
    entry({ type: 'assistant/live-chunk', seq: 6, data: { chunk: { type: 'text-delta', text: '好' } } }),
    entry({ type: 'assistant/live-chunk', seq: 7, data: { chunk: { type: 'reasoning-delta', text: '想想' } } }),
  ])
  assert.equal(streaming.length, 1)
  assert.equal(streaming[0].streaming, true)
  assert.equal(streaming[0].text, '你好')

  const settled = projectSideMessages([
    entry({ type: 'assistant/live-chunk', seq: 5, data: { chunk: { type: 'text-delta', text: '你' } } }),
    entry({ type: 'assistant/message', seq: 6, data: { message: { id: 'm6', content: [{ type: 'text', text: '你好' }] } } }),
  ])
  assert.equal(settled.length, 1)
  assert.equal(settled[0].streaming, undefined)
  assert.equal(settled[0].id, 'm6')
})

test('empty and unknown events never produce rows', () => {
  const rows = projectSideMessages([
    entry({ type: 'turn/start', seq: 1, data: { turn: 1 } }),
    entry({ type: 'assistant/message', seq: 2, data: { message: { id: 'm2', content: [] } } }),
    entry({ type: 'assistant/live-chunk', seq: 3, data: { chunk: { type: 'block-start' } } }),
  ])
  assert.deepEqual(rows, [])
})
