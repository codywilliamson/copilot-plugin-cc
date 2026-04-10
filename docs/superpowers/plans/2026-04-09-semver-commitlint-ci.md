# Semver, Commitlint & CI Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conventional commit enforcement via commitlint + husky, CI for tests on push to main, tag-based release CI with changelog generation, and a one-command release script.

**Architecture:** Local git hooks enforce conventional commits. Two new GitHub Actions workflows handle push-to-main testing and tag-based releases. The existing `bump-version.mjs` gains a `--release` mode that bumps, commits, tags, and pushes in one shot. Release CI generates a changelog from conventional commits and creates a GitHub Release.

**Tech Stack:** Node.js (ESM), husky, commitlint, conventional-changelog-cli, GitHub Actions

**AI collaboration:** Work is split across Claude (orchestration), Copilot (sonnet 4.6), and Codex (gpt-5.4). All commits include co-author trailers for all three.

**Co-author trailers for every commit:**

```
Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>
```

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `commitlint.config.mjs` | Commitlint configuration — extends conventional config |
| Create | `.husky/commit-msg` | Git hook — runs commitlint on commit messages |
| Create | `.github/workflows/ci.yml` | CI workflow — runs tests on push to main |
| Create | `.github/workflows/release.yml` | Release workflow — changelog + GitHub Release on `v*` tags |
| Modify | `package.json` | Add devDependencies, `prepare` and `release` scripts |
| Modify | `scripts/bump-version.mjs` | Add `--release` mode (commit, tag, push) |

---

### Task 1: Install devDependencies and configure commitlint

**Files:**
- Modify: `package.json`
- Create: `commitlint.config.mjs`

- [ ] **Step 1: Install devDependencies**

```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional husky conventional-changelog-cli
```

Expected: `package.json` gains `devDependencies` section, `package-lock.json` updates.

- [ ] **Step 2: Create commitlint config**

Create `commitlint.config.mjs`:

```js
export default { extends: ['@commitlint/config-conventional'] };
```

- [ ] **Step 3: Verify commitlint works**

```bash
echo "bad message" | npx commitlint
```

Expected: FAIL — not a valid conventional commit.

```bash
echo "feat: valid message" | npx commitlint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json commitlint.config.mjs
git commit -m "chore: add commitlint with conventional config

Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>"
```

---

### Task 2: Set up husky with commit-msg hook

**Files:**
- Modify: `package.json` (add `prepare` script)
- Create: `.husky/commit-msg`

- [ ] **Step 1: Add prepare script to package.json**

Add to `scripts`:

```json
"prepare": "husky"
```

- [ ] **Step 2: Run prepare to initialize husky**

```bash
npm run prepare
```

Expected: `.husky/` directory created.

- [ ] **Step 3: Create commit-msg hook**

Create `.husky/commit-msg`:

```sh
npx commitlint --edit $1
```

Make sure the file is executable (git handles this, but verify):

```bash
ls -la .husky/commit-msg
```

- [ ] **Step 4: Test the hook rejects bad commits**

```bash
git commit --allow-empty -m "bad commit message"
```

Expected: FAIL — commitlint rejects the message. The commit should not be created.

- [ ] **Step 5: Test the hook accepts good commits**

```bash
git commit --allow-empty -m "test: verify commitlint hook works"
```

Expected: PASS — commit created. Then undo the test commit:

```bash
git reset HEAD~1
```

- [ ] **Step 6: Commit**

```bash
git add package.json .husky/commit-msg
git commit -m "chore: add husky with commitlint commit-msg hook

Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>"
```

---

### Task 3: Add push-to-main CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Set up Node.js
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run test suite
        run: npm test
```

Uses the same pinned action versions as the existing PR CI for consistency.

- [ ] **Step 2: Validate YAML syntax**

```bash
node -e "const fs = require('fs'); const yaml = require('yaml') || console.log('no yaml module, checking manually'); const content = fs.readFileSync('.github/workflows/ci.yml', 'utf8'); console.log('YAML is valid (basic read check)');"
```

Or simply:

```bash
head -30 .github/workflows/ci.yml
```

Expected: Well-formed YAML with correct indentation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add push-to-main test workflow

Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>"
```

---

### Task 4: Add release CI workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run test suite
        run: npm test

      - name: Generate changelog
        id: changelog
        run: |
          npx conventional-changelog -p angular -r 2 -o CHANGELOG.md
          {
            echo 'body<<EOF'
            cat CHANGELOG.md
            echo 'EOF'
          } >> "$GITHUB_OUTPUT"

      - name: Create GitHub Release
        run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes "$BODY"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BODY: ${{ steps.changelog.outputs.body }}
```

- [ ] **Step 2: Verify YAML structure**

```bash
head -50 .github/workflows/release.yml
```

Expected: Valid YAML, correct indentation, `fetch-depth: 0` present for changelog generation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add tag-based release workflow with changelog generation

Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>"
```

---

### Task 5: Extend bump-version.mjs with --release mode

**Files:**
- Modify: `scripts/bump-version.mjs`
- Modify: `package.json` (add `release` script)

- [ ] **Step 1: Add semver bump helpers to bump-version.mjs**

Add these functions after the existing `validateVersion` function (around line 126):

