#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getCopilotAuthStatus, getCopilotAvailability, getCopilotConfig, runCopilotJson } from "./lib/copilot.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";
import { generateJobId, listJobs } from "./lib/state.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const DEFAULT_CONTINUE_PROMPT =
  "Continue the previous Copilot session. Pick the next highest-value step and follow through until the task is resolved.";
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/copilot-companion.mjs setup [--config-dir <dir>] [--json]",
      "  node scripts/copilot-companion.mjs review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--json]",
      "  node scripts/copilot-companion.mjs adversarial-review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [focus text] [--json]",
      "  node scripts/copilot-companion.mjs task [--resume|--resume-last|--fresh] [--model <model>] [--effort <low|medium|high|xhigh>] [prompt]",
      "  node scripts/copilot-companion.mjs status [job-id] [--all] [--wait] [--json]",
      "  node scripts/copilot-companion.mjs result [job-id] [--json]",
      "  node scripts/copilot-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeRequestedModel(model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  return normalized || null;
}

function normalizeReasoningEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error(`Unsupported reasoning effort "${effort}". Use one of: low, medium, high, xhigh.`);
  }
  return normalized;
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      m: "model",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback = "") {
  return (
    String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? fallback
  );
}

function stripMarkdownCodeFence(value) {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseStructuredOutput(rawOutput) {
  const raw = String(rawOutput ?? "").trim();
  if (!raw) {
    return {
      parsed: null,
      rawOutput: raw,
      parseError: "Copilot returned an empty final message."
    };
  }

  try {
    return {
      parsed: JSON.parse(stripMarkdownCodeFence(raw)),
      rawOutput: raw,
      parseError: null
    };
  } catch (error) {
    return {
      parsed: null,
      rawOutput: raw,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: jobClass === "review" ? kind : "rescue",
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

async function buildSetupReport(cwd, options = {}) {
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const ghStatus = binaryAvailable("gh", ["auth", "status"], { cwd });
  const copilotStatus = getCopilotAvailability(cwd);
  const authStatus = getCopilotAuthStatus(cwd, options);
  const configInfo = getCopilotConfig(options);

  const nextSteps = [];
  if (!copilotStatus.available) {
    nextSteps.push("Install Copilot CLI with `npm install -g @github/copilot`.");
  }
  if (!authStatus.loggedIn) {
    nextSteps.push("Authenticate with `copilot login` or `gh auth login`.");
  }

  return {
    ready: nodeStatus.available && copilotStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    gh: ghStatus,
    copilot: copilotStatus,
    auth: authStatus,
    configPath: configInfo.configPath,
    defaultModel: configInfo.config?.model ?? null,
    defaultEffort: configInfo.config?.effortLevel ?? null,
    nextSteps
  };
}

function buildReviewPrompt(context, focusText, adversarial = false) {
  const reviewMode = adversarial ? "adversarial" : "standard";
  const extraFocus = focusText?.trim() ? focusText.trim() : "No extra focus provided.";

  return `
You are GitHub Copilot acting as a rigorous ${reviewMode} code reviewer.

Return JSON only with this exact top-level shape:
{
  "verdict": "approve" | "needs-attention",
  "summary": "short summary",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "finding title",
      "body": "why it matters",
      "file": "path/to/file",
      "line_start": 1,
      "line_end": 1,
      "recommendation": "specific fix guidance"
    }
  ],
  "next_steps": ["short next step"]
}

Rules:
- Focus on correctness, regressions, security, reliability, and test gaps.
- Do not praise the code.
- Do not report style nits.
- If there are no material issues, use "approve" and an empty findings array.
- Only cite files or lines supported by the provided repository context.
${adversarial ? "- Challenge assumptions, tradeoffs, rollback safety, failure modes, and simpler alternatives.\n" : ""}- Keep the summary short and specific.

Review target: ${context.target.label}
Additional focus: ${extraFocus}
Collection guidance: ${context.collectionGuidance}
Repository summary: ${context.summary}

Repository context:
${context.content}
`.trim();
}

function ensureCopilotAvailable(cwd) {
  const availability = getCopilotAvailability(cwd);
  if (!availability.available) {
    throw new Error("Copilot CLI is not installed or is missing required runtime support. Install it with `npm install -g @github/copilot`, then rerun `/copilot:setup`.");
  }
}

async function executeReviewRun(request) {
  ensureCopilotAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const context = collectReviewContext(request.cwd, target);
  const prompt = buildReviewPrompt(context, request.focusText, request.reviewName === "Adversarial Review");
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--stream",
    "off",
    "--no-auto-update"
  ];

  if (request.model) {
    args.push("--model", request.model);
  }

  const result = await runCopilotJson(context.repoRoot, args, {
    onProgress: request.onProgress
  });
  const parsed = parseStructuredOutput(result.finalMessage);
  const payload = {
    review: request.reviewName,
    target,
    sessionId: result.sessionId,
    model: result.model,
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError,
    reasoningSummary: result.reasoningSummary,
    usage: result.usage
  };

  return {
    exitStatus: result.exitCode,
    sessionId: result.sessionId,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: request.reviewName,
      targetLabel: context.target.label,
      reasoningSummary: result.reasoningSummary
    }),
    summary:
      parsed.parsed?.summary ??
      parsed.parseError ??
      firstMeaningfulLine(result.finalMessage, `${request.reviewName} finished.`),
    jobTitle: `Copilot ${request.reviewName}`,
    jobClass: "review",
    targetLabel: target.label
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false }) {
  const title = resumeLast ? "Copilot Resume" : "Copilot Task";
  const fallbackSummary = resumeLast ? DEFAULT_CONTINUE_PROMPT : "Task";
  return {
    title,
    summary: shorten(prompt || fallbackSummary)
  };
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function findLatestResumableTaskJob(jobs) {
  return (
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.sessionId &&
        job.status !== "queued" &&
        job.status !== "running"
    ) ?? null
  );
}

async function resolveLatestTrackedTaskSession(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentClaudeSession(jobs);
  const activeTask = visibleJobs.find((job) => job.jobClass === "task" && (job.status === "queued" || job.status === "running"));
  if (activeTask) {
    throw new Error(`Task ${activeTask.id} is still running. Use /copilot:status before continuing it.`);
  }

  return findLatestResumableTaskJob(visibleJobs);
}

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureCopilotAvailable(request.cwd);

  const taskMetadata = buildTaskRunMetadata({
    prompt: request.prompt,
    resumeLast: request.resumeLast
  });

  let resumeSessionId = null;
  if (request.resumeLast) {
    const latestJob = await resolveLatestTrackedTaskSession(workspaceRoot, {
      excludeJobId: request.jobId
    });
    if (!latestJob) {
      throw new Error("No previous Copilot task session was found for this repository.");
    }
    resumeSessionId = latestJob.sessionId;
  }

  if (!request.prompt && !resumeSessionId) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const effectivePrompt = request.prompt || DEFAULT_CONTINUE_PROMPT;
  const args = [
    "-p",
    effectivePrompt,
    "--output-format",
    "json",
    "--stream",
    "off",
    "--no-auto-update",
    "--allow-tool=shell"
  ];

  if (request.write) {
    args.push("--allow-tool=write");
  }
  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.effort) {
    args.push("--effort", request.effort);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  const result = await runCopilotJson(workspaceRoot, args, {
    onProgress: request.onProgress
  });
  const rawOutput = typeof result.finalMessage === "string" ? result.finalMessage : "";
  const failureMessage = result.stderr ?? "";
  const rendered = renderTaskResult({
    rawOutput,
    failureMessage
  });
  const payload = {
    status: result.status,
    sessionId: result.sessionId,
    rawOutput,
    touchedFiles: result.touchedFiles,
    reasoningSummary: result.reasoningSummary,
    usage: result.usage,
    model: result.model
  };

  return {
    exitStatus: result.exitCode,
    sessionId: result.sessionId,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${taskMetadata.title} finished.`)),
    jobTitle: taskMetadata.title,
    jobClass: "task",
    write: Boolean(request.write)
  };
}

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Copilot Review" : `Copilot ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function buildTaskJob(workspaceRoot, taskMetadata, write) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write
  });
}

