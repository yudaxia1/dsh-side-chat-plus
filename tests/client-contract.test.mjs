import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

test('client adopts the one native conversation declaration and reuses its inner slots', () => {
  assert.match(client, /core\?\.entries\?\.\('conversation'\)/)
  assert.match(client, /nativeEntry\.component = ParallelConversation/)
  assert.match(client, /name: 'conversation', priority: -100/)
  for (const slot of ['conversation.session', 'conversation.composer.bar']) {
    assert.match(client, new RegExp(slot.replaceAll('.', '\\.')))
  }
  assert.match(client, /NativeConversationRoot = previous/)
  assert.match(client, /h\(NativeConversationRoot, props\)/)
  assert.match(client, /h\(SideNativeConversation/)
  assert.doesNotMatch(client, /shell\.overlay|name: 'details'|openDetails|closeDetails/)
})

test('client contains the requested delete-or-keep and selection entry interactions', () => {
  assert.match(client, /删除并关闭/)
  assert.match(client, /保留对话/)
  assert.match(client, /在侧聊中对话/)
  assert.match(client, /inputActions\?\.setDraft/)
  assert.doesNotMatch(client, /sideChat\.send|mergeMessages|assistantBody/)
})

test('side session uses framework BindingContext provider and arbitrary provideInfo', () => {
  assert.match(client, /SessionProvider\(\{ empty:/)
  assert.match(client, /sessionsService\?\.provideInfo\?\./)
  assert.match(client, /h\(BindingProvider, \{ value: sideInfo/)
  assert.match(client, /source\.subscribe\(listener\)/)
})

test('parallel shell aligns, resizes, hides and restores the native side conversation', () => {
  assert.match(client, /data-conversation-scroll.*data-composer-seat/)
  assert.match(client, /role: 'separator'/)
  assert.match(client, /aria-label': '调整主对话与侧聊宽度'/)
  assert.match(client, /sideRatio/)
  assert.match(client, /label: '隐藏侧聊'/)
  assert.match(client, /label: '显示侧聊'/)
  assert.match(client, /function SideChatIcon/)
  assert.match(client, /Same message-plus glyph used by DSH/)
})
