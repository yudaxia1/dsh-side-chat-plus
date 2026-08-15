# dsh-side-chat

`dsh-side-chat` 是 DeepSeek Harness Web 的本地插件。它在主对话右侧打开一个真实、独立、但能按需理解主对话的子会话。

## 当前实现

- **真实会话**：host 通过 DSH `agents.create/resume` 创建 `origin: subagent`、带 `parentSession` 的 child session；不是在主会话里模拟一块聊天 UI。
- **不复制主对话**：新侧聊不会把主 transcript 拼成第一条用户消息。侧聊只获得一段简短的关系提示，并可在需要时调用 `side_chat_context` 读取有界、相关的父会话上下文。
- **原生 UI**：左右两栏都直接渲染 DSH 已注册的完整 `ConversationRoot`。消息、Markdown、工具、审批、提问、附件、输入框、模型与权限控件继续由 DSH 原生 slots 提供。
- **真正并排**：插件只增加 split shell。分隔条可拖拽，键盘左右方向键可微调；侧聊占比限制在 25%–70%。
- **可隐藏**：隐藏只收起 UI，不结束 child；顶部消息气泡图标可恢复同一侧聊。关闭才进入删除/保留确认。
- **不进入左侧列表**：child 使用 DSH 原生 subagent lineage，不写入 workspace 的 root session 列表；主 header 仍可显示原生“子代理”关系。
- **文本选区入口**：在主消息中选中文字后出现“在侧聊中对话”；点击只把选区写入侧聊原生草稿，不自动发送。
- **默认删除**：关闭时默认提示对话将删除，并提供“取消 / 保留对话 / 删除并关闭”。
- **创造模式兼容**：child 继承父会话 preset、模型、权限与工具组合。插件参考 DSH `cordis` 创造模式定义，只增加限定范围的关系提示与上下文工具，不复制或替换创造模式 system prompt。

## 架构边界

host 只增加侧聊需要的生命周期与上下文能力：

```text
主 Session
  └─ hidden child Session (origin=subagent, parentSession=主 Session)
       ├─ 原生 DSH Agent / preset / tools / approvals
       ├─ 独立 transcript
       └─ side_chat_context → 按需读取父会话的相关上下文
```

client 保留 DSH 已注册的原生 conversation component，只把它放进两个会话绑定中。插件没有自己的消息 renderer，也没有自己的 composer 实现。当前 DSH 没有公开“渲染任意 session 的完整 conversation”入口，因此 arbitrary-session 绑定使用现有 `SessionProvider` 的 BindingContext seam；若 DSH 改动该内部 seam，插件会明确失败，而不会退回手写聊天 UI。

## 构建与安装

```powershell
npm test
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh plugin --profile web add E:\DSH_Work\dsh-side-chat
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh web
```

已安装时：

```powershell
npm test
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh plugin --profile web update dsh-side-chat
```

`npm test` 会构建动态产物、正式本地包，并运行 core、host integration、client contract 与 smoke tests。

不希望在安装时运行构建脚本的用户，可直接下载仓库 `release/` 中的 `.tgz`：

```powershell
dsh plugin --profile web add .\release\dsh-side-chat-1.0.0.tgz
```

## 使用

1. 打开一个主会话，点击 header 中的消息气泡＋图标。
2. 拖动中间分隔线调整比例；聚焦分隔线后可用方向键微调，`Shift` 加速。
3. 点击侧聊顶部的面板图标可隐藏；主 header 的消息气泡图标可恢复。
4. 在主消息中选中文字，点击“在侧聊中对话”，选区会进入侧聊草稿。
5. 点击 X 关闭侧聊，再选择保留或删除；默认提示删除且不存档。

## 目录

```text
src/core.mjs          纯函数：side id、上下文筛选与 retained child 选择
src/host.template.js  DSH child 生命周期、上下文工具、关闭/保留/删除
src/client.js         原生 ConversationRoot 双绑定与最小 split shell
dev/                  隔离 DSH profile、构建与本地验收种子
tests/                core、integration、client contract、smoke
```

## License

MIT。参考的 DeepSeek Harness checkout 同为 MIT。
