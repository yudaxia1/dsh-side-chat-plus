/**
 * Build the local, non-dynamic DSH development package.
 *
 * The normal dist files are dynamic Cordis bodies and remain unchanged. This
 * adapter turns the same source into a local dual-face package so the host
 * loads it through the ordinary DSH loader and the browser uses the public
 * Connection RPC instead of a large cordis_define payload.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = join(root, 'dev')
const packageName = process.env.DSH_SIDE_CHAT_PACKAGE_ID ?? 'dsh-side-chat-dev'
if (!/^dsh-side-chat(?:-dev)?$/.test(packageName)) {
  throw new Error(`unsupported local package id: ${packageName}`)
}
const packageRoot = join(devRoot, 'node_modules', packageName)
const sandboxPackageRoot = join(devRoot, 'dsh-home', 'profiles', 'web', 'node_modules', packageName)

const coreSource = readFileSync(join(root, 'src', 'core.mjs'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\nexport \{[\s\S]*\}\s*$/, '\n')
const hostTemplate = readFileSync(join(root, 'src', 'host.template.js'), 'utf8')
  .replace(/\r\n/g, '\n')
const clientSource = readFileSync(join(root, 'src', 'client.js'), 'utf8')
  .replace(/\r\n/g, '\n')

if (!hostTemplate.includes('/*__CORE_SOURCE__*/')) {
  throw new Error('host.template.js 缺少 /*__CORE_SOURCE__*/ 占位符')
}
const hostMarker = "return {\n  inject: ['sessionQuery', 'sessionPersistence', 'sessions', 'agents', 'agentPresets', 'workspaceRegistry'],\n  apply(ctx) {"
const clientMarker = "return {\n  inject: ['slots', 'timer', 'sessions', 'conversation', 'remote', 'remote.session'],\n  apply(ctx) {"
if (!hostTemplate.includes(hostMarker)) {
  throw new Error('host.template.js 的动态入口形状已变化，停止生成本地适配器')
}
if (!clientSource.includes(clientMarker)) {
  throw new Error('client.js 的动态入口形状已变化，停止生成本地适配器')
}

const hostPrelude = `import { lstat, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

export const name = '${packageName}'
export const inject = ['sessionQuery', 'sessionPersistence', 'sessions', 'agents', 'agentPresets', 'workspaceRegistry', 'connection', 'webServer']

const sideChatHandlers = new Map()
const harness = {
  handle(method, handler) {
    sideChatHandlers.set(method, handler)
    return () => sideChatHandlers.delete(method)
  },
  async deleteSessionArtifact(location, sessionId) {
    if (location?.kind !== 'jsonl' || typeof location.path !== 'string' || !isAbsolute(location.path)) {
      throw new Error('拒绝删除无效的会话存储位置')
    }
    if (typeof sessionId !== 'string' || !sessionId.startsWith('sidechat-')) {
      throw new Error('拒绝删除非侧聊会话')
    }
    const target = resolve(location.path)
    const filename = basename(target)
    if (filename !== 'session.jsonl' && filename !== 'session.jsonl.zstd') {
      throw new Error('拒绝删除非 JSONL 会话文件')
    }
    const info = await lstat(target)
    if (!info.isFile()) throw new Error('侧聊存储位置不是普通文件')
    await unlink(target)
    try {
      await rmdir(dirname(target))
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') throw error
    }
  },
}

export function apply(ctx) {`

let hostSource = hostTemplate
  .replace(hostMarker, hostPrelude)
  .replace('/*__CORE_SOURCE__*/', coreSource)

