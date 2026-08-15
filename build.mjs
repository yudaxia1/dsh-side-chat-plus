/**
 * dsh-side-chat 构建：把 src/core.mjs 内联进 host 模板，产出 dist/host.js 与 dist/client.js。
 *
 * 为什么内联：code.host 运行在动态插件 vm 沙箱里，require 被禁用，无法在运行时 import
 * core.mjs；而核心逻辑又要能被 node:test 直接测试，所以构建期把（去掉 export 的）核心
 * 源码注入到宿主模板，测试则直接 import src/core.mjs。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

const coreSource = readFileSync(join(root, 'src', 'core.mjs'), 'utf8')
  // The source module ends with a named export block.  Removing only the
  // `export` keyword would leave a comma-separated block statement in the
  // dynamic host and produce an invalid dist/host.js.
  .replace(/\nexport \{[\s\S]*\}\s*$/, '\n')
const hostTemplate = readFileSync(join(root, 'src', 'host.template.js'), 'utf8')
const clientSource = readFileSync(join(root, 'src', 'client.js'), 'utf8')

if (!hostTemplate.includes('/*__CORE_SOURCE__*/')) {
  throw new Error('host.template.js 缺少 /*__CORE_SOURCE__*/ 占位符')
}

const hostOutput = hostTemplate.replace('/*__CORE_SOURCE__*/', coreSource)
writeFileSync(join(dist, 'host.js'), hostOutput)
writeFileSync(join(dist, 'client.js'), clientSource)

console.log('dsh-side-chat: 构建完成')
console.log(`  dist/host.js   ${hostOutput.length} 字节`)
console.log(`  dist/client.js ${clientSource.length} 字节`)

await import('./build-formal.mjs')
