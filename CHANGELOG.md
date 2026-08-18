# Changelog

## 1.1.2

- Keep independent side-session UI state for every main conversation.
- Restore each conversation's own side pane after opening side chats in multiple main conversations.
- Scope hide, close, selected-text references, connection errors, and dialogs to the correct parent conversation.
- Prevent a previous conversation's side-session binding from flashing during navigation.

## 1.1.1

- Scoped each visible side pane to the main conversation that opened it.
- Hide the side pane, divider, selection state, and close dialog when navigating to another main conversation.
- Keep the side-chat entry available in other conversations and restore the original pane when returning to its owner.
- Verified the native conversation, composer, reference-chip, settings, and session APIs against DSH 0.1.0-rc.7.

## 1.1.0

- Replaced selected-text draft prefill with DSH's native reference-chip pipeline.
- Added a Side Chat settings section with enable and native Agent preset controls.
- Kept DSH's native model selector available inside every side conversation.
- Moved side conversations out of subagent routing and archive them from the workspace list.
- Improved native side-session connection and fixed composer/header alignment regressions.

## 1.0.0

- Rebuilt side chat as a real hidden DSH child session with native parent lineage.
- Reused DSH's complete ConversationRoot for both main and side conversations.
- Added on-demand bounded parent context without transcript seeding.
- Added aligned native composers, resizable split, hide/restore, and icon-only controls.
- Added main-text selection entry with native side-draft prefill.
- Added delete-or-keep close confirmation with delete as the documented default.
- Added a formal DSH bundle manifest and prebuilt tarball distribution path.
