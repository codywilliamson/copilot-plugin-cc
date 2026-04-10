import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRequestedModel,
  normalizeReasoningEffort,
  buildReviewPrompt,
  buildTaskRunMetadata,
  findLatestResumableTaskJob
} from "../plugins/copilot/scripts/lib/execute.mjs";

test("normalizeRequestedModel trims and nullifies empty strings", () => {
  assert.equal(normalizeRequestedModel(null), null);
  assert.equal(normalizeRequestedModel(""), null);
  assert.equal(normalizeRequestedModel("  "), null);
  assert.equal(normalizeRequestedModel("gpt-5"), "gpt-5");
  assert.equal(normalizeRequestedModel("  gpt-5  "), "gpt-5");
});

test("normalizeReasoningEffort validates known values", () => {
  assert.equal(normalizeReasoningEffort(null), null);
  assert.equal(normalizeReasoningEffort("high"), "high");
  assert.equal(normalizeReasoningEffort("HIGH"), "high");
  assert.throws(() => normalizeReasoningEffort("turbo"), /Unsupported/);
});

test("buildReviewPrompt includes adversarial guidance when requested", () => {
  const context = {
    target: { label: "working tree diff" },
    collectionGuidance: "Use context below.",
    summary: "1 file changed.",
    content: "diff content"
  };
  const standard = buildReviewPrompt(context, "focus on perf");
  assert.ok(!standard.includes("Challenge assumptions"));
  const adversarial = buildReviewPrompt(context, "focus on perf", true);
  assert.match(adversarial, /Challenge assumptions/);
});

test("buildTaskRunMetadata returns resume title for resume mode", () => {
  const meta = buildTaskRunMetadata({ prompt: "fix it", resumeLast: true });
  assert.equal(meta.title, "Copilot Resume");
  const normal = buildTaskRunMetadata({ prompt: "fix it", resumeLast: false });
  assert.equal(normal.title, "Copilot Task");
});

test("findLatestResumableTaskJob finds the first completed task with a session", () => {
  const jobs = [
    { id: "1", jobClass: "task", sessionId: "s1", status: "running" },
    { id: "2", jobClass: "task", sessionId: "s2", status: "completed" },
    { id: "3", jobClass: "review", sessionId: "s3", status: "completed" }
  ];
  const result = findLatestResumableTaskJob(jobs);
  assert.equal(result.id, "2");
});

test("findLatestResumableTaskJob returns null when no resumable job exists", () => {
  const jobs = [
    { id: "1", jobClass: "task", sessionId: "s1", status: "running" }
  ];
  assert.equal(findLatestResumableTaskJob(jobs), null);
});
