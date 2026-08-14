# dsh-side-chat 架构说明

> 阶段产物：第一阶段（调研）输出的架构说明。对应目标文档《实施顺序》第 1 条。

## 1. 目标与定位

`dsh-side-chat` 是 DeepSeek Harness Web 的可独立加载动态 Cordis 插件，在主会话右侧提供
一个**独立的侧边聊天空间**：

- 主聊天与侧聊同时显示、同时工作；侧聊拥有独立的消息记录、流式生成状态与取消操作。
- 侧聊消息绝不写入主会话记录；只有用户显式点击「插入主聊天输入框 / 总结到主聊天」才回传。
- 侧聊是主会话的**子会话**（数据模型携带 `parentSessionId`），但**运行层面完全独立**：
  每次侧聊发送走一条独立的 `ctx.llm.stream()` 调用，与主 Agent 循环互不干扰。

## 2. 关键接口调研结论（DSH 版本：@deepseek-ai/dsh 0.1.0-rc.6，源码分支 feat/goal-mode）

| 需求 | 采用的公开接口 | 说明 |
|---|---|---|
| 独立模型调用 | `ctx.get('llm').stream(GenerateOptions)` | 宿主侧直连模型流，与主会话无关；可对任意 provider/model 调用 |
| 独立持久化 | `ctx.get('storageDomain').open({...})` → `table('chats')` KV | 落盘 `~/.dsh/storages/side_chat.json`（web profile 已挂载 storage-json），跨页面刷新与 DSH 重启存活 |
| 读取主会话（锚点/相邻上下文/模型配置） | `ctx.get('sessionQuery').readSession(sessionId)` | 返回完整事件日志；锚点只取“最小必要快照”（单条消息 + 相邻用户提问） |
| 模型配置继承 | 日志内最后一个 `request/header` 的 `config.provider/model`，兜底 `agentDefaultModel.currentSelection()` | 侧聊与主会话使用同一模型 |
| 客户端 UI 落点 | `conversation.session.header.actions`（开关按钮）、`conversation.chat.assistant-actions`（每助手消息「在侧聊中询问」）、`shell.overlay`（右侧面板，根作用域、点击穿透默认关闭） | 全部是**追加型** slot，不替换任何内置 UI |
| 回传主聊天输入框 | `props.inputActions.setDraft(text)`（会话标准 kit） | 只写草稿、不自动发送 |
| 来源定位 | 锚点携带 `nodeKey`（`assistant-step:<turn>:<step>` / `input-message:<messageId>`），客户端 `querySelector('[data-chat-anchor-key=…]').scrollIntoView()` | 聊天节点渲染器自带 `data-chat-anchor-key` 属性 |
| 独立取消 | 对 `llm.stream()` 返回的迭代器调用 `iterator.return()` | 见 §4 取消机制 |

## 3. 数据模型

```ts
interface SideChat {
  sideChatId: string          // sc_<随机>
  parentSessionId: string     // 主会话 id（隔离键）
  title: string
  anchorType: 'blank' | 'message' | 'selection'
  anchorId: string | null     // 锚点消息 id（blank 为 null）
  anchorSnapshot: {           // 最小必要快照（不含整段主会话）
    sourceLabel: string
    messageId?: string
    role?: 'user' | 'assistant'
    seq?: number
    time?: number
    nodeKey?: string          // 主聊天 DOM 定位键
    text: string              // 截断到 4000 字符
    adjacent?: { text: string; seq: number }  // 助手消息锚点附带的“前面那条用户提问”
  } | null
  createdAt: number
  updatedAt: number
  status: 'idle' | 'streaming' | 'stopped' | 'error'
  error?: string
  messages: { id, role: 'user'|'assistant', text, time, seq }[]
  textRev?: number            // 流式期间文本修订号（增量拉取用）
}
```

## 4. 运行架构

