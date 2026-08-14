/**
 * 冒烟测试：按动态插件沙箱的方式求值 dist/host.js 与 dist/client.js，
 * 断言两边都返回合法插件（对象 + apply 函数）。
 * 运行方式（沙箱内避免子进程管道）：node tests/smoke.test.mjs
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostCode = readFileSync(join(root, 'dist', 'host.js'), 'utf8')
const clientCode = readFileSync(join(root, 'dist', 'client.js'), 'utf8')

describe('dist/host.js', () => {
  test('在 vm 沙箱中求值返回 { apply } 插件', async () => {
    const sandbox = {
      console,
      btoa: (s) => Buffer.from(s, 'utf-8').toString('base64'),
      atob: (s) => Buffer.from(s, 'base64').toString('utf-8'),
      TextEncoder,
      TextDecoder,
      harness: {},
      require: () => { throw new Error('require trapped') },
    }
    vm.createContext(sandbox)
    const plugin = await vm.runInContext(`(async () => {\n${hostCode}\n})()`, sandbox, { timeout: 10000 })
    assert.equal(typeof plugin, 'object')
    assert.equal(typeof plugin.apply, 'function')
  })

  test('沙箱内不暴露 AbortController（本插件不依赖它）', () => {
    const sandbox = { console }
    vm.createContext(sandbox)
    assert.equal(vm.runInContext('typeof AbortController', sandbox), 'undefined')
  })
})

describe('dist/client.js', () => {
  test('以闭包参数求值返回 { apply, inject } 插件', async () => {
    const React = { createElement: (...args) => ({ kind: 'element', args }) }
    const styles = {
      insert: (css) => {
        assert.equal(typeof css, 'string')
        assert.ok(css.length > 100)
      },
    }
    const host = { call: async () => ({ ok: true }) }
    const harnessTrap = new Proxy({}, { get: () => { throw new Error('harness is host-only') } })
    const traps = {
      setTimeout: () => { throw new Error('timer trapped') },
      setInterval: () => { throw new Error('timer trapped') },
      clearTimeout: () => {},
      clearInterval: () => {},
      fetch: () => { throw new Error('fetch trapped') },
      require: () => { throw new Error('require trapped') },
    }
    const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
    const factory = new Function(...parameters, `return (async () => {\n${clientCode}\n})()`)
    const plugin = await factory(React, console, styles, host, harnessTrap, ...Object.values(traps), undefined, undefined)
    assert.equal(typeof plugin, 'object')
    assert.ok(Array.isArray(plugin.inject))
    assert.equal(typeof plugin.apply, 'function')
  })
})
