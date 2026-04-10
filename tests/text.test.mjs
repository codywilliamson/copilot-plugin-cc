import test from "node:test";
import assert from "node:assert/strict";

import {
  shorten,
  firstMeaningfulLine,
  stripMarkdownCodeFence,
  parseStructuredOutput
} from "../plugins/copilot/scripts/lib/text.mjs";

test("shorten returns empty string for null/undefined", () => {
  assert.equal(shorten(null), "");
  assert.equal(shorten(undefined), "");
  assert.equal(shorten(""), "");
});

test("shorten preserves text under limit", () => {
  assert.equal(shorten("hello world"), "hello world");
});

test("shorten truncates with ellipsis at limit", () => {
  const long = "a".repeat(100);
  const result = shorten(long, 96);
  assert.equal(result.length, 96);
  assert.ok(result.endsWith("..."));
});

test("shorten collapses whitespace", () => {
  assert.equal(shorten("hello   world\nnewline"), "hello world newline");
});

test("firstMeaningfulLine returns first non-empty line", () => {
  assert.equal(firstMeaningfulLine("\n\n  hello\nworld"), "hello");
});

test("firstMeaningfulLine returns fallback for empty input", () => {
  assert.equal(firstMeaningfulLine("", "fallback"), "fallback");
  assert.equal(firstMeaningfulLine(null, "fallback"), "fallback");
});

test("stripMarkdownCodeFence unwraps json fences", () => {
  assert.equal(stripMarkdownCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
});

test("stripMarkdownCodeFence returns plain text unchanged", () => {
  assert.equal(stripMarkdownCodeFence("plain text"), "plain text");
});

test("parseStructuredOutput parses valid JSON", () => {
  const result = parseStructuredOutput('{"verdict":"approve"}');
  assert.deepEqual(result.parsed, { verdict: "approve" });
  assert.equal(result.parseError, null);
});

test("parseStructuredOutput handles empty input", () => {
  const result = parseStructuredOutput("");
  assert.equal(result.parsed, null);
  assert.match(result.parseError, /empty/i);
});

test("parseStructuredOutput handles invalid JSON", () => {
  const result = parseStructuredOutput("not json");
  assert.equal(result.parsed, null);
  assert.ok(result.parseError);
  assert.equal(result.rawOutput, "not json");
});

test("parseStructuredOutput unwraps markdown code fences", () => {
  const result = parseStructuredOutput('```json\n{"ok":true}\n```');
  assert.deepEqual(result.parsed, { ok: true });
});