```js
const BUMP_LEVELS = ['major', 'minor', 'patch'];

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Cannot parse semver: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bumpSemver(current, level) {
  if (!BUMP_LEVELS.includes(level)) {
    throw new Error(`Invalid bump level: ${level}. Use: ${BUMP_LEVELS.join(', ')}`);
  }
  const parts = parseSemver(current);
  if (level === 'major') return `${parts.major + 1}.0.0`;
  if (level === 'minor') return `${parts.major}.${parts.minor + 1}.0`;
  return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
}
```

- [ ] **Step 2: Add release execution function**

Add after `bumpVersion` function (around line 193):

```js
async function release(root, level) {
  const { execSync } = await import("node:child_process");
  const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: root });

  const currentVersion = readPackageVersion(root);
  const newVersion = bumpSemver(currentVersion, level);

  const changedFiles = bumpVersion(root, newVersion);
  const touched = changedFiles.length > 0 ? changedFiles.join(", ") : "no files changed";
  console.log(`Bumped version to ${newVersion}: ${touched}.`);

  const filesToStage = [
    "package.json",
    "package-lock.json",
    "plugins/copilot/.claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json"
  ];
  run(`git add ${filesToStage.join(" ")}`);
  run(`git commit -m "chore: release v${newVersion}"`);
  run(`git tag v${newVersion}`);
  run(`git push && git push --tags`);

  console.log(`Released v${newVersion}.`);
}
```

- [ ] **Step 3: Update parseArgs to handle --release**

Update the `parseArgs` function to recognize the `--release` flag:

```js
function parseArgs(argv) {
  const options = {
    check: false,
    release: false,
    root: process.cwd(),
    version: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--release") {
      options.release = true;
    } else if (arg === "--root") {
      const root = argv[i + 1];
      if (!root) {
        throw new Error("--root requires a directory.");
      }
      options.root = root;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.version) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    } else {
      options.version = arg;
    }
  }

  options.root = path.resolve(options.root);
  return options;
}
```

- [ ] **Step 4: Update usage and main**

Update `usage()`:

```js
function usage() {
  return [
    "Usage:",
    "  node scripts/bump-version.mjs <version>",
    "  node scripts/bump-version.mjs --release <major|minor|patch>",
    "  node scripts/bump-version.mjs --check [version]",
    "",
    "Options:",
    "  --release    Bump version, commit, tag, and push.",
    "  --check      Verify manifest versions. Uses package.json when version is omitted.",
    "  --root <dir> Run against a different repository root.",
    "  --help       Print this help."
  ].join("\n");
}
```

Update `main()` to handle the release path (make it async):

```js
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.release) {
    const level = options.version;
    if (!level || !BUMP_LEVELS.includes(level)) {
      throw new Error(`--release requires a bump level: ${BUMP_LEVELS.join(', ')}\n\n${usage()}`);
    }
    await release(options.root, level);
    return;
  }

  const version = options.version ?? (options.check ? readPackageVersion(options.root) : null);
  if (!version) {
    throw new Error(`Missing version.\n\n${usage()}`);
  }
  validateVersion(version);

  if (options.check) {
    const mismatches = checkVersions(options.root, version);
    if (mismatches.length > 0) {
      throw new Error(`Version metadata is out of sync:\n${mismatches.join("\n")}`);
    }
    console.log(`All version metadata matches ${version}.`);
    return;
  }

  const changedFiles = bumpVersion(options.root, version);
  const touched = changedFiles.length > 0 ? changedFiles.join(", ") : "no files changed";
  console.log(`Set version metadata to ${version}: ${touched}.`);
}
```

Update the bottom-level call to handle async:

```js
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Add release script to package.json**

Add to `scripts`:

```json
"release": "node scripts/bump-version.mjs --release"
```

Usage: `npm run release -- minor`

- [ ] **Step 6: Test the bump helpers locally**

```bash
node -e "
import('./scripts/bump-version.mjs').catch(() => {});
" 2>&1 || true
node scripts/bump-version.mjs --help
```

Expected: Updated help text shows `--release` option.

- [ ] **Step 7: Test --release with --check (dry validation)**

```bash
node scripts/bump-version.mjs --check
```

Expected: `All version metadata matches 0.2.0.` (existing behavior still works).

- [ ] **Step 8: Commit**

```bash
git add scripts/bump-version.mjs package.json
git commit -m "feat: add --release mode to bump-version script

bumps version, commits, tags, and pushes in one command.
usage: npm run release -- <major|minor|patch>

Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>"
```

---

### Task 6: Run full test suite and verify

**Files:** None (validation only)

- [ ] **Step 1: Run existing tests**

```bash
npm test
```

Expected: Same pass/fail ratio as before (6/11 — 5 pre-existing Windows fixture failures).

- [ ] **Step 2: Verify commitlint hook works end-to-end**

```bash
git commit --allow-empty -m "this should fail"
```

Expected: commitlint rejects. No commit created.

```bash
git commit --allow-empty -m "test: verify commitlint hook"
```

Expected: Commit created. Then undo:

```bash
git reset HEAD~1
```

- [ ] **Step 3: Verify version check still works**

```bash
npm run check-version
```

Expected: `All version metadata matches 0.2.0.`

- [ ] **Step 4: Verify release help**

```bash
npm run release -- --help 2>&1 || node scripts/bump-version.mjs --help
```

Expected: Help text shows `--release` option with `major|minor|patch`.
