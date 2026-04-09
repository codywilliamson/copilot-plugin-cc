---
description: Check whether the local GitHub Copilot CLI is ready for Claude Code companion commands
argument-hint: '[--config-dir <dir>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" setup "$ARGUMENTS"`

Return the command output as-is.