```
┌─ 浏览器（code.client）────────────────────────────────────────────┐
│ shell.overlay 面板（根作用域）                                      │
│   ├─ 列表/消息/状态 ← host.call('sideChat.list|poll|send|stop|…')  │
│   ├─ 流式期间 ~400ms 轮询 sideChat.poll(sinceSeq, sinceTextRev)    │
│   └─ 共享 store（模块级 observable）                                │
│ conversation.session.header.actions「侧聊」按钮                     │
│   └─ 消费 store.pendingInsert → inputActions.setDraft(text)（回传） │
│ conversation.chat.assistant-actions「在侧聊中询问」                 │
│   └─ 读 window.getSelection() 区分“选中文字/整条消息” → create      │
└──────────────┬─────────────────────────────────────────────────────┘
               │ host.call（包私有 RPC，仅 JSON）
┌──────────────┴─────────────────────────────────────────────────────┐
│ 宿主进程（code.host，vm 沙箱）                                      │
│ harness.handle('sideChat.*') → createSideChatCore(deps)            │
│   ├─ storageDomain table('chats')：持久化（唯一事实源）             │
│   ├─ sessionQuery：锚点/相邻上下文/最近消息/模型配置                 │
│   └─ llm.stream()：每侧聊独立流（fire-and-forget）+ 运行句柄 Map    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.1 取消机制（重要约束）

动态宿主沙箱（`node:vm` 新 realm）**没有 `AbortController` 全局**，而 DeepSeek 适配器内部
使用 `AbortSignal.any([options.signal, …])`，鸭子类型的假信号会被拒绝。因此本插件的
「停止生成」不依赖 AbortSignal，而是对 `llm.stream()` 返回的**异步迭代器**调用
`iterator.return()`：该调用沿生成器链级联（llm runtime → 适配器生成器 → 适配器 finally
的 `consumer.abort()`），最终取消底层 fetch。侧聊句柄记录 `{ stopped, iterator }`，
stop/删除/卸载时统一 `abortRun()`。

### 4.2 流式增量拉取

RPC 是 Client→Host 请求/响应，没有反向推送通道，因此流式期间客户端以 ~400ms 轮询。
同一助手消息是“只增不改”的（seq 不变），所以 poll 携带两个游标：

- `sinceSeq`：只取 seq 更大的**新**消息；
- `sinceTextRev`：修订号变化时把**当前最后一条非空助手消息**整体带回，客户端按 id 覆盖。

流式期间持久化节流为 2s 一次，终态（idle/stopped/error）必落盘。

## 5. 安全与权限边界（MVP）

- 侧聊模型请求**无工具**：只有 `system`（固定分析助手指令 + 引用快照）与消息历史，
  不可能执行命令、改文件、提交代码。
- 引用只携带最小必要快照（截断 4000 字符 + 相邻一条用户提问），**不复制整段主会话**，
  也不在每轮自动同步主会话。
- 所有 RPC 均以 `parentSessionId` 做归属校验（`cross-session` 拒绝），多个主会话数据不串线。
- 渲染采用 React 文本节点 + `white-space: pre-wrap`，**不解析 HTML**，杜绝注入。
- 遵守 DSH 现有工作区/权限/Origin/Session/凭据隔离：插件不注册任何新权限面。

## 6. 预计修改文件（实现清单）

```
dsh-side-chat/
├── build.mjs               # 构建：core 内联进 host 模板
├── package.json
├── src/
│   ├── core.mjs            # 纯宿主核心（可测）
│   ├── host.template.js    # 沙箱宿主半边（RPC + domain + llm 接线）
│   └── client.js           # 浏览器半边（三处 slot + 面板）
├── dist/host.js, client.js # 构建产物（加载用）
├── tests/                  # 单元/集成/冒烟测试
└── docs/                   # 本文档 + 调研记录
```

不修改任何 DSH 源码 / npm 缓存 / 正在运行的 Profile；安装动作另行征询用户。
