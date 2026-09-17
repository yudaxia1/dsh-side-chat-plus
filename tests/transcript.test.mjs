import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// The promote path reads plain text out of message content blocks; the fold is
// pure, so it is extracted and executed rather than asserted by source shape.
const client = (await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const start = client.indexOf('function textOfBlocks(')
const end = client.indexOf('/* ------------------------------------------------------------------- pieces */')
assert.notEqual(start, -1, 'promotion helpers are missing')
assert.notEqual(end, -1, 'promotion helpers have no boundary')
const { textOfBlocks, quoteBlock } = new Function(`${client.slice(start, end)}
  return { textOfBlocks, quoteBlock }`)()

test('textOfBlocks keeps only text blocks', () => {
  assert.equal(textOfBlocks([
    { type: 'text', text: '前半' },
    { type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' },
    { type: 'text', text: '后半' },
  ]), '前半后半')
  assert.equal(textOfBlocks(undefined), '')
  assert.equal(textOfBlocks([{ type: 'reasoning', text: '只思考' }]), '')
})

test('quoteBlock marks the side answer as a quoted block', () => {
  const quoted = quoteBlock('第一行\n第二行')
  assert.equal(quoted, '**来自旁聊：**\n\n> 第一行\n> 第二行')
})
