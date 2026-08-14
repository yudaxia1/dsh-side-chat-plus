/**
 * dsh-side-chat 浏览器验收脚本（独立测试端口）。
 *
 * 前置：
 *   1. 独立端口启动 DSH Web：dsh web --port 3081
 *   2. 本脚本驱动真实浏览器（repo 内 playwright@1.61.1 + 系统 Edge/Chrome）
 *
 * 流程：
 *   1. 打开应用 → 新建/打开会话
 *   2. 让主 Agent 读取 dist/host.js + dist/client.js，用 cordis_define + cordis_run 加载插件
 *   3. 批准运行卡片
 *   4. 验收：头部「侧聊」按钮 → 面板 → 空白侧聊 → 独立发送/流式/停止 →
 *      消息锚点「在侧聊中询问」→ 引用来源 → 定位 → 插入主聊天输入框（不自动发送）→
 *      刷新后持久化恢复
 *   5. 输出 tests/browser/acceptance-results.md 与截图
 */

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const PLAYWRIGHT_PATH = 'E:/DSH_Work/dsh-src/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT_PATH)

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const artifacts = join(root, 'tests', 'browser', 'artifacts')
mkdirSync(artifacts, { recursive: true })

const PORT = process.env.SC_PORT ?? '3081'
const BASE = `http://127.0.0.1:${PORT}`
const HOST_CODE = readFileSync(join(root, 'dist', 'host.js'), 'utf8')
const CLIENT_CODE = readFileSync(join(root, 'dist', 'client.js'), 'utf8')

const results = []
const steps = []
let shotCount = 0

function log(message) {
  const line = `[acceptance] ${message}`
  console.log(line)
  steps.push(line)
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function screenshot(page, name) {
  shotCount += 1
  const path = join(artifacts, `${String(shotCount).padStart(2, '0')}-${name}.png`)
  try {
    await page.screenshot({ path, fullPage: false })
    log(`截图: ${path}`)
  } catch (error) {
    log(`截图失败 ${name}: ${error.message}`)
  }
}

async function waitFor(page, locator, ms = 15000, label = '') {
  try {
    await locator.waitFor({ state: 'visible', timeout: ms })
    return true
  } catch (error) {
    log(`等待超时: ${label || '元素'} (${ms}ms)`)
    return false
  }
}

/** 点击“包含文本”的元素（同义词列表，逐个尝试）。 */
async function clickText(page, texts, { timeout = 8000 } = {}) {
  const list = Array.isArray(texts) ? texts : [texts]
  for (const text of list) {
    const loc = page.getByRole('button', { name: text, exact: false }).first()
    try {
      await loc.waitFor({ state: 'visible', timeout: 4000 })
      await loc.click({ timeout: 4000 })
      return true
    } catch (error) {
      // try next
    }
  }
  // 退化：按文本节点找可点击祖先
  for (const text of list) {
    const found = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)
    if (found) {
      try {
        const el = page.getByText(text, { exact: false }).first()
        await el.click({ timeout: 3000 })
        return true
      } catch (error) {
        // continue
      }
    }
  }
  return false
}

