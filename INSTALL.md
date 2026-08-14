# 安装指南（dsh-side-chat）

本插件是 DeepSeek Harness 的**动态 Cordis 插件**：无需改代码、无需构建，由 agent 在
会话内用 `cordis_define` + `cordis_run` 加载即可。构建产物在 `dist/`。

## 方式 A：把产物交给 agent（推荐）

在任意 DSH 会话里发给 agent（或把 `dist/host.js`、`dist/client.js` 文件贴给它）：

```
请帮我加载 dsh-side-chat 插件：
1. 读取本仓库 dist/host.js 作为 code.host、dist/client.js 作为 code.client；
2. 用 cordis_define 创建插件（idPrefix 用 side，name 用 side-chat，
   purpose 写一句功能说明）；
3. 用 cordis_run 启动（mode: run）；
4. 我会在界面上批准运行卡片的授权，批准后告诉我结果。
```

agent 会自动完成定义与启动；你在运行卡片上点「允许」（可勾选"始终允许"）。

## 方式 B：手动加载

把 `dist/host.js` / `dist/client.js` 的内容分别作为 `code.host` / `code.client` 提交：

```
cordis_define → plugin.kind: new, idPrefix: side, name: side-chat
              → code.host = dist/host.js 内容
              → code.client = dist/client.js 内容
cordis_run    → mode: run
```

## 验证

1. 会话头部出现「侧聊」按钮；
2. 点头部按钮打开右侧面板；「＋」新建空白侧聊；
3. 任意助手消息尾部出现「在侧聊中询问」按钮；
4. 面板发送消息 → 流式回复出现 → 生成期间可「停止」；
5. 「插入主聊天输入框」→ 主输入框出现内容但**不会自动发送**。

## 卸载

`cordis_stop`（临时停用，保留版本）或 `cordis_undefine`（彻底删除）。
停止后 DSH 原生聊天功能不受影响；面板与按钮随即消失。

## 注意事项

- 插件是**会话级**的：每个会话需要各自加载一次（动态插件机制约束）。
- 侧聊数据持久化在 `~/.dsh/storages/side_chat.json`（宿主进程级，重启存活）。
- 不要手动改动 `~/.dsh`；如要把插件做成**全局安装**（web profile bundle），
  请先与维护者确认安装方案（见 README「后续清单」）。
