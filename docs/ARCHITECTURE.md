# 架构

## 1. 会话模型

侧聊是 DSH 原生 child session：

- id 使用 `sidechat-` 前缀；
- `origin: subagent`；
- `parentSession` 指向主会话；
- 继承主会话 cwd、agent preset、模型与原生运行能力；
- transcript 与主会话完全独立；
- workspace root sessionIds 不包含 child，所以左侧列表不会出现侧聊。

同一主会话重新打开时，host 只恢复属于该 parent 的最新 retained child。它不会把 sibling 或其他主会话的 child 接入当前 UI。

## 2. 父上下文

创建 child 时不发送父 transcript，也不伪造一条“以下是主会话全部内容”的用户消息。

host 只安装：

1. 一段带 section id 的关系提示，说明这是侧聊、父会话 id 与应按需获取上下文；
2. `side_chat_context` 工具，根据 query 从 `sessionQuery` 读取父会话，做相关性排序、按轮次裁剪与字符上限控制。

这使 child 实质上理解父会话，同时避免每次创建时复制全部内容。创造模式下仍由 DSH 原生 `cordis` preset 决定 system prompt、skills、tools 与知识；插件不覆盖它。

## 3. Host 生命周期

```text
sideChat.open(parentSessionId)
  ├─ 验证 parent，读取冷/热 session header
  ├─ 查找 retained child，否则 agents.create(...)
  ├─ session.options.origin = subagent
  ├─ session.options.parentSession = parent
  ├─ compose parent preset
  └─ 返回 child session id（不产生 user message）

sideChat.close(child, keep)
  └─ flush + dispose，保留 durable session

sideChat.close(child, delete)
  ├─ dispose
  ├─ 只解析并验证 child 的精确持久化路径
  └─ 删除该 child artifact
```

RPC 失败遵循 DSH 判别联合：`{ ok:false, error:{ code:'internal', message, details:{} } }`。

## 4. 原生 UI 复用

DSH 的 `conversation` entry 已经拥有完整 `ConversationRoot` 以及所有子 slots。client 在加载时保留该 component，并把 entry face 换成 `ParallelConversation`：

```text
ParallelConversation
  ├─ main binding ── 原生 ConversationRoot
  ├─ separator
  └─ side BindingContext ── 原生 ConversationRoot
```

side binding 只替换 `sessionId/useSession/useInput/useComposerBlock` 的数据源；`renderSlot`、`renderSlotChain`、全局 sessions/workspaces 和全部 DSH 子组件仍由原 entry 提供。插件没有消息 renderer、Markdown renderer 或输入栏实现。

客户端 loader 会并行执行插件，`dsh.client.inject` 只保证依赖服务可注入，不保证目标插件已经完成 `apply()`。因此 Side Chat 通过 slot registry 的 `conversation` entry 变更订阅等待原生 entry 注册；等待是事件驱动的，并带有可取消的 15 秒诊断截止时间，不使用固定间隔轮询。原生 entry 卸载或热重载时会先恢复旧 component，再等待并接管新 entry；Side Chat 卸载会同步取消订阅和截止时间。header actions/utilities 等子 slot 则使用 `slots.inject` 跟随各自的声明生命周期。

新 child 的原生状态是 blank。为了让侧聊输入框和已有主会话底部对齐，side binding 将 blank composer phase 稳定投影为 active，并用 WeakMap 保持快照引用；composer seat 使用 auto margin 吸收无消息时的剩余空间。输入框尺寸、ResizeObserver、sticky、草稿增长与接管面板仍由原生 `ConversationRoot` 控制。

## 5. 分栏与动作

- 默认比例 50%；side 可调范围 25%–70%。
- pointer drag 调宽；方向键每次 2%，按 Shift 每次 5%。
- 隐藏只设置 client `hidden`，不 close child。
- 恢复重用相同 `sideId`。
- 打开/恢复用 DSH 原生消息气泡＋图标；隐藏用面板图标；关闭用 DSH 详情面板同风格 X。
- 关闭才显示删除/保留 modal。

## 6. 选区

主列监听消息区 `mouseup`，排除 input、textarea 与 contenteditable。有效选区显示简约浮窗。点击后调用侧聊原生 `inputActions.setDraft`，不会提交消息，也不会向主 transcript 写入事件。

## 7. 已知 seam

当前 DSH 没有公开“为任意 session 渲染完整 conversation”的稳定 service。插件使用现有 slot registry `_core` 的 `entries/subscribe/register` 生命周期 seam 找到并跟踪唯一原生 conversation entry，并从 `SessionProvider` 获取 BindingContext Provider。目标 entry 尚未注册属于可等待的 loader 状态；只有 seam 本身缺失才会在加载时 fail loud。上游若改变该 seam，应更新适配层；禁止退回手搓聊天 UI。