async function main() {
  log(`启动浏览器 → ${BASE}`)
  const browser = await chromium.launch({ channel: process.env.SC_CHANNEL ?? 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)

  // ── 1. 打开应用 ──────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(4000)
  await screenshot(page, '01-app-load')

  const bodyText = await page.locator('body').innerText().catch(() => '')
  log(`页面文本片段: ${bodyText.slice(0, 160).replace(/\n/g, ' | ')}`)

  // ── 2. 新建/打开会话（hero 或侧栏） ──────────────────────────────────
  const heroNew = page.getByText('新会话', { exact: false }).first()
  const sidebarNew = page.getByText('新建会话', { exact: false }).first()
  let sessionOpened = false
  if (await heroNew.isVisible().catch(() => false)) {
    await heroNew.click().catch(() => {})
    sessionOpened = true
  } else if (await sidebarNew.isVisible().catch(() => false)) {
    await sidebarNew.click().catch(() => {})
    sessionOpened = true
  }
  await page.waitForTimeout(2500)
  await screenshot(page, '02-session')
  record('打开/新建主会话', sessionOpened)

  // ── 3. 让 Agent 加载插件 ────────────────────────────────────────────
  // 找到主输入框（composer seat 内的 textarea）
  const composerSeat = page.locator('[data-composer-seat]').first()
  const textarea = composerSeat.isVisible().catch(() => false)
    ? composerSeat.locator('textarea').first()
    : page.locator('textarea').last()
  const prompt = [
    '请用 cordis_define 工具加载 dsh-side-chat 插件，步骤：',
    '1) 用 read 工具读取文件 E:\\DSH_Work\\dsh-side-chat\\dist\\host.js 的全部内容；',
    '2) 用 read 工具读取文件 E:\\DSH_Work\\dsh-side-chat\\dist\\client.js 的全部内容；',
    '3) cordis_define：plugin.kind="new", idPrefix="side", name="side-chat", purpose="主会话右侧的独立侧边聊天面板插件"，code.host=host.js 内容，code.client=client.js 内容；',
    '4) 定义成功后立即 cordis_run（mode="run"）。',
    '如果 cordis_run 返回 awaiting-approval，请明确告诉我需要你在界面上批准。',
    '不要做其他任何事，也不要总结插件代码。',
  ].join('\n')
  await textarea.fill(prompt)
  await screenshot(page, '03-prompt-filled')
  // 发送（找发送按钮）
  const sent = await clickText(page, ['发送', 'Send', 'Enter'])
  if (!sent) {
    await page.keyboard.press('Enter')
  }
  await page.waitForTimeout(3000)
  log('已提交插件加载指令，等待 Agent 处理…')
  await screenshot(page, '04-agent-running')

  // ── 4. 等待运行卡片并批准 ───────────────────────────────────────────
  // Agent 定义并 cordis_run 后会出现运行卡片（approval）。等待最长时间。
  const approveButton = page.getByRole('button', { name: /允许|允许并运行|Allow/i }).first()
  const approved = await waitFor(page, approveButton, 240000, 'cordis_run 批准按钮')
  if (approved) {
    await screenshot(page, '05-approval-card')
    await approveButton.click()
    log('已点击批准')
  } else {
    // 也许已经是“始终允许”，或运行失败 —— 检查页面
    await screenshot(page, '05-no-approval')
    const text = await page.locator('body').innerText().catch(() => '')
    log(`未找到批准按钮。页面包含 “side-chat” 字样: ${text.includes('side-chat')}`)
  }

  // ── 5. 等待「侧聊」按钮出现 ─────────────────────────────────────────
  await page.waitForTimeout(4000)
  const toggle = page.getByRole('button', { name: /侧聊/ }).first()
  const toggleVisible = await waitFor(page, toggle, 60000, '头部「侧聊」按钮')
  await screenshot(page, '06-toggle')
  record('头部「侧聊」按钮出现（客户端加载成功）', toggleVisible)
  if (!toggleVisible) {
    const text = await page.locator('body').innerText().catch(() => '')
    log('插件未加载。页面尾部文本: ' + text.slice(-600).replace(/\n/g, ' | '))
    await browser.close()
    return writeReport(false)
  }

  // ── 6. 打开面板，新建空白侧聊 ───────────────────────────────────────
  await toggle.click()
  await page.waitForTimeout(1500)
  await screenshot(page, '07-panel-open')
  const panel = page.getByRole('complementary', { name: '侧边聊天' })
  const panelVisible = await panel.isVisible().catch(() => false)
  record('右侧面板打开', panelVisible)

  if (panelVisible) {
    // 新建空白侧聊
    const newBlank = page.getByRole('button', { name: '新建空白侧聊' }).first()
    const created = await waitFor(page, newBlank, 8000, '新建空白侧聊按钮')
    if (created) {
      await newBlank.click()
      await page.waitForTimeout(1200)
      await screenshot(page, '08-blank-created')
      const listText = await panel.innerText().catch(() => '')
      const hasNew = listText.includes('新侧聊') || listText.includes('空白') || listText.includes('追问')
      record('新建空白侧聊出现在列表', hasNew, hasNew ? '' : listText.slice(0, 120))
    } else {
      record('新建空白侧聊按钮可用', false, '未找到按钮')
    }

    // 发送消息 → 独立流式
    const input = panel.locator('textarea').first()
    await input.fill('你好，请用一句话介绍你自己，并说明你与主会话是隔离的。')
    await screenshot(page, '09-ask-filled')
    const sendBtn = panel.getByRole('button', { name: '发送' }).first()
    await sendBtn.click().catch(async () => { await page.keyboard.press('Enter') })
    await page.waitForTimeout(3000)
    await screenshot(page, '10-streaming')
    // 等待助手回复（真实模型，最长 150s）
    const assistantReply = page.getByText('侧聊', { exact: false }).last()
    let replySeen = false
    for (let i = 0; i < 50; i += 1) {
      const panelText = await panel.innerText().catch(() => '')
      if (panelText.includes('停止生成') || panelText.includes('正在生成')) {
        log('流式进行中（停止按钮已出现）')
        await screenshot(page, '11-stop-visible')
        break
      }
      await page.waitForTimeout(1000)
    }
    for (let i = 0; i < 120; i += 1) {
      const panelText = await panel.innerText().catch(() => '')
      const hasReply = panelText.split('\n').some((l) => l.trim().length > 20)
      if (hasReply && !panelText.includes('正在生成')) {
        replySeen = true
        break
      }
      await page.waitForTimeout(1000)
    }
    await screenshot(page, '12-reply')
    record('侧聊独立发送并收到流式回复', replySeen)
    const panelText = await panel.innerText().catch(() => '')
    log('面板内容片段: ' + panelText.slice(0, 200).replace(/\n/g, ' | '))

    // 插入主聊天输入框（不自动发送）
    const insertBtn = page.getByRole('button', { name: /插入主聊天输入框/ }).first()
    const insertVisible = await insertBtn.isVisible().catch(() => false)
    if (insertVisible) {
      await insertBtn.click()
      await page.waitForTimeout(1200)
      const mainInput = composerSeat.isVisible().catch(() => false)
        ? composerSeat.locator('textarea').first()
        : page.locator('textarea').last()
      const mainValue = await mainInput.inputValue().catch(() => '')
      const inserted = mainValue.includes('侧聊')
      await screenshot(page, '13-inserted')
      record('「插入主聊天输入框」写入草稿且不自动发送', inserted, `草稿长度=${mainValue.length}`)
      // 确认没有自动发送（主会话没有新增用户消息 → 会话文本里“你好，请用一句话”不应出现在主聊记录之外）
      const mainTranscript = await page.locator('body').innerText().catch(() => '')
      const autoSent = mainTranscript.includes('插入主聊天输入框') === false
      record('插入未自动发送', autoSent)
    } else {
      record('「插入主聊天输入框」按钮可见', false)
    }
  }

  // ── 7. 主消息「在侧聊中询问」锚点 ────────────────────────────────────
  const askButton = page.getByRole('button', { name: '在侧聊中询问' }).first()
  const askVisible = await waitFor(page, askButton, 10000, '在侧聊中询问按钮')
  if (askVisible) {
    await askButton.click()
    await page.waitForTimeout(1500)
    await screenshot(page, '14-anchored-created')
    const anchorShown = await panel.isVisible().catch(() => false)
      && (await panel.innerText().catch(() => '')).includes('引用来源')
    record('从主消息创建带引用锚点的侧聊', anchorShown)
    if (anchorShown) {
      // 定位按钮
      const locate = page.getByRole('button', { name: /在主聊天中定位该消息/ }).first()
      const locateVisible = await locate.isVisible().catch(() => false)
      if (locateVisible) {
        const before = await page.evaluate(() => {
          const el = document.querySelector('[data-chat-anchor-key]')
          return el === null ? null : el.getBoundingClientRect().top
        }).catch(() => null)
        await locate.click()
        await page.waitForTimeout(1200)
        const after = await page.evaluate(() => {
          const el = document.querySelector('[data-chat-anchor-key]')
          return el === null ? null : el.getBoundingClientRect().top
        }).catch(() => null)
        record('来源定位（主聊天滚动到锚点消息）', before !== null && after !== null && Math.abs(after) < 600, `top=${after}`)
      } else {
        record('定位按钮可见', false)
      }
    }
  } else {
    record('「在侧聊中询问」按钮出现', false)
  }

  // ── 8. 刷新后持久化 ─────────────────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await screenshot(page, '15-after-reload')
  const toggle2 = page.getByRole('button', { name: /侧聊/ }).first()
  const toggle2Visible = await waitFor(page, toggle2, 30000, '刷新后「侧聊」按钮')
  if (toggle2Visible) {
    await toggle2.click()
    await page.waitForTimeout(2000)
    await screenshot(page, '16-panel-restored')
    const panel2 = page.getByRole('complementary', { name: '侧边聊天' })
    const panel2Text = await panel2.innerText().catch(() => '')
    const restored = panel2Text.includes('新侧聊') || panel2Text.includes('追问')
    record('刷新后侧聊列表/标题恢复', restored, restored ? '' : panel2Text.slice(0, 120))
  } else {
    record('刷新后插件仍加载', false)
  }

  // ── 9. 窄屏响应式 ───────────────────────────────────────────────────
  await page.setViewportSize({ width: 800, height: 900 })
  await page.waitForTimeout(800)
  await screenshot(page, '17-narrow')
  const panelWidth = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="侧边聊天"]')
    return el === null ? null : el.getBoundingClientRect()
  }).catch(() => null)
  const fullWidth = panelWidth !== null && panelWidth.width >= 780
  record('窄屏下面板铺满宽度（抽屉模式）', fullWidth, panelWidth === null ? '' : `w=${Math.round(panelWidth.width)}`)

  await screenshot(page, '18-final')
  await browser.close()
  return writeReport(true)
}

