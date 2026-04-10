# semver, commitlint, and CI automation

> design spec — 2026-04-09

## overview

add conventional commit enforcement, CI for tests on push to main, and a tag-based release workflow with automated changelog generation and github releases. all implementation commits co-authored by claude, copilot (sonnet 4.6), and codex (gpt-5.4) to showcase multi-ai collaboration.

## commitlint + husky

### dependencies (dev)

- `@commitlint/cli`
- `@commitlint/config-conventional`
- `husky`

### configuration

**`commitlint.config.mjs`** at project root:

```js
export default { extends: ['@commitlint/config-conventional'] };
```

no custom rules — standard conventional commit types (feat, fix, chore, docs, refactor, test, ci, style, perf, build, revert).

**`.husky/commit-msg`** hook:

```sh
npx commitlint --edit $1
```

**`package.json`** additions:

- `"prepare": "husky"` script for auto-install on `npm install`

## ci workflows

### existing: pull-request-ci.yml

no changes. already runs `npm ci` + `npm test` on node 22 for PRs.

### new: ci.yml (push to main)

- **trigger:** push to `main`
- **steps:** checkout → node 22 setup with npm cache → `npm ci` → `npm test`
- **permissions:** `contents: read`

### new: release.yml (tag-based release)

- **trigger:** push tags matching `v*`
- **steps:**
  1. checkout with full history (`fetch-depth: 0`) for changelog generation
  2. node 22 setup
  3. `npm ci`
  4. `npm test` — safety gate
  5. generate changelog: `npx conventional-changelog -p angular -r 2` (last 2 releases)
  6. create github release using `gh release create` with changelog body
- **permissions:** `contents: write` (to create releases)

## release script

extend `scripts/bump-version.mjs` to handle the full release flow in one command.

**usage:** `npm run release -- <major|minor|patch>`

**flow:**

1. bump version across all files (existing logic)
2. stage changed files
3. commit with message `chore: release v{version}`
4. create git tag `v{version}`
5. push commit and tag to origin

**package.json script:** `"release": "node scripts/bump-version.mjs --release"`

the `--release` flag triggers the full flow (commit + tag + push). without it, the script behaves as before (bump only).

## changelog

### dependency (dev)

- `conventional-changelog-cli`

### usage

used in the release CI workflow only — not run locally. generates grouped markdown (features, bug fixes, etc.) from conventional commits between the previous tag and the current tag.

## co-authoring

all commits created during implementation of this spec include:

```
Co-authored-by: Claude <noreply@anthropic.com>
Co-authored-by: GitHub Copilot <noreply@github.com>
Co-authored-by: OpenAI Codex <noreply@openai.com>
```

this is for attribution during implementation only — not an automated feature.

## implementation notes

- work is split across claude (orchestration), copilot (sonnet 4.6 w/ high reasoning), and codex (gpt-5.4)
- each ai handles tasks suited to its strengths — copilot and codex are dispatched via their respective plugins
- project currently has zero runtime/dev dependencies — these are all devDependencies and don't affect the plugin's zero-dep runtime story
- existing `bump-version.mjs` already handles multi-file version sync; release mode extends it
