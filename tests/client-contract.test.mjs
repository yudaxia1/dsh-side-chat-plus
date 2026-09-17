import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

test('the panel is an official right-Sidebar tab, not a private-seam split shell', () => {
  // DSH 0.1.6 binds one Session in the renderer tree; rendering a second
  // Session's native conversation needs seams the platform does not expose.
  // The plugin therefore owns its transcript inside a supported tab seat.
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab'/)
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab\.title'/)
  assert.match(client, /tabs\?\.register\?\.\(\{/)
  assert.match(client, /kind: TAB_KIND/)
  assert.match(client, /sidebarRight\?\.openTab\?\.\(TAB_KIND\)/)
  // The abandoned mechanisms must not come back.
  assert.doesNotMatch(client, /slots\._core/)
  assert.doesNotMatch(client, /provideInfo/)
  assert.doesNotMatch(client, /ParallelConversation/)
  assert.doesNotMatch(client, /SessionProvider/)
  assert.doesNotMatch(client, /dsh-sc-resizer/)
  assert.doesNotMatch(client, /conversation\.session\.header\.utilities/)
})

test('the panel draws the side transcript from the public Session object layer', () => {
  assert.match(client, /sessionsService\?\.binding\?\.\(sideId\)/)
  assert.match(client, /binding\?\.eventSource/)
  assert.match(client, /session\.open\(\)/)
  assert.match(client, /function projectSideMessages\(entries\)/)
  assert.match(client, /type === 'user\/message'/)
  assert.match(client, /type === 'assistant\/message'/)
  assert.match(client, /type === 'tool\/result'/)
  assert.match(client, /type === 'assistant\/live-chunk'/)
  assert.match(client, /chunk\?\.type === 'text-delta'/)
  assert.match(client, /function argumentHint\(args\)/)
})

test('sending uses the native prompt path with a local submission echo', () => {
  assert.match(client, /session\.beginSubmission\?\.\(\{ mode: 'queue', text, attachments: \[\] \}\)/)
  assert.match(client, /session\.prompt\(\[\{ type: 'text', text \}\], 'queue', undefined, handle\?\.requestId\)/)
  assert.match(client, /handle\?\.abandon\?\.\(\)/)
  assert.match(client, /void session\.cancel\?\.\(\)/)
})

test('promotion writes the answer into the main composer draft', () => {
  assert.match(client, /function promoteToMain\(parentId, text\)/)
  assert.match(client, /conversationService\?\.input\?\.for\?\.\(scope\)/)
  assert.match(client, /if \(input === undefined \|\| typeof input\.setDraft !== 'function'\) return false/)
  assert.match(client, /input\.setDraft\(quoteBlock\(body\)\)/)
  assert.match(client, /\*\*来自旁聊：\*\*/)
  assert.match(client, /'aria-label': '带到主会话'/)
})

test('lifecycle offers keep-or-delete with a remembered choice', () => {
  assert.match(client, /删除并关闭/)
  assert.match(client, /保留对话/)
  assert.match(client, /记住此选择/)
  assert.match(client, /function requestClose\(parentId, sideId\)/)
  assert.match(client, /uiState\.closeBehavior === 'ask'/)
  assert.match(client, /rpc\('sideChat\.close', \{ sessionId: sideId, mode \}\)/)
})

test('settings expose enablement, read-only default and native preset choices', () => {
  assert.match(client, /name: 'settings\.section'/)
  assert.match(client, /启用旁聊/)
  assert.match(client, /只读模式/)
  assert.match(client, /const fallback = \{ enabled: true, preset: 'standard', closeBehavior: 'ask', readOnly: true \}/)
  assert.match(client, /readOnly: uiState\.readOnly/)
  for (const label of ['标准模式', 'PTC 模式', '极简模式', '创造模式', '每次询问', '始终保留', '始终删除']) {
    assert.match(client, new RegExp(label))
  }
  assert.match(client, /id: 'ptc'/)
  assert.doesNotMatch(client, /id: 'code'/)
})

test('side sessions stay scoped to their owning main session', () => {
  assert.match(client, /sides: new Map\(\)/)
  assert.match(client, /sides\.set\(parentId, Object\.freeze\(side\)\)/)
  assert.match(client, /const side = activeId === undefined \? undefined : state\.sides\.get\(activeId\)/)
  assert.match(client, /function openSide\(parentId\)/)
  assert.match(client, /if \(uiState\.sides\.has\(parentId\)\)/)
  assert.match(client, /readOnly: uiState\.readOnly/)
})
