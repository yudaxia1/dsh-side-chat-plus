# DSH Side Chat

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="docs/assets/dsh-side-chat-hero.png" alt="DSH Side Chat" width="100%">
</p>

<p align="center">
  <a href="release/dsh-side-chat-1.1.0.tgz"><img alt="Version 1.1.0" src="https://img.shields.io/badge/version-1.1.0-2563eb?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square"></a>
  <img alt="Tests 15 passing" src="https://img.shields.io/badge/tests-15%20passing-16a34a?style=flat-square">
  <img alt="DeepSeek Harness plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-0ea5e9?style=flat-square">
</p>

<p align="center">
  <strong>Open a truly independent, native, context-aware conversation beside your main DeepSeek Harness session.</strong>
</p>

<p align="center">
  <a href="#interface-preview">Interface Preview</a> ·
  <a href="#core-capabilities">Core Capabilities</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#architecture-boundary">Architecture</a>
</p>

> [!NOTE]
> A side chat is not a floating overlay or a hand-built imitation of the DSH chat UI. It is a real DSH Session that reuses the native conversation components and reads bounded parent context only when needed.

## Interface Preview

![Native DSH parallel side chat](docs/assets/side-chat-parallel.png)

The main conversation and side chat use the same native DSH interface. The divider is resizable, both composers stay aligned, and side sessions do not appear in the workspace session list.

| Ask about selected text | Native settings page |
| --- | --- |
| ![Open selected text in a side chat](docs/assets/side-chat-selection.png) | ![Side chat settings](docs/assets/side-chat-settings.png) |

## Core Capabilities

| Capability | Implementation |
| --- | --- |
| **Real independent session** | Creates a Session with `parentSession` through DSH `agents.create/resume`, without occupying subagent routing. |
| **Complete native UI** | Both panes render the complete `ConversationRoot`; messages, tools, approvals, attachments, composer, model, and access controls remain native DSH features. |
| **On-demand parent context** | The plugin never copies the parent transcript into a new chat. `side_chat_context` retrieves only bounded, relevant parent excerpts when needed. |
| **True side-by-side layout** | Adds only a minimal split shell. The divider supports dragging and keyboard adjustment, with the side pane constrained to 25%-70%. |
| **No sidebar pollution** | New side sessions are archived immediately and stay out of the workspace session list. |
| **Ask about a selection** | Selecting text in a main message reveals an "Ask in side chat" action and places the quote in a removable native composer chip. |
| **Hide, retain, or delete** | Hiding only collapses the pane. Closing clearly warns that deletion is the default and offers a retain option. |
| **Native modes and models** | New chats default to Standard mode, with PTC, Minimal, and Creation modes available. The native model selector remains available. |

## Architecture Boundary

The host adds only the lifecycle and context capabilities required by side chat:

```text
Main Session
  `-- archived side Session (parentSession=Main Session)
      |-- native DSH Agent / preset / tools / approvals
      |-- independent transcript
      `-- side_chat_context -> bounded, on-demand parent context
```

The client keeps the registered DSH conversation component and places it inside two session bindings. The plugin does not implement its own message renderer or composer. DSH currently has no public API for rendering a complete conversation for an arbitrary session, so the arbitrary-session binding uses the existing `SessionProvider` BindingContext seam. If that internal seam changes, the plugin fails explicitly instead of falling back to a custom chat UI.

## Quick Start

### Install the prebuilt package

Download the package from `release/` and install it without running a build during installation:

```powershell
dsh plugin --profile web add .\release\dsh-side-chat-1.1.0.tgz
```

### Build from source

```powershell
git clone https://github.com/KarlOfLaw/dsh-side-chat.git
cd dsh-side-chat
npm test

$DshSource = "D:\path\to\deepseek-harness"
$PluginSource = (Get-Location).Path
pnpm --dir $DshSource dsh plugin --profile web add $PluginSource
pnpm --dir $DshSource dsh web
```

For an existing installation:

```powershell
npm test
pnpm --dir $DshSource dsh plugin --profile web update dsh-side-chat
```

`npm test` builds the dynamic output and formal local package, then runs the core, host integration, client contract, and smoke tests.

## Usage

1. Open a main session and click the message-bubble-plus icon in the header.
2. Drag the divider to adjust the pane ratio. Focus it and use the arrow keys for fine adjustment; hold `Shift` for larger steps.
3. Use the panel icon in the side header to hide the pane. The message-bubble icon in the main header restores the same side chat.
4. Select text in a main message and click "Ask in side chat" to place it in the side composer as a removable quote chip.
5. Use the Side Chat settings page to enable the plugin and choose the default native Agent mode.
6. Click the close icon, then choose whether to retain or delete the conversation. Deletion without archiving is the default.

## Project Layout

```text
src/core.mjs          Pure functions: side IDs, context filtering, retained child selection
src/host.template.js  Child lifecycle, context tool, retain/delete behavior
src/client.js         Native ConversationRoot bindings and the minimal split shell
dev/                  Isolated DSH profile, local build, and acceptance seed
tests/                Core, integration, client contract, and smoke tests
release/              Prebuilt packages for direct installation
```

The repository intentionally contains both the unbuilt source and prebuilt plugin packages: readers can study and build the implementation, while users can install the `.tgz` directly.

## License

MIT. The referenced DeepSeek Harness checkout is also MIT licensed.
