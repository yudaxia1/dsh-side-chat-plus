# dsh-side-chat-plus

[简体中文](README.md) · **English**

Run an **independent side conversation** beside your main DeepSeek Harness session: it never pollutes the main context, is read-only by default, and can promote any answer back into the main conversation.

![Side chat panel](docs/assets/panel.png)

## What it is

While the main session is running a long task, open the "Side Chat" tab in the right sidebar and ask a quick question:

- It sees the main conversation's background (retrieved on demand), but the exchange is **never** written into the main session.
- It is a **real independent session** — its own transcript, its own model, its own tools.
- **Read-only by default**: it can read files, search, and research, but cannot modify the workspace (sandbox-enforced, approvals off).
- Useful answer? One click on ↗ **promotes it into the main composer** as a quoted draft.

The side chat's conversation surface is the shipped one — the native composer, Markdown, attachments, `@` references, the model picker, and tool cards are all the stock components.

## How this differs from the official subagent sidebar

Since 0.1.6-alpha.2, dsh can open **subagent sessions** in the right sidebar (PR #4417). The two serve different purposes and can be installed together without conflict:

| | Official (built into alpha.2) | This plugin |
|---|---|---|
| Where sessions come from | Subagents the agent spawns itself (the subagent tool) | Opened by the user, for any main session, any time |
| Purpose | Watching and following subagent execution | Free-form Q&A beside the main conversation (the /btw pattern) |
| Permissions | Inherits the subagent's own configuration; one-shot subagents are view-only | Read-only by default (sandbox-enforced, approvals off), one toggle to unlock |
| Back to the main session | ❌ No | ✅ One click promotes an answer into the main composer draft |
| Main-session context | Whatever the subagent was spawned with | ✅ The side_chat_context tool retrieves it on demand |
| Lifecycle | Follows the subagent | ✅ User-controlled: keep / delete / resume, with a remembered close preference |
| Session list | Subagents appear in the left list (grouped) | ✅ Archived and hidden, never clutters the list |
| Model | Inherits from the subagent | ✅ Independent choice through the native picker |
| Agent preset | Inherits | ✅ standard / ptc / minimal / cordis |

In one line: the official feature is "watch the agent's delegates"; this plugin is "a second voice for the user".

## Requirements

- **dsh ≥ 0.1.6-alpha.2** (the panel relies on the explicit-session binding seam introduced in that release)
- Node.js ≥ 22 (development only)

## Install

```powershell
dsh plugin --profile web add ./dsh-side-chat-plus-1.0.0.tgz
```

Then restart `dsh web`.

## Usage

1. Open any main session → click the 🗨 button in the conversation header (or find "Side Chat" on the right-sidebar guide page).
2. The "Side Chat" tab appears in the right sidebar: ask away.
3. When the side chat needs the main conversation's background, it calls the `side_chat_context` tool on demand.
4. The ↗ under an answer promotes it into the main composer as a quoted draft.
5. Panel top-right: ✥ opens the session in the main area (full native surface); ✕ closes it (keep or delete).

Side-chat sessions stay out of the left session list (archived); they can be recovered under Settings → Archived sessions.

## Settings (Settings → Side Chat)

| Option | Default | Description |
|---|---|---|
| Enable side chat | on | Hides every entry point when off |
| Read-only mode | **on** | Off gives the side chat full tool access (workspace writes) |
| Preset for new side chats | standard | A shipped DSH agent preset (standard / ptc / minimal / cordis) |
| On close | ask every time | Or always keep / always delete |

## Architecture

- **Host**: creates or resumes a real session with `parentSession` and archives it immediately; pins `sandbox/mode=read-only` + `approval/policy=never` for read-only mode; registers the `side_chat_context` tool for on-demand main-context retrieval; the `/side-chat` prefix route reuses the stock Host/Origin + cookie fence.
- **Client**: an official right-sidebar tab (`sidebarRightTabs` + `sidebar.right.pane.tab`) whose content binds the side session through `SessionProvider session={sessions.retain(id)}` and renders the shipped `conversation.content` (embedded variant) — composer, transcript, and model picker are the stock components.

## Acknowledgements and license

Derived from [KarlOfLaw/dsh-side-chat](https://github.com/KarlOfLaw/dsh-side-chat) (MIT). Its MIT license notice is preserved (see [LICENSE](LICENSE)).

MIT License
