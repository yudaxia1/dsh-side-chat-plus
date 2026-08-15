# DSH public capability audit

审计对象：`E:\DSH_Work\dsh-src\deepseek-harness`，只读参考 checkout，HEAD `ae9a161637d24abf54cb034edec36ee11af0828d`。本插件运行时不依赖该路径，也没有修改 checkout。

## 1. Host catalog

主要公共 catalog 证据位于：

- `packages/extensions/tool-cordis/src/api-catalog.ts`：`agentDefaultModel`、`llm`、`attachments`、`sandboxPolicy`、`sessionQuery`、`agents` 的 public service/types；
- `packages/extensions/tool-cordis/src/services/` 及对应 session-query/agent 实现：root session lifecycle、readSession 和权限参数边界；
- DSH client slots/layout catalog：`conversation.session.header.actions`、`conversation.chat.assistant-actions`、composer slots、`shell.overlay`、`details`/sidebar owner。

### 结论

| 需要的能力 | 公开证据 | v2 决策 |
| --- | --- | --- |
| independent side session | `ctx.get('agents').create/resume` + Agent `followup/cancel` | 新侧聊使用普通 root session；不设置额外 parent/origin lineage |
| parent session transcript | `ctx.get('sessionQuery').readSession` | 已实现；事件归一化和稳定 source refs |
| current model/list | `agentDefaultModel.currentSelection`、`llm.listProviders/listModels/resolveModelInfo` | 已实现；真实 catalog，start-time `agentOptions` |
| safe default | root Agent composition + runtime capability probe | 默认不宣称未被 DSH runtime 强制的工具/权限；能力由公开 adapter 实际决定 |
| native read-only | 没有 start/followup 可验证的 sandbox/authority profile | UI 使用 DSH 原生 id，但当前 disabled；运行时 adapter 出现时 feature-detect 启用 |
| native workspace-write / full-access | 尚未找到独立 root Agent 的 per-session authority setter | 不静默升级；peer session 使用主 Agent 原生 composition，独立切换仍需正式 DSH authority adapter |
| images | `attachments.imageLimits/saveImage` + side-thread `draftAttachments` | 选择阶段保存安全引用、刷新可恢复 chip、发送进入真实 image block |
| arbitrary files | 没有 public picker/fileMentions/openFile/content-block service | unsupported，显式错误 |
| native parallel right column | `details` session seat + `ctx.layout.openDetails/closeDetails`；`AppFrame` grid 的第三列 | 已实现；侧聊打开期间临时替换 native DetailsPanel，关闭时释放并恢复 |
| overlay fallback | `shell.overlay` additive overlay seat；`AppFrame` 把它放在各列之上 | 仅当 layout/details 不可用时启用；会覆盖主消息，明确标记为 fallback |
| parent send | client scoped `inputActions.setDraft/submit`，host `sideChat.parentSendAudit` | explicit confirmation -> native submit; no host append; result stages auditable |
| retention | storage `settings` + optional `workspaceRegistry.archiveSession` | ask/keep/delete and explicit close cleanup; public archive is not physical child deletion |
| Host→Client push | 当前 catalog 未暴露 public push listener | poll 仅在 transport 抽象内 |

## 2. Main conversation source audit

审计文件：

- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- `packages/client/ui-conversation/src/client/chat/MessageItem.tsx`
- `packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx`
- `packages/client/ui-primitives/src/markdown/MarkdownText.tsx`
- `packages/client/ui-primitives/src/markdown/MessageText.tsx`
- `packages/client/ui-conversation/src/client/chat/ChatView.tsx`

主 composer 的重要行为已对齐到 side composer：controlled draft、composition ref / native composing guard、keyCode 229、Enter repeat guard、Shift+Enter、focus preventScroll、失败保留 draft、stop action、图片 rail、theme tokens 和 near-bottom scroll。主消息的用户 bubble / assistant Markdown / code block / normalized tool result 视觉与语义被最小化适配到独立 client；parent submit 仅在显式确认点击后发生。

但这些内部 React modules 没有动态插件可用的 public component service/export。直接复制整套组件会引入内部依赖和 monorepo coupling，直接 import 也会在 standalone plugin build 时失败。因此当前代码注释和文档明确写作“adapted/reimplemented”，不写“shared native component”或“完全复用”。这是当前公共扩展接口的真实 gap，而不是把 side chat 主动设计成另一种产品。