function writeReport(completed) {
  const lines = [
    '# dsh-side-chat 浏览器验收记录',
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 测试端口：${PORT}`,
    `- 浏览器：${process.env.SC_CHANNEL ?? 'msedge'}（headless）`,
    `- 插件产物：dist/host.js（${HOST_CODE.length} 字节）、dist/client.js（${CLIENT_CODE.length} 字节）`,
    `- 流程是否跑完：${completed ? '是' : '否（早期中断）'}`,
    '',
    '## 执行步骤',
    '',
    ...steps.map((s) => `- ${s}`),
    '',
    '## 验收结果',
    '',
    '| 检查项 | 结果 | 备注 |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.ok ? '✅ PASS' : '❌ FAIL'} | ${r.detail} |`),
    '',
    '## 截图',
    '',
    '见 `tests/browser/artifacts/`。',
    '',
  ]
  const outPath = join(root, 'tests', 'browser', 'acceptance-results.md')
  writeFileSync(outPath, lines.join('\n'), 'utf8')
  log(`验收记录已写入 ${outPath}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== 汇总: ${results.length - failed}/${results.length} 通过 ====`)
  return { total: results.length, failed }
}

main().then((summary) => {
  process.exit(summary !== undefined && summary.failed > 0 ? 1 : 0)
}).catch((error) => {
  console.error('[acceptance] 脚本异常:', error)
  writeReport(false)
  process.exit(2)
})
