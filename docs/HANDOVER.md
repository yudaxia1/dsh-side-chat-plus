# dsh-side-chat v2 交接记录

日期：2026-08-14（Asia/Shanghai）

## 当前状态

本 worktree 里已完成 v2 core、DSH host RPC、client 原生 `details` 右列挂载（无 layout/details 时才 overlay fallback）、v2 persistence、自动化测试和构建产物更新。侧聊打开时主会话保留在 AppFrame center 列旁边；关闭时释放 details seat，原生 DetailsPanel 恢复。没有安装到真实 DSH profile，没有修改 DeepSeek Harness checkout，没有 commit、push、PR、deploy 或 publish。

## 关键实现

- `src/core.mjs`：公开 session-query 事件归一化、Live/Snapshot Context Provider、stable source refs、full-turn priority/truncation、v2 persistence、cross-session ownership、独立 root Agent/session lineage、stop/retry/delta/completed/error semantics、parent-send audit、retention close/delete cleanup。
- `src/host.template.js`：`storageDomain`/`sessionQuery`/`agents`/可选 `agentPresets`/model catalog/image attachment 接线；root session 复用 DSH 原生 composition；不存在的 host capability 可见失败。
- `src/client.js`：header/assistant actions、session-scoped `details` 右列与 `shell.overlay` fallback；controlled IME-safe composer、immediate user echo、model/native-permission capability、image chip、sources/context controls、copy/stop/retry/insert-draft、显式 parent submit confirmation、close ask/keep/delete、settings row、focus/scroll/ARIA/theme。
- `build.mjs`：只在构建时内联 core 的 export block，避免动态 host 产物留下非法 export block。
- `dist/host.js`、`dist/client.js`：当前加载产物，需由 `node build.mjs` 更新。

## 源码交付与验证边界

```powershell
node build.mjs
node tests/core.test.mjs
node tests/integration.test.mjs
node tests/client-contract.test.mjs
node tests/smoke.test.mjs
```

`npm test` 和 `npm run check` 包含同一套构建与检查。真实 DSH Web 的人工视觉验收仍应独立进行，不能用静态测试替代。

## 能力矩阵摘要

| 功能 | public API / source | 实际状态 | 缺口 |
| --- | --- | --- | --- |
| independent session | `ctx.get('agents')` create/resume + Agent followup/cancel | 新侧聊使用普通 root session；同一侧线程稳定复用 | 无 public push，poll 封装在 transport；旧记录可兼容迁移 |
| parent context | `sessionQuery.readSession` | 已实现 visible normalization、tool summary、Live/Snapshot | 无完整内部 reasoning/metadata（按安全要求过滤） |
| main UI consistency | public slots/tokens + audited DSH source | adapted controlled composer/message/code behavior | 无动态插件可直接 import 的 shared React components |
| right-side pane | public `details` seat + `ctx.layout.openDetails/closeDetails` | 桌面真实 AppFrame 右列；关闭释放 seat；无 layout/details 时 fixed overlay fallback | `details` 是 single seat，侧聊打开期间替换原生 DetailsPanel；没有额外第四列 |
| model | `llm` + `agentDefaultModel` | public catalog，start-time model applied/persisted | followup 无 model 参数，child 启动后锁定 |
| files | `attachments.imageLimits/saveImage` + `draftAttachments` persistence | 选择阶段保存安全图片引用，刷新可恢复 chip，发送进入真实 child image block | 无 arbitrary file picker/fileMentions/openFile；非图片明确不支持 |
| permission | DSH Agent composition + authority adapter probe | peer session 使用主 Agent 原生 composition；没有可验证独立 authority 时不声称切换权限 | DSH 尚未公开 root Agent 的 per-session sandbox/approval setter |
| parent draft/send | `inputActions.setDraft/submit` + `sideChat.parentSendAudit` | 草稿不发送；明确确认后才调用原生 submit，保存来源与阶段 | submit 是 void/客户端动作；最终父 transcript 结果需由 DSH 事件观察确认 |
| retention/close | `settings` table + `sideChat.close` + optional `workspaceRegistry.archiveSession` | ask/keep/delete 单一设置源；delete 先 cancel，再删插件可控数据 | 无 public root-session physical delete；平台 transcript/log 可能残留 |
| session relation | root `agents` + persisted `childLink.relation:'peer'` | 普通独立 session 与父 session 隔离；父事件不被 side Agent 运行时写入 | 平台 transcript/log 仍受 DSH durable-session 清理能力限制 |

完整审计见 [ARCHITECTURE.md](ARCHITECTURE.md)、[RESEARCH.md](RESEARCH.md)、[DSH-SOURCE-NOTES.md](DSH-SOURCE-NOTES.md)。