function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }

  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while ((snapshot.job.status === "queued" || snapshot.job.status === "running") && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: snapshot.job.status === "queued" || snapshot.job.status === "running",
    timeoutMs
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "config-dir"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const report = await buildSetupReport(cwd, {
    configDir: options["config-dir"],
    env: process.env
  });
  outputResult(options.json ? report : renderSetupReport(report), options.json);
}

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope
  });
  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        cwd,
        base: options.base,
        scope: options.scope,
        model: normalizeRequestedModel(options.model),
        focusText: positionals.join(" ").trim(),
        reviewName: config.reviewName,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, {
    reviewName: "Review"
  });
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "effort", "cwd", "prompt-file"],
    booleanOptions: ["json", "resume-last", "resume", "fresh", "background", "write"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = normalizeRequestedModel(options.model);
  const effort = normalizeReasoningEffort(options.effort);
  const prompt = readTaskPrompt(cwd, options, positionals);

  const resumeLast = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resumeLast && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }

  const write = options.write !== false;
  const taskMetadata = buildTaskRunMetadata({
    prompt,
    resumeLast
  });

  const job = buildTaskJob(workspaceRoot, taskMetadata, write);
  await runForegroundCommand(
    job,
    (progress) =>
      executeTaskRun({
        cwd,
        model,
        effort,
        prompt,
        write,
        resumeLast,
        jobId: job.id,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("`status --wait` requires a job id.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  const { writeJobFile, upsertJob } = await import("./lib/state.mjs");
  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
