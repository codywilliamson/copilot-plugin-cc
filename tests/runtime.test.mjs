import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCopilot, installFakeGh, writeCopilotConfig } from "./fake-copilot-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { resolveStateDir } from "../plugins/copilot/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "copilot-companion.mjs");

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

test("setup reports ready with fake Copilot and gh auth", () => {
  const binDir = makeTempDir();
  const homeDir = makeTempDir();
  installFakeCopilot(binDir);
  installFakeGh(binDir, "logged-in", "codywilliamson");
  writeCopilotConfig(homeDir, {
    model: "gpt-5.4",
    effortLevel: "high"
  });

  const result = run("node", [SCRIPT, "setup", "--json"], {
    cwd: ROOT,
    env: buildEnv({ binDir, homeDir })
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.defaultModel, "gpt-5.4");
  assert.equal(payload.defaultEffort, "high");
  assert.match(payload.auth.detail, /codywilliamson/);
});

test("review renders a no-findings result from Copilot", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const homeDir = makeTempDir();
  installFakeCopilot(binDir, "ok");
  installFakeGh(binDir);
  writeCopilotConfig(homeDir, { model: "gpt-5.4" });
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 1;\n");
  run("git", ["add", "src/app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");

  const result = run("node", [SCRIPT, "review"], {
    cwd: repo,
    env: buildEnv({ binDir, homeDir })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Copilot Review/);
  assert.match(result.stdout, /No material findings\./);
});

test("adversarial review returns structured findings", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const homeDir = makeTempDir();
  installFakeCopilot(binDir, "ok");
  installFakeGh(binDir);
  writeCopilotConfig(homeDir, { model: "gpt-5.4" });
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0];\n");
  run("git", ["add", "src/app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = items[0].id;\n");

  const result = run("node", [SCRIPT, "adversarial-review"], {
    cwd: repo,
    env: buildEnv({ binDir, homeDir })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Missing empty-state guard/);
});

test("task can resume the latest Copilot session", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const homeDir = makeTempDir();
  installFakeCopilot(binDir, "ok");
  installFakeGh(binDir);
  writeCopilotConfig(homeDir, { model: "gpt-5.4" });
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const first = run("node", [SCRIPT, "task", "fix the issue"], {
    cwd: repo,
    env: buildEnv({ binDir, homeDir })
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Handled the requested task/);

  const second = run("node", [SCRIPT, "task", "--resume", "continue"], {
    cwd: repo,
    env: buildEnv({ binDir, homeDir })
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Resumed the previous Copilot session/);
});

test("cancel stops a running task", async () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const homeDir = makeTempDir();
  const pluginDataDir = makeTempDir();
  installFakeCopilot(binDir, "slow-task");
  installFakeGh(binDir);
  writeCopilotConfig(homeDir, { model: "gpt-5.4" });
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const env = buildEnv({
    binDir,
    homeDir,
    pluginDataDir,
    extraEnv: {
      COPILOT_COMPANION_SESSION_ID: "sess-current"
    }
  });

  const child = spawn("node", [SCRIPT, "task", "long running task"], {
    cwd: repo,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  const originalPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  const stateDir = resolveStateDir(repo);
  if (originalPluginData == null) {
    delete process.env.CLAUDE_PLUGIN_DATA;
  } else {
    process.env.CLAUDE_PLUGIN_DATA = originalPluginData;
  }
  const stateFile = path.join(stateDir, "state.json");

  await waitFor(() => {
    if (!fs.existsSync(stateFile)) {
      return false;
    }
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return state.jobs.some((job) => job.status === "running");
  });

  const cancel = run("node", [SCRIPT, "cancel"], {
    cwd: repo,
    env
  });

  assert.equal(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /Cancelled task-/);
  assert.match(cancel.stdout, /\/copilot:status/);
});
