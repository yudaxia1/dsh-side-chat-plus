# dsh-side-chat — 交接报告

> 交接日期：2026-08-14（北京时间）
> 交接人：DeepSeek Harness agent（goal: `dsh-side-chat` 插件实现，round 5）
> 目标原文见会话 Goal；本报告只陈述事实与可复现步骤。
> **本版为最终合并版**：合并了初版交接报告与后续进展（动态插件已在本会话加载并修复渲染崩溃）。

---

## 0. 最新进展（2026-08-14 更新，请优先阅读）

### 0.1 本轮完善（UI 与流式体验）

在用户手动验收前又做了一轮对齐 Codex 侧聊习惯的修订：

- 修复宿主 `sideChat.poll` 漏传 `sinceTextRev` 的问题，流式轮询不再重复返回已消费的整段文本；
- 生成中与停止中保持输入锁定，停止流程会继续轮询直到落到 `stopped`；
- 面板增加底部跟随（用户上翻时不强行抢焦点）、自适应 composer、消息复制、首条提问自动命名、
  关闭后的焦点恢复、按钮语义与 ARIA 状态、窄屏动画与更清晰的消息气泡层级；
- 核心与集成测试新增对应覆盖；当前自动化总数为 **44/44**（核心 32 + 集成 9 + 冒烟 3）。

按用户指示做了两件事，状态从初版报告变化如下：

1. **动态插件已在本会话加载并运行成功**（用户要求先试动态版，暂不做正式 profile 安装）：
   - `cordis_define` 定义插件 `side-1`（`idPrefix=side`），含宿主+客户端两侧；
   - 首次运行（pkg-1）客户端在 `shell.overlay` 渲染崩溃：**React 错误 #310**（钩子数量不一致）——
     `SideChatPanel` 里「记忆面板宽度」的 `useEffect` 放在 `if (!ui.open) return null` 早退之后，
     开合面板时钩子数变化；
   - 已修复（源码 `src/client.js`：把该 useEffect 移到早退 return 之前并删除底部旧副本），
     追加定义 **pkg-2** 并 `cordis_run update` 切换 → **state: running**，渲染正常；
   - 运行状态确认：`side-1/pkg-2`（currentPackageId=pkg-2），用户在界面上批准过授权；
   - 持久化已生效：`C:\Users\cxl\.dsh\storages\side_chat.json`（storage domain 已创建）。

2. **浏览器验收不再由自动化完成**（用户明确说“不用浏览器验收，我自己验收”）：
   - `tests/browser/acceptance.mjs` 保留作为工具，但**不再作为完成条件**；
   - 用户将在本会话页面手动验收（头部「侧聊」按钮、面板、锚点、流式、插入/总结、刷新恢复等）。

**当前插件运行位置**：本会话（side-1/pkg-2）动态运行；页面刷新后需要重新 `cordis_run`
（宿主进程保留定义，浏览器半边按设计需要重新激活——见 INSTALL.md 注意事项）。

---

## 1. 一句话状态

**插件已完整实现并通过全部自动化测试（44/44），文档齐全；动态版已在本会话加载并正常运行
（side-1/pkg-2）。浏览器自动化验收经用户要求取消（用户自行验收）；正式安装到 Web Profile
仍待用户决定。**

---

## 2. 已完成的工作

### 2.1 交付物（全部位于 `E:\DSH_Work\dsh-side-chat\`）

