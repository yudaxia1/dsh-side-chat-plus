import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIDE_ID_PREFIX,
  SIDE_CHAT_PRESET,
  latestRetainedSession,
  makeSideSessionId,
  normalizeOpenRequest,
  selectContextEvents,
} from '../src/core.mjs'

test('side session ids are isolated from normal root ids', () => {
  const id = makeSideSessionId(1234, 0.5)
  assert.match(id, new RegExp(`^${SIDE_ID_PREFIX}`))
  assert.equal(id, makeSideSessionId(1234, 0.5))
})

test('retained lookup accepts only this parent hidden child and chooses newest', () => {
  const headers = [
    { id: 'normal', createdAt: 99 },
    { id: `${SIDE_ID_PREFIX}legacy`, origin: 'subagent', agentPreset: SIDE_CHAT_PRESET, parentSession: 'p', createdAt: 11 },
    { id: `${SIDE_ID_PREFIX}creative`, agentPreset: 'cordis', parentSession: 'p', createdAt: 10 },
    { id: `${SIDE_ID_PREFIX}a`, agentPreset: SIDE_CHAT_PRESET, parentSession: 'p', createdAt: 1 },
    { id: `${SIDE_ID_PREFIX}b`, agentPreset: SIDE_CHAT_PRESET, parentSession: 'other', createdAt: 9 },
    { id: `${SIDE_ID_PREFIX}c`, agentPreset: SIDE_CHAT_PRESET, parentSession: 'p', createdAt: 4 },
  ]
  assert.equal(latestRetainedSession(headers, 'p').id, `${SIDE_ID_PREFIX}c`)
  assert.equal(latestRetainedSession(headers, 'p', 'cordis').id, `${SIDE_ID_PREFIX}creative`)
})

test('context retrieval is bounded, chronological and relevance-aware', () => {
  const events = Array.from({ length: 100 }, (_, seq) => ({ type: 'message', seq, data: { text: `ordinary ${seq}` } }))
  events[50] = { type: 'message', seq: 50, data: { text: 'decisive architecture SideProvider bridge' } }
  const selected = selectContextEvents(events, 'SideProvider architecture', 18)
  assert.equal(selected.length, 18)
  assert.ok(selected.some(event => event.seq === 50))
  assert.deepEqual(selected.map(event => event.seq), selected.map(event => event.seq).toSorted((a, b) => a - b))
  assert.ok(selected.some(event => event.seq === 0))
  assert.ok(selected.some(event => event.seq === 99))
})

test('opening carries selection as draft metadata, never as a transcript seed', () => {
  assert.deepEqual(normalizeOpenRequest({ parentSessionId: 'main', anchorText: '  chosen  ' }), {
    parentSessionId: 'main',
    anchorText: 'chosen',
    preset: 'standard',
    readOnly: true,
  })
})

test('opening defaults to read-only and honors an explicit writable choice', () => {
  assert.equal(normalizeOpenRequest({ parentSessionId: 'main' }).readOnly, true)
  assert.equal(normalizeOpenRequest({ parentSessionId: 'main', readOnly: false }).readOnly, false)
  assert.equal(normalizeOpenRequest({ parentSessionId: 'main', readOnly: 'yes' }).readOnly, true)
})

test('opening accepts only shipped DSH presets and falls back to standard', () => {
  assert.equal(normalizeOpenRequest({ parentSessionId: 'main', preset: 'cordis' }).preset, 'cordis')
  assert.equal(normalizeOpenRequest({ parentSessionId: 'main', preset: 'claude' }).preset, 'standard')
})
