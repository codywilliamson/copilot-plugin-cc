import test from "node:test";
import assert from "node:assert/strict";

import { renderReviewResult, renderStoredJobResult } from "../plugins/copilot/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Copilot returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult includes resume instructions for Copilot sessions", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Copilot Adversarial Review",
      jobClass: "review",
      sessionId: "sess-123"
    },
    {
      sessionId: "sess-123",
      rendered: "# Copilot Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Copilot Adversarial Review/);
  assert.match(output, /Copilot session ID: sess-123/);
  assert.match(output, /Resume in Copilot: copilot --resume sess-123/);
});

test("renderStoredJobResult omits session info when no session exists", () => {
  const output = renderStoredJobResult(
    { id: "task-1", status: "completed", title: "Copilot Task" },
    { rendered: "Task output here.\n" }
  );
  assert.ok(!output.includes("Copilot session ID:"));
  assert.ok(!output.includes("Resume in Copilot:"));
  assert.match(output, /Task output here\./);
});