## 3. Layout decision

已检查 public shell/sidebar/dock/layout surfaces：

- `details` 是 DSH 自己拥有的右侧 details column，注册插件组件会替换内置 DetailsPanel；本插件只在侧聊打开期间占用它，关闭时释放注册，因此主会话工具详情可恢复；
- `shell.overlay` 可追加 root-level UI，但语义是浮层 seat，不能形成并列列；
- `sidebar` 是左侧整体列，不适合右侧 parallel pane；
- `ctx.layout` 虽没有通用 split/reserve-width API，但其公开 `openDetails/closeDetails` 足以驱动已有右列。

因此当前优先实现真实 `details` 并列列；只有 `layout` 或 `details` seat 缺失/注册失败才启用固定 app-edge overlay，无 backdrop、无 centered modal、无 brittle private DOM docking selector。`dsh_sc_open` 和 `--dsh-side-chat-layout-state` 只用于诊断，桌面列宽由 DSH `AppFrame` 负责，不由插件伪造。

精确源码依据：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1025-1057` 将 `details` 标为右侧列并说明注册会替换 shipped DetailsPanel；同文件 `:1060-1080` 明确禁止插件注册 `root`；`packages/client/ui-layout/src/client/AppFrame.tsx:168-198` 将 `details` 放入第三个 grid track，`packages/client/ui-layout/src/client/service.ts:18-30` 暴露 `openDetails/closeDetails`。

## 4. Context and safety

公开 session events 的可见边界不是“把原始日志全文塞进 prompt”：

- user/assistant 只保留 visible text；
- tool call/result 只保留 name/status/text summary；
- hidden/internal/reasoning/plugin/system 和内部 metadata 被过滤；
- source refs 只包含 session/event/message/seq/renderer node key 等安全稳定字段；
- file anchor 没有 public content API 时标记 unsupported。

这使“没有 anchor 也能引用较早 visible parent context”和“Live refresh 会捕获新消息”成为可测试契约，同时 Snapshot 能复现。

## 5. Persistence

v2 使用 `storageDomain` 的 `threads` 表和 `settings` 表。记录含 schemaVersion、parentSessionId、context version/hash、独立 root session id、`childLink.relation:'peer'`、selectedModel、permissionMode、retentionPolicy、parent-send audit、messages 和 transport cursors。旧的非 peer lineage 不会被当前独立对话列表重新激活。

所有 list/get/mutate 先做 parent ownership check。重新创建 core/host 只从 durable table 读取同 parent records；不同 parent session 不会看到彼此的 threads。

## 6. Known platform gaps

1. **额外第四列**：当前 public layout 只提供一个 `details` 右列，不提供额外 plugin split/reserve-width API。侧聊通过临时占用 details 实现主对话旁边的真实第三列，但侧聊打开期间原生工具 DetailsPanel 不同时显示；关闭后恢复。没有 layout/details 的旧宿主仍会使用 overlay fallback 并可能覆盖主消息。
2. **原生消息 renderer**：需要把 MessageItem/AssistantMarkdown/MarkdownText/MessageText 以稳定 public client service/export 暴露；当前是小型自包含适配。
3. **完整工具/文件节点**：需要 node-level public slots、file picker、fileMentions 或安全 attachment content-block API；当前只显示 normalized tool source 和图片 chip。
4. **权限层级**：需要 child start/followup 接受并强制 sandbox/authority/approval profile；当前只 enforce 空 tool allowlist。宿主已做运行时 adapter 探测，不把 gap 固化成永远禁用。
5. **模型切换**：需要 followup model parameter；当前选中的 public model 只作用于第一次 start。
6. **Push streaming**：需要 public host-to-client event surface；当前轮询由 transport 封装。
7. **侧聊物理删除**：需要 DSH root session delete/purge API；当前可清理插件记录，最多 archive workspace registry，无法保证平台 transcript/log 无痕。

## 7. Source/license note

DeepSeek Harness checkout 的根 `LICENSE` 是 MIT，版权标注 DeepSeek 2026。本插件没有复制大模块或把 checkout 路径打包进 dist；仅根据上列源码审计其公开契约和交互模式，并在 `src/client.js` 中保留最小适配注释。若未来直接复用内部源文件，应只引入最小依赖闭包并随文件保留 MIT notice，同时更新本说明和能力矩阵。