| 文件 | 说明 |
|---|---|
| `src/core.mjs` | 纯宿主核心（无沙箱全局依赖，node:test 可直测）：数据模型、锚点/相邻上下文/最近消息提取、模型配置解析、系统提示、流式状态机、`textRev` 增量游标、`iterator.return()` 取消 |
| `src/host.template.js` | code.host 模板（vm 沙箱内运行）：`harness.handle('sideChat.*')` RPC、storageDomain 持久化（含 `already-open` 多实例共享回退）、`llm.stream` 接线、`ctx.effect` 卸载中止 |
| `src/client.js` | code.client（浏览器半边）：三处 slot（`conversation.session.header.actions` 开关+回传桥接 / `conversation.chat.assistant-actions` 消息锚点 / `shell.overlay` 面板）、共享 store、~400ms 流式轮询、多侧聊切换/重命名/删除/定位、自动滚底、复制、响应式、键盘与 ARIA |
| `build.mjs` | 构建：把 core.mjs（去 `export`）内联进 host 模板 → `dist/host.js`、`dist/client.js` |
| `dist/host.js`（35.9KB）、`dist/client.js`（53.9KB） | 最终加载产物（动态插件 code.host / code.client）；client 含本轮 UI 完善与钩子顺序修复 |
| `tests/core.test.mjs` | **32 项**单元测试（纯函数 + 核心工厂，含模拟重启持久化、跨会话隔离、独立双流、stop、summarize、自动标题） |
| `tests/integration.test.mjs` | **9 项**集成测试（vm 求值真实 `dist/host.js` → `apply(fakeCtx)` → 走全部 `harness.handle` RPC：创建/锚点/发送/流式/停止/隔离/摘要/游标/多实例共享 domain） |
| `tests/smoke.test.mjs` | **3 项**冒烟（宿主与客户端都在对应沙箱形态下能求值出合法插件） |
| `tests/browser/acceptance.mjs` | 真实浏览器验收脚本（playwright，独立端口）——**未跑完**（见 §3） |
| `docs/ARCHITECTURE.md` | 架构说明（接口选择表、数据模型、运行架构、取消机制、安全边界） |
| `docs/RESEARCH.md` | 调研记录（采用接口证据 + 4 项约束的缺口分析/上游最小改动/降级实现/复现步骤 + 后续清单） |
| `README.md` / `INSTALL.md` / `package.json` | 产品说明 / 两种加载方式（agent 加载或手动 cordis_define）/ 元数据 |

### 2.2 测试证据（刚刚复跑确认）

```
node tests/core.test.mjs      → pass 32, fail 0
node tests/integration.test.mjs → pass 9,  fail 0
node tests/smoke.test.mjs     → pass 3,  fail 0
node build.mjs                → 构建成功
```

### 2.3 调研结论（关键）

