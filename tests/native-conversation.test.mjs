import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const client = (await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const functionStart = client.indexOf('function adoptNativeConversation')
const functionEnd = client.indexOf('\n\nreturn {', functionStart)
assert.notEqual(functionStart, -1, 'adoptNativeConversation source is missing')
assert.notEqual(functionEnd, -1, 'adoptNativeConversation source boundary is missing')
const adoptionSource = client.slice(functionStart, functionEnd)

const ParallelConversation = function ParallelConversation() {}
const loadAdoption = new Function('ParallelConversation', `
  let NativeConversationRoot = null
  ${adoptionSource}
  return {
    adoptNativeConversation,
    nativeRoot: () => NativeConversationRoot,
  }
`)

function createEntry(component = function NativeConversation() {}) {
  const writes = []
  let current = component
  const entry = {
    children: {
      'conversation.session': { kind: 'single' },
      'conversation.composer.bar': { kind: 'single' },
    },
    writes,
  }
  Object.defineProperty(entry, 'component', {
    get: () => current,
    set: value => {
      writes.push(value)
      current = value
    },
  })
  return entry
}

function createSlots(initialEntries = []) {
  let entries = initialEntries
  // One listener set per slot record, as the real SlotCore keeps them.
  const listenersBySeat = new Map()
  let pulseCount = 0
  // Both seats are declared, as in a build where the native entry has moved.
  const seats = ['main.conversation', 'conversation']
  const isSeat = key => seats.includes(key)
  const core = {
    entries: key => isSeat(key) ? entries : [],
    subscribe: (key, listener) => {
      assert.ok(isSeat(key), `unexpected subscription ${key}`)
      const set = listenersBySeat.get(key) ?? new Set()
      set.add(listener)
      listenersBySeat.set(key, set)
      return () => set.delete(listener)
    },
    specDynamic: key => isSeat(key) ? { kind: 'single', scope: 'session-maybe' } : undefined,
    register: (options) => {
      assert.deepEqual(Object.keys(options).sort(), ['name', 'priority'])
      assert.ok(isSeat(options.name), `unexpected seat ${options.name}`)
      pulseCount += 1
      return () => { pulseCount += 1 }
    },
  }
  return {
    slots: { _core: core },
    listenerCount: () => [...listenersBySeat.values()].reduce((total, set) => total + set.size, 0),
    pulseCount: () => pulseCount,
    setEntries(next) {
      entries = next
      for (const set of listenersBySeat.values()) for (const listener of [...set]) listener()
    },
    notify() {
      for (const set of listenersBySeat.values()) for (const listener of [...set]) listener()
    },
  }
}

function createTimer() {
  const pending = new Set()
  const delays = []
  let cancelCount = 0
  return {
    timer: {
      setTimeout(callback, delay) {
        const record = { callback, active: true }
        delays.push(delay)
        pending.add(record)
        return () => {
          if (!record.active) return
          record.active = false
          pending.delete(record)
          cancelCount += 1
        }
      },
    },
    delays,
    cancelCount: () => cancelCount,
    pendingCount: () => pending.size,
    fire() {
      for (const record of [...pending]) {
        pending.delete(record)
        if (!record.active) continue
        record.active = false
        record.callback()
      }
    },
  }
}

test('adopts an already registered native conversation exactly once and restores it', () => {
  const { adoptNativeConversation, nativeRoot } = loadAdoption(ParallelConversation)
  const entry = createEntry()
  const original = entry.component
  const slots = createSlots([entry])
  const timer = createTimer()

  const dispose = adoptNativeConversation(slots.slots, timer.timer)
  assert.equal(entry.component, ParallelConversation)
  assert.equal(nativeRoot(), original)
  assert.deepEqual(entry.writes, [ParallelConversation])
  assert.equal(timer.pendingCount(), 0)

  slots.notify()
  slots.notify()
  assert.deepEqual(entry.writes, [ParallelConversation], 'registry notifications must not wrap the entry again')

  dispose()
  dispose()
  assert.equal(entry.component, original)
  assert.equal(nativeRoot(), null)
  assert.deepEqual(entry.writes, [ParallelConversation, original])
  assert.equal(slots.listenerCount(), 0)
  assert.equal(slots.pulseCount(), 4)
})

test('waits when Side Chat starts first and follows native conversation remounts', () => {
  const { adoptNativeConversation, nativeRoot } = loadAdoption(ParallelConversation)
  const slots = createSlots()
  const timer = createTimer()
  const unavailable = []

  const dispose = adoptNativeConversation(slots.slots, timer.timer, {
    timeoutMs: 321,
    onUnavailable: error => unavailable.push(error),
  })
  assert.equal(slots.listenerCount(), 2, 'both conversation seats stay watched')
  assert.deepEqual(timer.delays, [321])

  const first = createEntry()
  const firstOriginal = first.component
  slots.setEntries([first])
  assert.equal(first.component, ParallelConversation)
  assert.equal(nativeRoot(), firstOriginal)
  assert.equal(timer.pendingCount(), 0)

  slots.setEntries([])
  assert.equal(first.component, firstOriginal)
  assert.equal(timer.pendingCount(), 1, 'native unload should begin a new bounded wait')

  const second = createEntry()
  const secondOriginal = second.component
  slots.setEntries([second])
  assert.equal(second.component, ParallelConversation)
  assert.equal(nativeRoot(), secondOriginal)
  assert.equal(timer.pendingCount(), 0)
  assert.deepEqual(unavailable, [])

  dispose()
  assert.equal(second.component, secondOriginal)
  assert.equal(nativeRoot(), null)
})

test('disposing a pending adoption cancels the deadline and prevents late mutation', () => {
  const { adoptNativeConversation } = loadAdoption(ParallelConversation)
  const slots = createSlots()
  const timer = createTimer()
  const unavailable = []

  const dispose = adoptNativeConversation(slots.slots, timer.timer, {
    onUnavailable: error => unavailable.push(error),
  })
  assert.equal(timer.pendingCount(), 1)
  dispose()
  assert.equal(timer.pendingCount(), 0)
  assert.equal(timer.cancelCount(), 1)
  assert.equal(slots.listenerCount(), 0)

  const late = createEntry()
  slots.setEntries([late])
  timer.fire()
  assert.notEqual(late.component, ParallelConversation)
  assert.deepEqual(late.writes, [])
  assert.deepEqual(unavailable, [])
})

test('a permanently unavailable target times out without failing plugin startup', () => {
  const { adoptNativeConversation } = loadAdoption(ParallelConversation)
  const slots = createSlots([{ component: function OtherEntry() {}, children: {} }])
  const timer = createTimer()
  const unavailable = []

  let release
  assert.doesNotThrow(() => {
    release = adoptNativeConversation(slots.slots, timer.timer, {
      timeoutMs: 50,
      onUnavailable: error => unavailable.push(error),
    })
  })
  timer.fire()
  assert.equal(unavailable.length, 1)
  assert.match(unavailable[0].message, /unavailable after 50ms/)
  assert.equal(slots.listenerCount(), 0)

  const late = createEntry()
  slots.setEntries([late])
  assert.deepEqual(late.writes, [])
  release?.()
})

test('adoption targets every seat the native conversation entry has occupied', async () => {
  const client = (await readFile(new URL('../src/client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  // DSH 0.1.6 declares the native ConversationRoot entry under
  // `main.conversation`; older builds used `conversation`. Looking only at the
  // old seat leaves the split shell permanently unadopted.
  assert.match(client, /'main\.conversation', 'conversation'/)
})
