import { getCopilotAvailability, runCopilotJson } from "./copilot.mjs";
import { firstMeaningfulLine, parseStructuredOutput, shorten } from "./text.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./git.mjs";
import { filterJobsForCurrentSession, sortJobsNewestFirst } from "./job-control.mjs";
import { renderReviewResult, renderTaskResult } from "./render.mjs";
import { listJobs } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const DEFAULT_CONTINUE_PROMPT =
  "Continue the previous Copilot session. Pick the next highest-value step and follow through until the task is resolved.";
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

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

function ensureCopilotAvailable(cwd) {
  const availability = getCopilotAvailability(cwd);
  if (!availability.available) {
    throw new Error("Copilot CLI is not installed or is missing required runtime support. Install it with `npm install -g @github/copilot`, then rerun `/copilot:setup`.");
  }
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

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Copilot Review" : `Copilot ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

async function executeReviewRun(request) {
  ensureCopilotAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target = request.target ?? resolveReviewTarget(request.cwd, {
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

function resolveLatestTrackedTaskSession(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot)).filter((job) => job.id !== options.excludeJobId);
  const visibleJobs = filterJobsForCurrentSession(jobs);
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

export {
  DEFAULT_CONTINUE_PROMPT,
  VALID_REASONING_EFFORTS,
  normalizeRequestedModel,
  normalizeReasoningEffort,
  ensureCopilotAvailable,
  buildReviewPrompt,
  buildReviewJobMetadata,
  executeReviewRun,
  buildTaskRunMetadata,
  findLatestResumableTaskJob,
  resolveLatestTrackedTaskSession,
  executeTaskRun
};