- DSH 版本 `@deepseek-ai/dsh@0.1.0-rc.6`；源码检出 `E:\DSH_Work\dsh-src\deepseek-harness`（分支 feat/goal-mode，仅作 API 参考，**未修改**）。
- Web Profile：`C:\Users\cxl\.dsh\profiles\web`；持久化后端 storage-json → `C:\Users\cxl\.dsh\storages\`。
- 采用的公开接口：`llm.stream`、`storageDomain.open`（KV 表）、`sessionQuery.readSession`、`agentDefaultModel.currentSelection`、`slots.inject/register`、`inputActions.setDraft`、`conversation.chat.assistant-actions`、`shell.overlay`、`harness.handle/host.call`、`useSessions(s=>s.current)`。

---

## 3. 未完成的工作（更新后）

### 3.1 浏览器自动化验收（目标 #12 —— 已按用户要求取消自动化，改由用户手动验收）

`tests/browser/acceptance.mjs` 与截图（`tests/browser/artifacts/`）保留；用户明确表示
“不用浏览器验收，我自己验收”，因此**自动化浏览器验收不再作为完成条件**。
历史记录（供参考，勿删）：曾两次尝试（沙箱 EPERM；授权后走到等待批准卡片 240s 未出现、
随后轮次中断），测试服务器端口 3081 已随会话结束退出。

### 3.2 安装征询（目标技术边界 #7，待用户决定）

用户当前选择**先试动态版**（已在运行）。正式安装到 Web Profile（bundle 形式）仍待用户决定；
若用户要求，走 `dsh plugin` 安装流程（见 README「后续清单」与 `dsh plugin` 命令说明），
或继续用动态加载方式（INSTALL.md）。

### 3.3 目标验收标准逐条对照（更新后）

| # | 标准 | 状态 |
|---|---|---|
| 1 | 从主聊天创建空白侧聊 | 核心+集成测试 ✅；本会话动态运行中，待用户手动验证 |
| 2 | 从消息/选中文字创建带锚点的侧聊 | 核心+集成测试 ✅；待用户手动验证 |
| 3 | 主 Agent 生成时侧聊仍可独立收发/停止 | 集成测试（双独立流+stop）✅；待用户手动验证 |
| 4 | 侧聊消息不自动进主聊天 | 架构保证（独立 storage domain，不进主会话日志）+ 集成测试 ✅ |
| 5 | 只有显式“插入/总结”才回传且默认不自动发送 | 代码保证（`inputActions.setDraft` 只写草稿）；待用户手动验证 |
| 6 | 刷新/重开/重启后恢复 | 核心测试“同一 domain 重建核心”模拟重启 ✅ + 运行时 `side_chat.json` 已落盘；刷新恢复待用户手动验证 |
| 7 | 多主会话数据不串线 | 集成测试 cross-session ✅ |
| 8 | 关闭一个侧聊不影响其他 | 核心测试（删除独立）+ 双流独立 ✅ |
| 9 | 宽屏/窄屏可用 | 代码含媒体查询；待用户手动验证 |
| 10 | 构建/加载/卸载不影响原生聊天 | 冒烟测试 ✅；动态插件已加载/更新成功（pkg-1→pkg-2），卸载不影响原生 UI（slot 追加型） |
| 11 | 自动化测试覆盖隔离/持久化/引用/停止/回传 | ✅ 已完成 |
| 12 | 独立测试端口真实浏览器验证并记录 | ⏭ 已按用户要求取消自动化，改由用户手动验收 |

---

## 4. 困难、阻碍、难以实现的点（重点交接）

1. **宿主沙箱禁 `require`**：动态宿主运行在 `node:vm` 新 realm，`require/setTimeout/fetch/process/Buffer`
   全部被陷阱禁用。→ 无法 import zod。**降级**：`storageDomain.open` 的 spec 用结构性透传
   schema（`{parse:v=>v, safeParse:v=>({success:true,data:v})}`），storage-domain 只在装载边界
   调 `schema.parse(raw)`，记录由插件自身构造所以天然合法。**上游最小改动**：storage-domain 增加
   免 schema 声明，或沙箱暴露 zod。

2. **自定义事件进主会话日志会被持久化读取端拒绝**：`Session.append()` 无法设置信封级
   `ignorable:true`，而 `KNOWN_SESSION_EVENT_TYPES` 之外的事件会让整个会话在重启后无法重建。
   → 侧聊数据**不能**写主会话日志（goal-mode 之所以能读 `goal/change` 是因为它是仓库内已登记类型）。
   **降级**：改用 storageDomain KV 表。**上游最小改动**：为公开插件提供 ignorable 自定义事件注册面。

3. **沙箱无 `AbortController`，DeepSeek 适配器用 `AbortSignal.any([...])`**：鸭子类型信号会被
   类型检查拒绝（`AbortSignal.any` 要求真实实例）。**降级**：取消走 `llm.stream()` 迭代器的
   `iterator.return()`，级联关闭生成器链最终触发适配器 finally 的 `consumer.abort()` 取消 fetch。
   核心/集成测试已验证该取消路径。**上游最小改动**：沙箱暴露 AbortController。

4. **无 Host→Client 推送通道**：包私有 RPC 是 Client→Host 请求/响应。**降级**：~400ms 轮询
   `sideChat.poll`，带双游标（`sinceSeq` 新消息 + `sinceTextRev` 同消息文本修订，客户端按 id 合并）。
   **上游最小改动**：包私有事件通道（`harness.publish` / `host.on`）。

5. **根作用域面板拿不到会话标准 kit**：`shell.overlay` 只有 `useSessions/useWorkspaces`；
   `inputActions` 只在会话作用域组件。**降级**：回传用“共享 store pendingInsert → header 按钮
   （会话作用域）→ `inputActions.setDraft`”桥接；面板内读会话快照在事件处理器里经
   `ctx.get('sessions').binding(id).session.getSnapshot()`。

6. **工具结果/文件引用逐条锚点无公开 slot**：`conversation.chat.assistant-actions` 只覆盖已完结
   助手消息；`conversation.chat.node` 的 key 表是仓库固定的，插件不能加新 kind。**降级**：面板内
   “引用最近消息”弹层覆盖用户/助手消息。**后续清单**：工具结果/文件引用锚点。

7. **本机测试环境限制**：
   - `node --test` 在受限沙箱下 spawn 子进程报 `EPERM`（管道限制）→ 测试改为
     `node tests/xxx.test.mjs` 进程内直跑（package.json 的 test/check 已适配）。
   - `dsh web` 启动需写 profile 的 `cordis.yml`（组合动作，内容不变）→ 受沙箱拦截，
     **需 danger-full-access 授权**；浏览器拉起（playwright spawn Edge + CDP 管道）同样需授权。
   - `npx` 安装 playwright-cli 被沙箱拦（网络/缓存写）→ 直接用 repo 内
     `node_modules/.pnpm/playwright@1.61.1` + 系统 Edge（`channel:'msedge'`）。
   - 当前模型（deepseek-v4-flash）不支持读图，验收截图需人工/换模型查看。

8. **动态客户端钩子顺序崩溃（React #310）—— 已修复**：`shell.overlay` 组件里有一个
   `useEffect` 放在 `if (!ui.open) return null` 早退之后，开/合面板时 React 钩子数量不一致，
   渲染即崩（`Minified React error #310: Rendered fewer hooks than expected`）。
   **规则**：动态客户端组件的所有 hooks（useState/useRef/useEffect/useSessions/useInput…）
   必须全部位于任何条件早退 `return` 之前；`useInput` 等选择器钩子也要无条件调用
   （会话作用域 slot 的标准 kit 恒提供）。修复已落入 `src/client.js`（宽度记忆 useEffect
   上移）并随 pkg-2 生效。

