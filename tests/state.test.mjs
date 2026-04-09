import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { resolveStateDir } from "../plugins/copilot/scripts/lib/state.mjs";

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  const cwd = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(cwd);
    assert.match(stateDir, new RegExp(pluginDataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(stateDir, /state/);
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});
