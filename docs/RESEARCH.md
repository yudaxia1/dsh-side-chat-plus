# 调研记录：DSH 公开扩展接口与缺口分析

> 对应目标文档《技术实施边界》第 1、5 条：先检测、不假设；公开接口不足时记录缺口、
> 最小上游改动方案与临时降级实现。

## 1. 环境事实（以运行中的 Harness 为准）

- DSH 版本：`@deepseek-ai/dsh@0.1.0-rc.6`（npm npx 缓存）；
  源码检出 `E:\DSH_Work\dsh-src\deepseek-harness`（分支 `feat/goal-mode`）。
- Web Profile：`C:\Users\cxl\.dsh\profiles\web`（`cordis.yml` 为空，全部由 bundle 层组合）。
- 持久化后端：web-app bundle 挂载 `storage-json`（`root: dshHomePath('storages')`）+
  `storage-domain`（`backend: json`）→ 落盘目录 `C:\Users\cxl\.dsh\storages\`。

## 2. 采用的公开接口（均来自运行时 Inspect Provider 与源码验证）

| 能力 | 接口 | 证据 |
|---|---|---|
| 独立模型流 | `ctx.llm.stream(GenerateOptions)`（Host Service `llm`） | Service catalog；DeepSeek 适配器只读 `role/content`，可手构消息 |
| KV 持久化 | `ctx.storageDomain.open(spec)` → `Domain.table('chats')` | storage-domain 源码；web profile 已挂载 |
| 会话日志读取 | `ctx.sessionQuery.readSession(sessionId)` → `{ session, events }` | session-query 源码；goal-mode 插件同款用法 |
| 默认模型兜底 | `ctx.agentDefaultModel.currentSelection()` → `{ provider, model, reasoningEffort? }` | core/agent model-selection 源码 |
| 客户端 slot | `slots.inject(name, () => slots.register({name,id,order,label}, Component))` | ui-goal-mode 参考实现 |
| 回传输入框 | 会话标准 kit `props.inputActions.setDraft(text)` | ui-conversation input/contract.ts |
| 消息级动作 | `conversation.chat.assistant-actions` owner `{ messageId }` | ui-conversation contract/slots.ts |
| DOM 定位 | `data-chat-anchor-key` 属性（node key） | ui-conversation ChatNodeSeat.tsx |
| 动态宿主 RPC | `harness.handle(method, handler)` / 客户端 `host.call` | cordis-host-runner / cordis-client-runner |
| 当前会话 id | 根作用域 `props.useSessions(s => s.current)` | runtime sessions/service.ts |

## 3. 约束与临时降级实现（重要）

### 3.1 沙箱禁 `require` → 无法 import zod

动态宿主半边运行在 `node:vm` 新 realm，`require` 被陷阱禁用（含 `setTimeout/fetch/process/Buffer`）。
`storageDomain.open()` 的 spec 需要 zod `valueSchema`。**临时降级**：传入结构性透传 schema
（`{ parse: v => v, safeParse: v => ({ success: true, data: v }) }`）；storage-domain 只在装载
边界调用 `schema.parse(raw)`，透传即保留原样（记录由插件自身构造，天然是合法 JSON）。
- **最小上游改动**：`storage-domain` 增加一个“接受原始 JSON 记录”的免 schema 表声明，
  或允许在沙箱宿主中注入 zod（如通过 `harness` extras 暴露 `z`）。

### 3.2 自定义事件进主会话日志会被持久化读取端拒绝

`Session.append(type, data)` 生成的信封**无法设置 `ignorable`**，而持久化读取端对
`KNOWN_SESSION_EVENT_TYPES` 之外的 event type 会**拒绝重建整个会话**，除非事件携带
`ignorable: true`（core/session known-event-types.ts）。因此侧聊数据**不能**以自定义事件
写入主会话日志（goal-mode 之所以能读 `goal/change`，是因为它是仓库内已登记的类型）。
→ 采用 `storageDomain` KV 表持久化（见 3.1），绕开日志信封限制。
- **最小上游改动**：为公开插件提供“可安全追加的 ignorable 自定义事件”注册面
  （`registerIgnorableEventType(name)` 或 `append` 增加 `ignorable` 选项）。

### 3.3 沙箱无 `AbortController`，适配器用 `AbortSignal.any`

DeepSeek 适配器 `AbortSignal.any([options.signal, consumer.signal])` 需要**真实** AbortSignal，
鸭子类型信号会被拒绝。**临时降级**：取消走 `iterator.return()` 级联（见 ARCHITECTURE §4.1）。
- **最小上游改动**：沙箱暴露 `AbortController`（作为 harness 内置符号），
  或 `llm.stream` 接受“取消回调/AbortSignal 工厂”参数。

### 3.4 无 Host→Client 推送通道 → 流式用轮询

包私有 RPC 方向为 Client→Host 请求/响应。**临时降级**：~400ms 轮询 `sideChat.poll`
（带 seq/textRev 双游标，见 ARCHITECTURE §4.2）。
- **最小上游改动**：增加包私有事件通道（如 `harness.publish(method, payload)` +
  客户端 `host.on(method, listener)`），或复用现有 SSE 帧通道推送增量。

### 3.5 根作用域面板拿不到会话标准 kit

`shell.overlay` 是根作用域，只有 `useSessions/useWorkspaces`；`inputActions` 只在会话作用域
组件上。**临时降级**：回传通过“共享 store → header 按钮（会话作用域）消费 pendingInsert →
`inputActions.setDraft`”的桥接完成；`useSession` 快照在事件处理器里经
`ctx.get('sessions').binding(id).session.getSnapshot()` 读取。

### 3.6 工具结果/文件引用锚点

`conversation.chat.assistant-actions` 只覆盖“已完结的助手消息”。工具结果、用户消息、文件
引用的**逐条**入口需要新增 slot 或覆盖 `conversation.chat.node` 渲染器（仓库内节点 key 表
固定，插件不能加新 kind）。**当前降级**：面板内“引用最近消息”弹层（`sideChat.recent`）
覆盖用户/助手消息；工具结果与文件引用锚点列入后续清单。

## 4. 复现步骤（约束复现）

1. 沙箱禁 require：在任意会话用 `cordis_define` 提交含 `require('zod')` 的 `code.host`，
   运行后宿主报 `require is not available in the dynamic package sandbox`。
2. 自定义事件：`code.host` 里 `session.append('my/event', {...})` 后重启 DSH 并打开该会话，
   持久化读取端拒绝重建（该事件不在 KNOWN_SESSION_EVENT_TYPES 且无 ignorable）。
3. 无 AbortController：`vm.runInContext('typeof AbortController', ctx)` → `'undefined'`；
   向 `llm.stream` 传假 signal 时适配器抛 `AbortSignal.any` 类型错误。

## 5. 后续实施清单（非阻塞项）

- 工具结果/文件引用锚点入口（需上游 slot 或渲染器覆盖方案）。
- 侧聊内允许“读工作区文件”的受控工具（仅只读工具，仍需上游工具作用域支持）。
- 由轮询升级为推送（等 3.4 的上游通道）。
- 侧聊记录的增量 delta 事件以控制日志体积（当前整记录快照写，见 todo/write 同款模式）。
- 主会话被删除后侧聊的“孤儿/归档”标记与清理 UI（数据模型已含 parentSessionId 与
  `parentExists` 检测，UI 提示待补）。
