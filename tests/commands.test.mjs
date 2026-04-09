import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "copilot");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("commands point at the Copilot companion runtime", () => {
  const review = read("commands/review.md");
  const adversarial = read("commands/adversarial-review.md");
  const rescue = read("commands/rescue.md");
  const setup = read("commands/setup.md");
  const status = read("commands/status.md");
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");

  assert.match(review, /copilot-companion\.mjs" review/);
  assert.match(review, /run_in_background:\s*true/);
  assert.match(adversarial, /copilot-companion\.mjs" adversarial-review/);
  assert.match(rescue, /copilot-companion\.mjs" task/);
  assert.match(rescue, /--model <model>/);
  assert.match(rescue, /--effort <low\|medium\|high\|xhigh>/);
  assert.match(setup, /copilot-companion\.mjs" setup/);
  assert.match(status, /copilot-companion\.mjs" status/);
  assert.match(result, /copilot-companion\.mjs" result/);
  assert.match(cancel, /copilot-companion\.mjs" cancel/);
});
