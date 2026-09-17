import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

test('the panel binds the shipped conversation to the side Session through the public seam', () => {
  // DSH 0.1.6-alpha.2 added the explicit-binding path: SessionProvider takes a
  // `session` reference and the conversation content is a factory slot.
  assert.match(client, /sessionsService\?\.retain\?\.\(sideId, \{ source: 'sideChatPanel' \}\)/)
  assert.match(client, /h\(SessionProvider, \{ session: reference \}, renderSlot\(CONVERSATION_SLOT, \{\}\)\)/)
  assert.match(client, /renderFactorySlot\('conversation\.content', \{ variant: 'embedded', phase, hero \}/)
  assert.match(client, /children: \{ \[CONVERSATION_SLOT\]: \{ kind: 'single', scope: 'session' \} \}/)
  assert.match(client, /slots\.inject\(CONVERSATION_SLOT/)
  assert.match(client, /renderSlot\('conversation\.session', \{ view: 'chat' \}\)/)
})

test('the tab rides the right-Sidebar registry with page semantics', () => {
  assert.match(client, /tabs\?\.register\?\.\(\{/)
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab'/)
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab\.title'/)
  assert.match(client, /sidebarRight\?\.openTab\?\.\(TAB_KIND\)/)
  // No private seam and no hand-drawn transcript.
  assert.doesNotMatch(client, /slots\._core/)
  assert.doesNotMatch(client, /provideInfo/)
  assert.doesNotMatch(client, /dsh-sc-composer|dsh-sc-bubble|dsh-sc-scroll/)
})

test('promotion lives in the native assistant action row and writes the main draft', () => {
  assert.match(client, /slots\.inject\('conversation\.chat\.assistant-actions'/)
  assert.match(client, /function PromoteToMainAction\(\{ sessionId, messageId \}\)/)
  assert.match(client, /findSideOwner\(state, sessionId\)/)
  assert.match(client, /conversationService\?\.input\?\.for\?\.\(scope\)/)
  assert.match(client, /input\.setDraft\(quoteBlock\(body\)\)/)
  assert.match(client, /\*\*来自旁聊：\*\*/)
})

test('lifecycle offers keep-or-delete with a remembered choice', () => {
  assert.match(client, /删除并关闭/)
  assert.match(client, /保留对话/)
  assert.match(client, /记住此选择/)
  assert.match(client, /function requestClose\(parentId, sideId\)/)
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
  assert.match(client, /function openSide\(parentId\)/)
  assert.match(client, /const existing = uiState\.sides\.get\(parentId\)/)
  assert.match(client, /readOnly: uiState\.readOnly/)
})
