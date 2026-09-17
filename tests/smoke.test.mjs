import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as formalHost from '../dist/formal-host.mjs'

test('formal host exposes a normal DSH package face', () => {
  assert.equal(formalHost.name, 'dsh-side-chat-plus')
  assert.equal(typeof formalHost.apply, 'function')
  assert.ok(formalHost.inject.includes('sessionPersistence'))
  assert.ok(formalHost.inject.includes('agentPresets'))
})

test('portable client contains no absolute source checkout path', async () => {
  const client = await readFile(new URL('../dist/formal-client.cjs', import.meta.url), 'utf8')
  assert.ok(client.length > 1000)
  assert.doesNotMatch(client, /E:\/DSH_Work\/dsh-src/i)
  assert.match(client, /dsh-side-chat/)
})
