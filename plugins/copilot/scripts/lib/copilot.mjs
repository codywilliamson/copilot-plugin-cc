import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

import { binaryAvailable } from "./process.mjs";
import { firstMeaningfulLine } from "./text.mjs";

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function mergeReasoningSections(existingSections, nextSections) {
  const merged = [...existingSections];
  for (const section of nextSections) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

function resolveConfigDir(options = {}) {
  if (options.configDir) {
    return path.resolve(options.configDir);
  }
  if (options.env?.COPILOT_CONFIG_DIR) {
    return path.resolve(options.env.COPILOT_CONFIG_DIR);
  }
  const homeDir = options.env?.HOME ?? os.homedir();
  return path.join(homeDir, ".copilot");
}

export function getCopilotConfig(options = {}) {
  const configDir = resolveConfigDir(options);
  const configPath = path.join(configDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return {
      configDir,
      configPath,
      config: null
    };
  }

  try {
    return {
      configDir,
      configPath,
      config: JSON.parse(fs.readFileSync(configPath, "utf8"))
    };
  } catch (error) {
    return {
      configDir,
      configPath,
      config: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function getCopilotAvailability(cwd) {
  return binaryAvailable("copilot", ["--version"], { cwd });
}

export function getCopilotAuthStatus(cwd, options = {}) {
  const env = options.env ?? process.env;
  const envTokenName = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].find((name) => {
    const value = env[name];
    return typeof value === "string" && value.trim();
  });

  if (envTokenName) {
    return {
      loggedIn: true,
      source: "env",
      detail: `Using ${envTokenName} from the environment.`
    };
  }

  const ghStatus = spawnSync("gh", ["auth", "status"], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true
  });

  if (!ghStatus.error && ghStatus.status === 0) {
    const combined = `${ghStatus.stdout}\n${ghStatus.stderr}`;
    const loginMatch = combined.match(/account\s+([A-Za-z0-9-]+)/i);
    const login = loginMatch?.[1] ?? null;
    return {
      loggedIn: true,
      source: "gh",
      detail: login ? `Authenticated through gh as ${login}.` : "Authenticated through gh."
    };
  }

  const suffix =
    ghStatus.error?.code === "ENOENT"
      ? "`gh` is not installed."
      : "No GitHub token env vars were found and `gh auth status` did not succeed.";

  return {
    loggedIn: false,
    source: null,
    detail: `${suffix} If you authenticated only with \`copilot login\`, the companion cannot verify that upfront.`
  };
}

function buildToolStartMessage(data) {
  const toolName = data.toolName ?? "tool";
  if (toolName === "bash") {
    const description = data.arguments?.description ?? data.arguments?.command ?? "shell command";
    return {
      message: `Running ${description}.`,
      phase: "running"
    };
  }
  if (toolName === "write" || toolName === "str_replace_editor") {
    return {
      message: "Editing files.",
      phase: "editing"
    };
  }
  return {
    message: `Running tool: ${toolName}.`,
    phase: "investigating"
  };
}

function buildToolCompleteMessage(data) {
  const toolName = data.toolName ?? "tool";
  return {
    message: `Finished tool: ${toolName}.`,
    phase: toolName === "bash" ? "running" : "investigating",
    logTitle: data.result?.detailedContent ? `${toolName} output` : null,
    logBody: data.result?.detailedContent ?? null
  };
}

export async function runCopilotJson(cwd, args, options = {}) {
  const env = options.env ?? process.env;
  const child = spawn("copilot", args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const onProgress = options.onProgress ?? null;
  const stdoutLines = [];
  const stderrLines = [];
  let finalMessage = "";
  let sessionId = null;
  let model = null;
  let exitCode = null;
  let usage = null;
  let touchedFiles = [];
  let reasoningSummary = [];

  const stdoutReader = readline.createInterface({ input: child.stdout });
  const stderrReader = readline.createInterface({ input: child.stderr });

  const handleEvent = (event) => {
    if (!event || typeof event !== "object") {
      return;
    }

    switch (event.type) {
      case "session.tools_updated":
        if (typeof event.data?.model === "string" && event.data.model.trim()) {
          model = event.data.model.trim();
          onProgress?.({
            message: `Using model ${model}.`,
            phase: "starting"
          });
        }
        break;
      case "assistant.reasoning":
        reasoningSummary = mergeReasoningSections(reasoningSummary, [event.data?.content]);
        break;
      case "assistant.message":
        if (typeof event.data?.content === "string" && event.data.content.trim()) {
          finalMessage = event.data.content;
        }
        if (typeof event.data?.reasoningText === "string" && event.data.reasoningText.trim()) {
          reasoningSummary = mergeReasoningSections(reasoningSummary, [event.data.reasoningText]);
        }
        if (event.data?.phase === "commentary" && finalMessage) {
          onProgress?.({
            message: firstMeaningfulLine(finalMessage),
            phase: "investigating"
          });
        }
        break;
      case "tool.execution_start":
        onProgress?.(buildToolStartMessage(event.data ?? {}));
        break;
      case "tool.execution_complete":
        onProgress?.(buildToolCompleteMessage(event.data ?? {}));
        break;
      case "result":
        sessionId = event.sessionId ?? sessionId;
        exitCode = typeof event.exitCode === "number" ? event.exitCode : exitCode;
        usage = event.usage ?? usage;
        touchedFiles = event.usage?.codeChanges?.filesModified ?? touchedFiles;
        break;
      default:
        break;
    }
  };

  stdoutReader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    stdoutLines.push(trimmed);
    try {
      handleEvent(JSON.parse(trimmed));
    } catch {
      finalMessage = trimmed;
    }
  });

  stderrReader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    stderrLines.push(trimmed);
    onProgress?.({
      message: trimmed,
      phase: "running",
      stderrMessage: trimmed
    });
  });

  const closeCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode == null) {
    exitCode = typeof closeCode === "number" ? closeCode : 1;
  }

  return {
    status: exitCode === 0 ? 0 : 1,
    exitCode,
    finalMessage,
    sessionId,
    model,
    usage,
    touchedFiles,
    reasoningSummary,
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n")
  };
}
