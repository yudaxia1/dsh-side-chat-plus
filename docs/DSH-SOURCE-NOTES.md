# DSH 源码参照

只读参考 checkout：`E:\DSH_Work\dsh-src\deepseek-harness`（MIT）。

## 原生对话

- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- `packages/client/ui-conversation/src/client/chat/ChatView.tsx`
- `packages/client/ui-conversation/src/client/contract/slots.ts`

实现选择：复用注册到 `conversation` 的完整 `ConversationRoot`，而不是复制 InputBar、MessageItem、Markdown 或工具卡源码。插件只提供双栏容器、任意 child 的会话绑定与增量动作。

## 会话绑定与列表语义

- `packages/client/web-react/src/session-provider.tsx`
- `packages/client/web-react/src/scoped-slots.tsx`
- `packages/client/runtime/src/client/sessions/service.ts`
- DSH subagent session lifecycle / UI lineage implementation

实现选择：child 使用 `origin: subagent` 与 `parentSession`，因此保持 DSH 原生父子关系，同时不会作为 workspace root session 出现在左侧会话列表。

## 创造模式

- `apps/cli/config/agent-presets/cordis/preset.yml`
- `apps/cli/config/agent-presets/cordis/agent.cordis.yml`
- cordis preset 引用的 creation skills 与 runtime 指导

实现选择：侧聊继承 parent preset。插件只添加有 section id 的关系提示和 `side_chat_context` 工具，不复制、截断或替换创造模式的 system prompt、skills、knowledge 与工具定义。

## 图标

- `packages/client/ui-primitives/src/icons/index.tsx` 的 `IconNewChatOutline16`
- `packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx` 的 close glyph

顶部侧聊入口使用原生消息气泡＋ glyph；关闭图标沿用 DetailsPanel 的线性 X 规则。

## 上游兼容边界

公开 slot contract 没有 arbitrary-session ConversationRoot renderer。当前实现使用 slot registry `_core` 与 `SessionProvider` 的 BindingContext seam。该 seam 变化时应更新适配层并重新做真实 UI 验收，不应重新引入手写 conversation/composer。