---

## 5. 交接人如何继续（可复现步骤）

### 5.1 先跑通自动化（应全绿）

```powershell
cd E:\DSH_Work\dsh-side-chat
node build.mjs
node tests/core.test.mjs
node tests/integration.test.mjs
node tests/smoke.test.mjs
```

### 5.2 浏览器验收（需要完整访问授权）

```powershell
# 1) 独立端口起测试服务器（需授权；会重写同内容 cordis.yml + 绑定 3081）
& "C:\Users\cxl\AppData\Local\npm-cache\_npx\6c7f445d1bf61956\node_modules\.bin\dsh.cmd" web --host 127.0.0.1 --port 3081
# 验证：Invoke-WebRequest http://127.0.0.1:3081 应返回含 __DSH_BOOT__ 的 HTML

# 2) 跑验收脚本（需授权；spawn Edge）
node tests/browser/acceptance.mjs
# 结果写入 tests/browser/acceptance-results.md，截图在 tests/browser/artifacts/
```

**已知坑**：
- 脚本第 2 步“让 Agent 加载插件”依赖真实模型轮次；若 Agent 未处理完，批准卡片不会出现。
  建议先人工在测试服务器里发一条简单消息确认 Agent 能回复，再跑脚本。
- 发送按钮匹配文本「发送/Send/Enter」，失败会退化为键盘 Enter——若 composer 需要特定手势，
  需按新 UI snapshot 修正脚本。
- 每次跑脚本会往测试会话追加一条“加载插件”指令；如需干净重跑，新建会话或换端口。
- 浏览器 headless 用系统 Edge（`SC_CHANNEL=msedge`）；要换 Chrome 设 `SC_CHANNEL=chrome`。

### 5.3 后续步骤（截至本版的状态）

1. **插件已在运行**：本会话 `side-1/pkg-2`（dynamic）。用户正在手动验收。
   - 若页面刷新导致浏览器半边消失：在会话里让 agent 对同一个 pluginId 再
     `cordis_run`（宿主进程仍保留定义与授权；`currentPackageId` 仍为 pkg-2）。
   - 新会话要用：把 `dist/host.js`/`dist/client.js` 交给该会话 agent 重新
     `cordis_define`（idPrefix 任意）+ `cordis_run`（见 INSTALL.md 方式 A）。
2. **浏览器自动化验收已取消**（用户要求手动验收）；如需补跑，见 §5.2（需完整访问授权）。
3. **正式安装到 Web Profile**：等用户决定。两种形态：
   - 动态加载（现状）；
   - profile bundle（`dsh.plugin.json` + `cordis.patch.yml` + ModuleLoader 包裹的
     client bundle，参考 `dsh-goal-mode-plugin` 的 build 产物形态），经 `dsh plugin` 安装。
4. 用户验收通过、并确认安装形态后，再把 Goal 标记为 complete（目标要求全部交付物齐备：
   代码 + 架构说明 + 使用说明 + 测试；浏览器验收已按用户指示改由用户手动完成）。

### 5.4 可选改进（见 docs/RESEARCH.md §5）

- 工具结果/文件引用锚点入口；侧聊只读工具；轮询→推送；记录增量事件；孤儿侧聊 UI 提示。

---

## 6. 环境事实速查

- 工作区根：`E:\DSH_Work`；插件工程：`E:\DSH_Work\dsh-side-chat`。
- 源码检出（只读参考，勿改）：`E:\DSH_Work\dsh-src\deepseek-harness`（branch feat/goal-mode）。
- DSH 命令：`C:\Users\cxl\AppData\Local\npm-cache\_npx\6c7f445d1bf61956\node_modules\.bin\dsh.cmd`
  （版本 0.1.0-rc.6）。
- 运行中的 Web GUI：http://127.0.0.1:3080（**不要动**）；测试端口用 3081。
- 持久化：`C:\Users\cxl\.dsh\storages\side_chat.json`（插件数据；现有文件见 storages/）。
- 会话日志：`C:\Users\cxl\.dsh\sessions\**\session.jsonl.zstd`（zstd，可用 Node 24 `node:zlib`
  的 `zstdDecompressSync` 解码，已验证）。
- 参考实现（同形态动态插件）：`E:\DSH_Work\dsh-goal-mode\{host.js,client.js,INSTALL.md}`。
