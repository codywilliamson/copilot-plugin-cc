---
description: Delegate a coding task to GitHub Copilot from inside Claude Code
argument-hint: '[--wait|--background] [--resume|--fresh] [--model <model>] [--effort <low|medium|high|xhigh>] [--reasoning-effort <low|medium|high|xhigh>] [task]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

This command forwards work to the Copilot companion runtime.

- Keep the user task text intact.
- Return the runtime output verbatim.
- Treat `--background` and `--wait` as Claude-side execution controls.
- The runtime handles `--resume`, `--fresh`, `--model`, `--effort`, and `--reasoning-effort`.

If `$ARGUMENTS` includes `--background`, launch:

```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" task "$ARGUMENTS"`,
  description: "Copilot rescue task",
  run_in_background: true
})
```

Then tell the user: `Copilot task started in the background. Check /copilot:status for progress.`

Otherwise run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" task "$ARGUMENTS"
```

Return stdout exactly as-is.
