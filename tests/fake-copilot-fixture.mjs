import fs from "node:fs";
import path from "node:path";

import { writeExecutable } from "./helpers.mjs";

export function installFakeGh(binDir, behavior = "logged-in", login = "codywilliamson") {
  const scriptPath = path.join(binDir, "gh");
  const source = `#!/usr/bin/env node
const behavior = ${JSON.stringify(behavior)};
const login = ${JSON.stringify(login)};
const args = process.argv.slice(2);

if (args[0] === "auth" && args[1] === "status") {
  if (behavior === "logged-out") {
    console.error("not logged in");
    process.exit(1);
  }
  console.error(\`github.com\\n  ✓ Logged in to github.com account \${login} (keyring)\`);
  process.exit(0);
}

console.log("gh test fixture");
`;
  writeExecutable(scriptPath, source);
}

export function writeCopilotConfig(homeDir, config = {}) {
  const configDir = path.join(homeDir, ".copilot");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function buildEnv({ binDir, homeDir, pluginDataDir = null, extraEnv = {} }) {
  return {
    ...process.env,
    HOME: homeDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    ...(pluginDataDir ? { CLAUDE_PLUGIN_DATA: pluginDataDir } : {}),
    ...extraEnv
  };
}

export function installFakeCopilot(binDir, behavior = "ok") {
  const statePath = path.join(binDir, "fake-copilot-state.json");
  const scriptPath = path.join(binDir, "copilot");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = ${JSON.stringify(statePath)};
const BEHAVIOR = ${JSON.stringify(behavior)};
const args = process.argv.slice(2);

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { nextSession: 1 };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function findOption(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function hasFlag(name) {
  return args.includes(name);
}

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}

function finish(exitCode) {
  process.exit(exitCode);
}

if (hasFlag("--version")) {
  console.log("GitHub Copilot CLI 1.0.22");
  process.exit(0);
}

if (args[0] === "login") {
  console.log("fake login");
  process.exit(0);
}

const prompt = findOption("-p") ?? findOption("--prompt") ?? "";
const outputJson = findOption("--output-format") === "json";
const model = findOption("--model") ?? "gpt-5.4";
const effort = findOption("--effort");
const resumeSession = findOption("--resume");
const allowShell = args.includes("--allow-tool=shell");
const allowWrite = args.includes("--allow-tool=write");
const state = loadState();
const sessionId = resumeSession || \`sess-\${state.nextSession++}\`;
saveState(state);

function reviewPayload() {
  if (BEHAVIOR === "review-invalid") {
    return "not valid json";
  }

  if (prompt.includes("adversarial")) {
    return JSON.stringify({
      verdict: "needs-attention",
      summary: "One adversarial concern surfaced.",
      findings: [
        {
          severity: "high",
          title: "Missing empty-state guard",
          body: "The change assumes data is always present.",
          file: "src/app.js",
          line_start: 1,
          line_end: 1,
          recommendation: "Guard empty collections before indexing."
        }
      ],
      next_steps: ["Add an empty-state test."]
    });
  }

  return JSON.stringify({
    verdict: "approve",
    summary: "No material issues found.",
    findings: [],
    next_steps: []
  });
}

function taskPayload() {
  if (resumeSession) {
    return "Resumed the previous Copilot session.\\nTask prompt accepted.";
  }
  return "Handled the requested task.\\nTask prompt accepted.";
}

if (!outputJson) {
  console.log(taskPayload());
  process.exit(0);
}

emit({ type: "session.tools_updated", data: { model } });

if (allowShell) {
  emit({
    type: "tool.execution_start",
    data: {
      toolName: "bash",
      arguments: {
        command: "pwd",
        description: "Inspect workspace"
      }
    }
  });
  emit({
    type: "tool.execution_complete",
    data: {
      toolName: "bash",
      result: {
        detailedContent: "/tmp/workspace"
      }
    }
  });
}

if (allowWrite) {
  emit({
    type: "tool.execution_start",
    data: {
      toolName: "write"
    }
  });
  emit({
    type: "tool.execution_complete",
    data: {
      toolName: "write",
      result: {
        detailedContent: "Updated src/app.js"
      }
    }
  });
}

const message = prompt.includes("Return JSON only with this exact top-level shape") ? reviewPayload() : taskPayload();

const sendFinal = () => {
  emit({
    type: "assistant.message",
    data: {
      content: message,
      phase: "final_answer",
      reasoningText: effort ? \`Used \${model} at \${effort} effort.\` : \`Used \${model}.\`
    }
  });
  emit({
    type: "result",
    sessionId,
    exitCode: BEHAVIOR === "task-fails" ? 1 : 0,
    usage: {
      premiumRequests: 1,
      totalApiDurationMs: 1200,
      sessionDurationMs: 2400,
      codeChanges: {
        linesAdded: allowWrite ? 3 : 0,
        linesRemoved: allowWrite ? 1 : 0,
        filesModified: allowWrite ? ["src/app.js"] : []
      }
    }
  });
  finish(BEHAVIOR === "task-fails" ? 1 : 0);
};

if (BEHAVIOR === "slow-task" && !prompt.includes("Return JSON only with this exact top-level shape")) {
  setTimeout(sendFinal, 5000);
} else {
  sendFinal();
}
`;
  writeExecutable(scriptPath, source);
}
