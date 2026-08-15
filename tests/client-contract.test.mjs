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
  assert.match(client, /slash\/input-insert-reference/)
  assert.match(client, /side-chat-selection/)
  assert.match(client, /> 主对话选文/)
  assert.doesNotMatch(client, /side_chat_selected_text/)
  assert.doesNotMatch(client, /请围绕主对话中选中的这段文字/)
  assert.doesNotMatch(client, /sideChat\.send|mergeMessages|assistantBody/)
})

test('settings expose enablement and native preset choices', () => {
  assert.match(client, /id: 'side-chat'/)
  assert.match(client, /name: 'settings\.section'/)
  assert.match(client, /标准模式/)
  assert.match(client, /PTC 模式/)
  assert.match(client, /极简模式/)
  assert.match(client, /创造模式/)
  assert.doesNotMatch(client, /showModelSelector|data-show-model-selector/)
  assert.doesNotMatch(client, /显示模型选择/)
})

test('side session uses framework BindingContext provider and arbitrary provideInfo', () => {
  assert.match(client, /SessionProvider\(\{ empty:/)
  assert.match(client, /sessionsService\?\.provideInfo\?\./)
  assert.match(client, /h\(BindingProvider, \{ value: sideInfo/)
  assert.match(client, /sessionsService\?\.binding\?\.\(sideId\)\?\.session/)
  assert.match(client, /session\.open\(\)/)
  assert.match(client, /source\.subscribe\(listener\)/)
})

test('parallel shell aligns, resizes, hides and restores the native side conversation', () => {
  assert.match(client, /data-conversation-scroll.*data-composer-seat/)
  assert.match(client, /dsh-sc-column-side:not\(:has\(\[data-slot="conversation\.composer\.dock"\]>\*\)\)\{padding-bottom:24px\}/)
  assert.match(client, /role: 'separator'/)
  assert.match(client, /aria-label': '调整主对话与侧聊宽度'/)
  assert.match(client, /sideRatio/)
  assert.match(client, /label: '隐藏侧聊'/)
  assert.match(client, /label: '显示侧聊'/)
  assert.match(client, /function SideChatIcon/)
  assert.match(client, /Same message-plus glyph used by DSH/)
  assert.doesNotMatch(client, /dsh-sc-side-actions/)
  assert.match(client, /name: 'conversation\.session\.header\.utilities'/)
  assert.match(client, /id: 'side-chat-controls'/)
  assert.match(client, /ReactDOM\.createPortal/)
})
