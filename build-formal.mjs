/**
 * Build the standalone, non-dynamic DSH package from the same source used by
 * the compatibility adapter. The resulting package is installed by DSH's
 * normal local plugin loader and does not require cordis_define payloads.
 */
process.env.DSH_SIDE_CHAT_PACKAGE_ID = 'dsh-side-chat'
await import('./dev/build-dev.mjs?formal')

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(root, 'dev', 'node_modules', 'dsh-side-chat')
const distRoot = join(root, 'dist')
mkdirSync(distRoot, { recursive: true })
copyFileSync(join(packageRoot, 'host.mjs'), join(distRoot, 'formal-host.mjs'))
copyFileSync(join(packageRoot, 'client.cjs'), join(distRoot, 'formal-client.cjs'))

console.log('dsh-side-chat: formal DSH package exports built')
console.log(`  host: ${join(distRoot, 'formal-host.mjs')}`)
console.log(`  client: ${join(distRoot, 'formal-client.cjs')}`)
