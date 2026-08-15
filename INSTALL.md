# 安装与验收

本项目是 DSH 本地插件，不是 Codex plugin，不包含 `.codex-plugin/plugin.json`。

## 安装

在仓库目录执行：

```powershell
npm test
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh plugin --profile web add E:\DSH_Work\dsh-side-chat
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh web
```

同名插件已经安装时，将 `add` 改为：

```powershell
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh plugin --profile web update dsh-side-chat
```

卸载：

```powershell
pnpm --dir E:\DSH_Work\dsh-src\deepseek-harness dsh plugin --profile web remove dsh-side-chat
```

## 运行要求

插件依赖 DSH 的 `sessions`、`sessionQuery`、`sessionPersistence`、`agents` 与 `agentPresets` 服务。缺少必需能力时会返回可见错误，不会回退到独立 LLM 调用或手写聊天页。

## 手动验收

1. 打开已有主会话，确认 header 出现消息气泡＋图标。
2. 打开侧聊，确认主对话与侧聊并排，两个输入框底线和高度一致。
3. 拖动分隔线，确认宽度比例变化；用方向键验证键盘调宽。
4. 点击面板图标隐藏，确认主对话铺满；点击主 header 图标恢复，确认仍是同一个 child。
5. 打开左侧列表，确认只出现主会话，不出现 `sidechat-*`。
6. 检查侧聊的消息、输入、模型、权限、审批、问题与附件均为 DSH 原生 UI。
7. 选中主消息文字，确认出现“在侧聊中对话”；点击后只预填侧聊草稿，不自动发送。
8. 点击 X，确认出现“取消 / 保留对话 / 删除并关闭”，并明确提示默认删除且不存档。
9. 新 child 的第一条 transcript 不得包含整段父会话；需要父上下文时由 `side_chat_context` 按需读取。

自动检查：

```powershell
npm test
```

自动检查不是最终视觉证明；输入框对齐、分栏拖拽与关闭弹窗仍需在真实 DSH Web 验收。
