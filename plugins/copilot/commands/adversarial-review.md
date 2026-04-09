---
description: Run a stricter GitHub Copilot review that challenges assumptions and tradeoffs
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [focus text]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

This command is review-only.

- Do not fix issues.
- Do not apply patches.
- Return the runtime output verbatim.

If `$ARGUMENTS` includes `--background`, launch:

```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" adversarial-review "$ARGUMENTS"`,
  description: "Copilot adversarial review",
  run_in_background: true
})
```

Then tell the user: `Copilot adversarial review started in the background. Check /copilot:status for progress.`

Otherwise run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" adversarial-review "$ARGUMENTS"
```

Return stdout exactly as-is.