const hostTail = `
  // DSH 0.1.6 cannot serve a third-party channel registered through the
  // Connection service's handle(): it registers its route through
  // owner.webServer, and owner is the Connection service's own Context, which
  // never injects webServer (the Gateway only appears to work because its
  // intercept() and exact Fetch routes never touch webServer). Register the
  // prefix route ourselves and reuse the service's requestRejection so the
  // Host/Origin fence and browser authentication stay identical to a native
  // channel.
  const SIDE_CHAT_CHANNEL = '/side-chat'
  const SIDE_CHAT_MAX_BODY_BYTES = 1048576
  const SIDE_CHAT_ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

  function sideChatEndpoint(pathname) {
    const prefix = SIDE_CHAT_CHANNEL + '/'
    if (!pathname.startsWith(prefix)) return undefined
    const endpoint = pathname.slice(prefix.length)
    const segments = endpoint.split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || !SIDE_CHAT_ENDPOINT_SEGMENT.test(segment))) return undefined
    return endpoint
  }

  function sideChatWrite(res, status, body, contentType) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(status, { 'content-type': contentType ?? 'text/plain' })
    res.end(text)
  }

  function sideChatResponse(res, rpcId, result) {
    sideChatWrite(res, 200, { type: 'server-response', rpcId, result }, 'application/json')
  }

  function sideChatFailed(res, rpcId, code, message) {
    sideChatResponse(res, rpcId, { ok: false, error: { code, message, details: {} } })
  }

  async function sideChatReadBody(req) {
    const declared = req.headers['content-length']
    if (declared !== undefined && Number(declared) > SIDE_CHAT_MAX_BODY_BYTES) return undefined
    const chunks = []
    let received = 0
    for await (const chunk of req) {
      received += chunk.byteLength
      if (received > SIDE_CHAT_MAX_BODY_BYTES) return undefined
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  ctx.inject(['connection', 'webServer'], (connectionCtx) => {
    const connection = connectionCtx.connection
    if (connection?.requestRejection === undefined || connectionCtx.webServer?.register === undefined) {
      throw new Error('dsh-side-chat-dev: the Host connection fence or web server is unavailable')
    }
    const route = {
      kind: 'prefix',
      path: SIDE_CHAT_CHANNEL,
      handler: async (req, res) => {
        // Same fence the native channels apply: loopback Host/Origin trust, then
        // the browser session cookie minted from the process launch token.
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'POST') {
          sideChatWrite(res, 404, 'not found')
          return
        }
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const endpoint = sideChatEndpoint(pathname)
        if (endpoint === undefined) {
          sideChatWrite(res, 404, 'not found')
          return
        }
        const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
        if (mediaType !== 'application/json') {
          sideChatWrite(res, 415, 'content type must be application/json')
          return
        }
        const raw = await sideChatReadBody(req)
        if (raw === undefined) {
          sideChatWrite(res, 413, 'request body too large')
          return
        }
        let envelope
        try {
          envelope = JSON.parse(raw)
        } catch (error) {
          void error
          sideChatWrite(res, 400, 'body is not JSON')
          return
        }
        const rpcId = typeof envelope?.rpcId === 'string' ? envelope.rpcId : 'invalid-request'
        if (envelope?.type !== 'client-request' || typeof envelope.method !== 'string') {
          sideChatFailed(res, rpcId, 'gateway/bad-request', 'invalid client-request message')
          return
        }
        if (envelope.method !== endpoint) {
          sideChatFailed(res, rpcId, 'gateway/bad-request', 'method ' + JSON.stringify(envelope.method) + ' does not match endpoint ' + JSON.stringify(endpoint))
          return
        }
        const handler = sideChatHandlers.get(endpoint)
        if (handler === undefined) {
          sideChatFailed(res, rpcId, 'internal', '未知侧聊方法: ' + endpoint)
          return
        }
        try {
          sideChatResponse(res, rpcId, { ok: true, value: await handler(envelope.payload) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sideChatFailed(res, rpcId, 'internal', message)
        }
      },
    }
    connectionCtx.effect(() => {
      const disposeRoute = connectionCtx.webServer.register(route)
      return () => {
        disposeRoute()
        sideChatHandlers.clear()
      }
    }, 'dsh-side-chat-dev: side-chat rpc route')
  })
}`

if (!/\n  \},\n\}\s*$/.test(hostSource)) {
  throw new Error('host.template.js 的结束形状已变化，停止生成本地适配器')
}
hostSource = hostSource.replace(/\n  \},\n\}\s*$/, `${hostTail}\n`)

mkdirSync(packageRoot, { recursive: true })
writeFileSync(join(packageRoot, 'host.mjs'), hostSource)
writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
  name: packageName,
  version: '0.0.0-dev',
  private: true,
  type: 'module',
  exports: {
    '.': './host.mjs',
    './package.json': './package.json',
    './client': './client.cjs',
  },
  dsh: {
    bundle: {
      patch: './cordis.patch.yml',
    },
    client: {
      platform: 'web',
      inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-input-trigger', '@deepseek-ai/dsh-client-ui-settings-general'],
      immediately: false,
    },
  },
}, null, 2) + '\n')
cpSync(join(root, 'cordis.patch.yml'), join(packageRoot, 'cordis.patch.yml'), { force: true })

const clientBody = clientSource.replace(
  clientMarker,
  "return {\n  inject: ['slots', 'timer', 'sessions', 'conversation', 'remote', 'remote.session', 'connection'],\n  apply(ctx) {\n    nativeRpc = ctx.get('connection')?.rpc ?? null",
)
const clientEntry = `
const pluginId = '${packageName}'
let nativeRpc = null
const styles = {
  insert(css) {
    if (typeof document === 'undefined') return
    let element = document.querySelector(\`style[data-plugin="\${pluginId}"]\`)
    if (element === null) {
      element = document.createElement('style')
      element.dataset.plugin = pluginId
      document.head.appendChild(element)
    }
    element.textContent = String(css)
  },
}
const host = {
  async call(method, args) {
    if (nativeRpc === null) throw new Error('dsh-side-chat-dev: connection rpc is not ready')
    const result = await nativeRpc.call('/side-chat', method, args)
    if (result?.ok === true && Object.prototype.hasOwnProperty.call(result, 'value')) return result.value
    if (result?.ok === false) {
      const error = new Error(result.error?.message ?? '侧聊 Host RPC 失败')
      error.code = result.error?.code ?? 'error'
      throw error
    }
    return result
  },
}

const factory = (require) => {
const React = require('react')
const ReactDOM = require('react-dom')
${clientBody}
}

globalThis.__ModuleLoader__.load({ id: pluginId, factory })
`

const { build } = await import('esbuild')
const result = await build({
  stdin: {
    contents: clientEntry,
    resolveDir: devRoot,
    sourcefile: 'client-entry.js',
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  external: ['react'],
  write: false,
  legalComments: 'none',
  minifyWhitespace: true,
})
const clientBundle = result.outputFiles?.[0]?.text
if (typeof clientBundle !== 'string' || clientBundle.length === 0) {
  throw new Error('esbuild did not produce a client bundle')
}
writeFileSync(join(packageRoot, 'client.cjs'), clientBundle)
mkdirSync(dirname(sandboxPackageRoot), { recursive: true })
cpSync(packageRoot, sandboxPackageRoot, { recursive: true, force: true })

console.log('dsh-side-chat: local DSH package built')
console.log(`  package: ${packageRoot}`)
console.log(`  sandbox package: ${sandboxPackageRoot}`)
console.log(`  host.mjs: ${Buffer.byteLength(hostSource)} bytes`)
console.log(`  client.cjs: ${Buffer.byteLength(clientBundle)} bytes`)
